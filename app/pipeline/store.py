"""Persistence of analyzed items: intelligence rows, entity registry, search text."""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import AnalysisResult
from app.db.models import Entity, IntelligenceItem, IntelligenceItemEntity, RawItem, Source
from app.pipeline.dedup import _source_entry, as_utc, create_group

log = logging.getLogger(__name__)

_ENTITY_FIELDS: list[tuple[str, str]] = [
    ("companies", "company"),
    ("vessels", "vessel"),
    ("imo_numbers", "imo"),
    ("shipowners", "company"),
    ("operators", "company"),
    ("charterers", "company"),
    ("insurers", "insurer"),
    ("pi_clubs", "pi_club"),
    ("brokers", "broker"),
    ("regulators", "regulator"),
    ("ports", "port"),
    ("shipyards", "shipyard"),
    ("countries", "country"),
]


def build_search_text(analysis: AnalysisResult) -> str:
    parts: list[str] = [analysis.headline, analysis.summary or ""]
    for field, _ in _ENTITY_FIELDS:
        parts.extend(getattr(analysis.entities, field))
    parts.extend([analysis.update_type, analysis.vessel_type])
    if analysis.region:
        parts.append(analysis.region)
    if analysis.country:
        parts.append(analysis.country)
    return " ".join(p for p in parts if p).lower()


async def upsert_entities(
    session: AsyncSession, item: IntelligenceItem, analysis: AnalysisResult
) -> None:
    seen: set[tuple[str, str]] = set()
    for field, entity_type in _ENTITY_FIELDS:
        for name in getattr(analysis.entities, field):
            name = name.strip()
            if not name:
                continue
            normalized = name.lower()
            if (normalized, entity_type) in seen:
                continue
            seen.add((normalized, entity_type))
            entity = await session.scalar(
                select(Entity).where(
                    Entity.normalized_name == normalized, Entity.entity_type == entity_type
                )
            )
            if entity is None:
                entity = Entity(name=name, normalized_name=normalized, entity_type=entity_type)
                session.add(entity)
                await session.flush()
            else:
                entity.mention_count += 1
            session.add(
                IntelligenceItemEntity(intelligence_item_id=item.id, entity_id=entity.id)
            )


async def create_intelligence_item(
    session: AsyncSession,
    analysis: AnalysisResult,
    raw_item: RawItem,
    source: Source,
    materiality: str,
) -> IntelligenceItem:
    group = await create_group(session, analysis.event_key, source, raw_item.published_at)
    entities = analysis.entities
    item = IntelligenceItem(
        publication_date=as_utc(raw_item.published_at),
        source_name=source.name,
        source_url=raw_item.url,
        all_source_urls=[_source_entry(source, raw_item)],
        headline=analysis.headline,
        original_language=analysis.original_language or raw_item.language,
        region=analysis.region,
        country=analysis.country,
        sector=analysis.sector,
        vessel_type=analysis.vessel_type,
        update_type=analysis.update_type,
        companies_mentioned=entities.companies,
        vessels_mentioned=entities.vessels,
        imo_numbers=entities.imo_numbers,
        shipowners=entities.shipowners,
        operators=entities.operators,
        charterers=entities.charterers,
        insurers=sorted(set(entities.insurers) | set(entities.pi_clubs)),
        brokers=entities.brokers,
        regulators=entities.regulators,
        ports=entities.ports,
        shipyards=entities.shipyards,
        key_facts=analysis.key_facts,
        summary=analysis.summary,
        why_it_matters=analysis.why_it_matters,
        impact_on_oil_transportation=analysis.impact_on_oil_transportation,
        impact_on_pi=analysis.insurance_implications.pi,
        impact_on_hm=analysis.insurance_implications.hm,
        impact_on_war_risk=analysis.insurance_implications.war_risk,
        sanctions_or_compliance_implications=analysis.sanctions_compliance_implications,
        practical_business_implications=analysis.practical_business_implications,
        recommended_review_points=analysis.recommended_review_points,
        report_tables=[t.model_dump() for t in analysis.report_tables],
        materiality=materiality,
        confidence=analysis.confidence,
        classification=analysis.classification,
        duplicate_group_id=group.id,
        primary_raw_item_id=raw_item.id,
        search_text=build_search_text(analysis),
    )
    session.add(item)
    await session.flush()
    await upsert_entities(session, item, analysis)
    return item
