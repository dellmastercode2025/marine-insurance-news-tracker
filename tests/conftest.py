from __future__ import annotations

from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ai.client import LLMClient
from app.ai.schemas import AnalysisResult, EntityBundle, InsuranceImplications
from app.db.models import Base, RawItem, Source
from app.pipeline.normalize import normalize_title, sha256_hex, simhash64


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def make_analysis(**overrides) -> AnalysisResult:
    """Factory for a valid AnalysisResult; override any field per test."""
    defaults = dict(
        is_relevant=True,
        rejection_reason=None,
        headline="OFAC designates shadow fleet Suezmax tankers",
        summary="OFAC added five Suezmax tankers to the SDN list for price-cap violations.",
        key_facts=["Five Suezmax tankers designated", "Price cap violation cited"],
        update_type="sanctions",
        vessel_type="Suezmax",
        region="Black Sea",
        country="United States",
        sector="Oil transportation",
        original_language="en",
        materiality="Medium",
        confidence="Medium",
        classification="Official legal/regulatory information",
        entities=EntityBundle(
            companies=["Example Shipping Ltd"],
            vessels=["OCEAN STAR"],
            imo_numbers=["9312345"],
            shipowners=["Example Shipping Ltd"],
            operators=[],
            charterers=[],
            insurers=[],
            pi_clubs=[],
            brokers=[],
            regulators=["OFAC"],
            ports=[],
            shipyards=[],
            countries=["United States"],
        ),
        why_it_matters="Designated vessels lose access to Western insurance and services.",
        impact_on_oil_transportation="Reduces available Suezmax capacity for sanctioned trades.",
        insurance_implications=InsuranceImplications(
            pi="P&I cover ceases for designated vessels",
            hm="not available in source",
            war_risk="not available in source",
            cargo="not available in source",
        ),
        sanctions_compliance_implications="Counterparty screening required against new SDN entries.",
        practical_business_implications="Charterers must verify vessel status before fixing.",
        recommended_review_points=["Screen fleet lists against new SDN entries"],
        report_tables=[],
        event_key="ofac-designation-suezmax-shadow-fleet-2026-07",
    )
    defaults.update(overrides)
    return AnalysisResult(**defaults)


class FakeLLM(LLMClient):
    """Deterministic fake: returns queued results or raises queued exceptions."""

    def __init__(self, results=None, text_result: str = "# Report\n\n## 1. Executive Summary\n- ok"):
        self.results = list(results or [])
        self.text_result = text_result
        self.structured_calls = 0
        self.text_calls = 0

    async def structured(self, system, user, output_model, model=None):
        self.structured_calls += 1
        if not self.results:
            return make_analysis()
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def text(self, system, user, model=None):
        self.text_calls += 1
        return self.text_result


def make_source(**overrides) -> Source:
    defaults = dict(
        name="Test Source",
        slug="test-source",
        url="https://example.com/news",
        feed_url="https://example.com/feed",
        fetch_method="rss",
        category="market",
        authority_rank=3,
        language="en",
    )
    defaults.update(overrides)
    return Source(**defaults)


def make_raw_item(source: Source, title: str, url: str, **overrides) -> RawItem:
    norm = normalize_title(title)
    defaults = dict(
        source_id=source.id,
        url=url,
        canonical_url_hash=sha256_hex(url),
        title=title,
        title_norm_hash=sha256_hex(norm),
        title_simhash=str(simhash64(norm)),
        snippet="Test snippet about oil tankers.",
        published_at=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc),
        language="en",
    )
    defaults.update(overrides)
    return RawItem(**defaults)
