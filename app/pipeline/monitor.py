"""Hourly monitoring orchestrator.

fetch → normalize → pre-dedup → prefilter → AI analyze → event dedup →
materiality rules → store → alert (High only).

Runs on schedule, manually via CLI (python -m app.jobs.run_monitoring), or via
the admin API. Alert delivery is injected as a callback so the pipeline stays
decoupled from the Telegram layer.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.analyzer import AnalysisFailed, analyze_raw_item
from app.ai.client import get_llm_client
from app.config import get_settings
from app.db.engine import get_session_factory
from app.db.models import (
    IntelligenceItem,
    MonitoringRun,
    RawItem,
    RawItemStatus,
    Source,
)
from app.pipeline.dedup import (
    find_matching_item,
    find_raw_duplicate,
    intelligence_item_for_raw,
    merge_into_item,
)
from app.pipeline.materiality import apply_materiality_rules
from app.pipeline.normalize import (
    canonical_url,
    clean_snippet,
    normalize_title,
    sha256_hex,
    simhash64,
)
from app.pipeline.prefilter import prefilter
from app.pipeline.store import create_intelligence_item
from app.sources.base import FetchedEntry, RobotsCache, make_http_client
from app.sources.html import fetch_html_listing
from app.sources.rss import fetch_rss

log = logging.getLogger(__name__)

# Async callback invoked with each newly created High-materiality item.
AlertCallback = Callable[[AsyncSession, IntelligenceItem], Awaitable[int]]


async def _fetch_source(client, robots: RobotsCache, source: Source, limit: int) -> list[FetchedEntry]:
    if source.fetch_method == "rss" and source.feed_url:
        return await fetch_rss(client, source.feed_url, limit)
    return await fetch_html_listing(client, robots, source.url, limit)


async def _ingest_entries(
    session: AsyncSession, source: Source, entries: list[FetchedEntry], run: MonitoringRun
) -> list[RawItem]:
    settings = get_settings()
    new_items: list[RawItem] = []
    for entry in entries:
        run.items_fetched += 1
        canon = canonical_url(entry.url)
        url_hash = sha256_hex(canon)
        exists = await session.scalar(
            select(RawItem.id).where(RawItem.canonical_url_hash == url_hash)
        )
        if exists:
            continue
        title_norm = normalize_title(entry.title)
        item = RawItem(
            source_id=source.id,
            external_id=(entry.external_id or "")[:500] or None,
            url=entry.url[:1500],
            canonical_url_hash=url_hash,
            title=entry.title,
            title_norm_hash=sha256_hex(title_norm),
            title_simhash=str(simhash64(title_norm)),
            snippet=clean_snippet(entry.summary, settings.snippet_max_chars),
            published_at=entry.published_at,
            language=source.language,
            status=RawItemStatus.NEW.value,
        )
        session.add(item)
        new_items.append(item)
        run.items_new += 1
    await session.flush()
    return new_items


async def _process_new_item(
    session: AsyncSession,
    raw_item: RawItem,
    source: Source,
    run: MonitoringRun,
    llm_budget: dict,
) -> IntelligenceItem | None:
    """Returns a newly created High/Medium/Low intelligence item, or None."""
    # Stage-1 dedup: near-identical title already ingested recently.
    duplicate = await find_raw_duplicate(
        session,
        raw_item.title_norm_hash,
        int(raw_item.title_simhash or 0),
        exclude_raw_id=raw_item.id,
    )
    if duplicate is not None:
        existing_intel = await intelligence_item_for_raw(session, duplicate)
        if existing_intel is not None:
            await merge_into_item(session, existing_intel, raw_item, source)
            return None
        if duplicate.status in (
            RawItemStatus.PREFILTERED_OUT.value,
            RawItemStatus.REJECTED_BY_AI.value,
        ):
            raw_item.status = RawItemStatus.PREFILTERED_OUT.value
            raw_item.error_detail = f"duplicate of rejected raw_item {duplicate.id}"
            run.items_prefiltered_out += 1
            return None

    # Stage-2 gate: keyword prefilter (incl. hard LNG/gas exclusion).
    result = prefilter(raw_item.title, raw_item.snippet, source.category)
    raw_item.prefilter_score = result.score
    if not result.passed:
        raw_item.status = RawItemStatus.PREFILTERED_OUT.value
        raw_item.error_detail = result.reason
        run.items_prefiltered_out += 1
        return None

    # Stage-3: LLM structured analysis (budget-capped per run).
    if llm_budget["remaining"] <= 0:
        return None  # stays NEW; next run picks it up
    llm_budget["remaining"] -= 1
    run.llm_calls += 1
    try:
        analysis = await analyze_raw_item(get_llm_client(), raw_item, source)
        run.llm_calls += 0  # retries are internal to analyze_raw_item
    except AnalysisFailed as exc:
        raw_item.status = RawItemStatus.ANALYSIS_FAILED.value
        raw_item.error_detail = exc.detail
        return None

    if not analysis.is_relevant:
        raw_item.status = RawItemStatus.REJECTED_BY_AI.value
        raw_item.error_detail = analysis.rejection_reason
        return None

    # Stage-4: event-level dedup.
    existing = await find_matching_item(session, analysis)
    if existing is not None:
        await merge_into_item(session, existing, raw_item, source)
        return None

    materiality = apply_materiality_rules(analysis)
    item = await create_intelligence_item(session, analysis, raw_item, source, materiality)
    raw_item.status = RawItemStatus.ANALYZED.value

    counter = {"High": "items_high", "Medium": "items_medium", "Low": "items_low"}[materiality]
    setattr(run, counter, getattr(run, counter) + 1)
    return item


async def run_monitoring(
    trigger: str = "schedule", alert_callback: AlertCallback | None = None
) -> MonitoringRun:
    settings = get_settings()
    session_factory = get_session_factory()
    robots = RobotsCache()

    async with session_factory() as session:
        run = MonitoringRun(trigger=trigger, status="running")
        session.add(run)
        await session.commit()

        sources = (
            await session.scalars(select(Source).where(Source.enabled.is_(True)))
        ).all()
        llm_budget = {"remaining": settings.llm_max_items_per_run}
        new_high_items: list[IntelligenceItem] = []
        errors: list[str] = []

        async with make_http_client() as client:
            for source in sources:
                run.sources_checked += 1
                source.last_fetched_at = datetime.now(timezone.utc)
                try:
                    entries = await _fetch_source(
                        client, robots, source, settings.max_items_per_source_per_run
                    )
                except Exception as exc:  # noqa: BLE001 - one bad source must not kill the run
                    run.sources_failed += 1
                    source.consecutive_failures += 1
                    errors.append(f"{source.slug}: {type(exc).__name__}: {str(exc)[:200]}")
                    log.warning("Fetch failed for %s: %s", source.slug, exc)
                    continue
                source.last_success_at = datetime.now(timezone.utc)
                source.consecutive_failures = 0

                new_items = await _ingest_entries(session, source, entries, run)
                for raw_item in new_items:
                    try:
                        item = await _process_new_item(session, raw_item, source, run, llm_budget)
                    except Exception as exc:  # noqa: BLE001
                        raw_item.status = RawItemStatus.ERROR.value
                        raw_item.error_detail = f"{type(exc).__name__}: {str(exc)[:400]}"
                        errors.append(f"item {raw_item.id}: {type(exc).__name__}")
                        log.exception("Processing failed for raw_item %s", raw_item.id)
                        continue
                    if item is not None and item.materiality == "High":
                        new_high_items.append(item)
                await session.commit()

        # High-materiality alerts (send-once is enforced by the alerts table).
        if alert_callback is not None:
            for item in new_high_items:
                try:
                    run.alerts_sent += await alert_callback(session, item)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"alert item {item.id}: {type(exc).__name__}")
                    log.exception("Alert dispatch failed for item %s", item.id)

        run.finished_at = datetime.now(timezone.utc)
        run.status = "partial" if errors else "success"
        if errors:
            run.error_detail = "; ".join(errors)[:2000]
        await session.commit()
        log.info(
            "Monitoring run %s finished: %d sources (%d failed), %d new, %d analyzed H/M/L=%d/%d/%d, %d alerts",
            run.id, run.sources_checked, run.sources_failed, run.items_new,
            run.items_high + run.items_medium + run.items_low,
            run.items_high, run.items_medium, run.items_low, run.alerts_sent,
        )
        return run
