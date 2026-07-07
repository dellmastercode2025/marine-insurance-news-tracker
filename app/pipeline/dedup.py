"""Two-stage deduplication.

Stage 1 (pre-AI, raw level): exact canonical-URL hits are skipped at insert;
near-identical titles (normalized hash or simhash) within a recent window are
attached to the existing intelligence item without a second LLM call.

Stage 2 (post-AI, event level): the analyzer emits an event_key slug; items
with the same event_key (or near-identical headlines of the same update_type)
within a window are merged into one intelligence item — all source links
preserved, earliest source date kept, most authoritative source tracked, and
confidence boosted once a second independent reliable source confirms.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import AnalysisResult
from app.db.models import DuplicateGroup, IntelligenceItem, RawItem, Source
from app.pipeline.materiality import boost_confidence
from app.pipeline.normalize import hamming_distance, normalize_title, simhash64

log = logging.getLogger(__name__)

SIMHASH_MAX_DISTANCE = 6
RAW_WINDOW_DAYS = 3
EVENT_WINDOW_DAYS = 7
RELIABLE_AUTHORITY_RANK = 3  # rank <= 3 counts as a reliable confirming source


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


async def find_raw_duplicate(
    session: AsyncSession, title_norm_hash: str, title_simhash: int
) -> RawItem | None:
    """Find a recent raw item with a near-identical title."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RAW_WINDOW_DAYS)
    rows = (
        await session.scalars(
            select(RawItem)
            .where(RawItem.fetched_at >= cutoff)
            .order_by(RawItem.id.desc())
            .limit(500)
        )
    ).all()
    for row in rows:
        if row.title_norm_hash == title_norm_hash:
            return row
        if row.title_simhash is not None:
            try:
                if hamming_distance(int(row.title_simhash), title_simhash) <= SIMHASH_MAX_DISTANCE:
                    return row
            except ValueError:
                continue
    return None


async def intelligence_item_for_raw(
    session: AsyncSession, raw_item: RawItem
) -> IntelligenceItem | None:
    return await session.scalar(
        select(IntelligenceItem).where(IntelligenceItem.primary_raw_item_id == raw_item.id)
    )


async def find_matching_item(
    session: AsyncSession, analysis: AnalysisResult
) -> IntelligenceItem | None:
    """Event-level match: same event_key, or near-identical headline with the
    same update_type, within the event window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=EVENT_WINDOW_DAYS)

    by_key = await session.scalar(
        select(IntelligenceItem)
        .join(DuplicateGroup, IntelligenceItem.duplicate_group_id == DuplicateGroup.id)
        .where(
            DuplicateGroup.event_key == analysis.event_key,
            IntelligenceItem.detected_at >= cutoff,
        )
        .order_by(IntelligenceItem.id)
        .limit(1)
    )
    if by_key is not None:
        return by_key

    headline_hash = simhash64(normalize_title(analysis.headline))
    candidates = (
        await session.scalars(
            select(IntelligenceItem)
            .where(
                IntelligenceItem.detected_at >= cutoff,
                IntelligenceItem.update_type == analysis.update_type,
            )
            .order_by(IntelligenceItem.id.desc())
            .limit(300)
        )
    ).all()
    for candidate in candidates:
        candidate_hash = simhash64(normalize_title(candidate.headline))
        if hamming_distance(candidate_hash, headline_hash) <= SIMHASH_MAX_DISTANCE:
            return candidate
    return None


def _source_entry(source: Source, raw_item: RawItem) -> dict:
    published = as_utc(raw_item.published_at)
    return {
        "name": source.name,
        "url": raw_item.url,
        "published_at": published.isoformat() if published else None,
        "authority_rank": source.authority_rank,
    }


async def merge_into_item(
    session: AsyncSession,
    item: IntelligenceItem,
    raw_item: RawItem,
    source: Source,
) -> IntelligenceItem:
    """Attach a confirming source to an existing intelligence item."""
    links: list[dict] = list(item.all_source_urls or [])
    if any(link.get("url") == raw_item.url for link in links):
        return item
    links.append(_source_entry(source, raw_item))
    item.all_source_urls = links

    group = await session.get(DuplicateGroup, item.duplicate_group_id)
    if group is not None:
        group.member_count = len(links)
        published = as_utc(raw_item.published_at)
        earliest = as_utc(group.earliest_published_at)
        if published and (earliest is None or published < earliest):
            group.earliest_published_at = published
            item.publication_date = published

        # Track the most authoritative source and surface it as primary.
        current_best = None
        if group.most_authoritative_source_id:
            current_best = await session.get(Source, group.most_authoritative_source_id)
        if current_best is None or source.authority_rank < current_best.authority_rank:
            group.most_authoritative_source_id = source.id
            item.source_name = source.name
            item.source_url = raw_item.url

        # Confidence boost: second independent reliable source confirming.
        distinct_reliable = {
            link.get("name")
            for link in links
            if (link.get("authority_rank") or 5) <= RELIABLE_AUTHORITY_RANK
        }
        if len(distinct_reliable) >= 2 and not group.confidence_boosted:
            item.confidence = boost_confidence(item.confidence)
            group.confidence_boosted = True

    raw_item.status = "merged"
    log.info("Merged raw_item %s into intelligence_item %s", raw_item.id, item.id)
    return item


async def create_group(
    session: AsyncSession, event_key: str, source: Source, published_at: datetime | None
) -> DuplicateGroup:
    group = DuplicateGroup(
        event_key=event_key,
        earliest_published_at=as_utc(published_at),
        most_authoritative_source_id=source.id,
        member_count=1,
    )
    session.add(group)
    await session.flush()
    return group
