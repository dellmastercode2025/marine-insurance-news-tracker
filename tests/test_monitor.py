"""End-to-end pipeline test with faked fetchers and LLM: ingest → prefilter →
analyze → dedup → materiality → store → alert-once."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.pipeline.monitor as monitor
from app.ai.client import set_llm_client
from app.db.models import Base, IntelligenceItem, RawItem, Source
from app.sources.base import FetchedEntry

from tests.conftest import FakeLLM, make_analysis


@pytest.fixture
async def factory():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


ENTRIES = [
    FetchedEntry(
        title="Samsung Heavy wins order for LNG carriers",
        url="https://news.example.com/lng-order",
        summary="Six LNG carriers ordered.",
        published_at=datetime(2026, 7, 7, 8, 0, tzinfo=timezone.utc),
    ),
    FetchedEntry(
        title="OFAC designates shadow fleet Suezmax tankers",
        url="https://news.example.com/ofac-tankers",
        summary="Five Suezmax crude oil tankers added to the SDN list.",
        published_at=datetime(2026, 7, 7, 9, 0, tzinfo=timezone.utc),
    ),
    FetchedEntry(
        title="OFAC designates shadow fleet Suezmax tankers",  # same event, other outlet
        url="https://other.example.com/sanctions-tankers",
        summary="Treasury sanctions five tankers.",
        published_at=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc),
    ),
]


async def test_full_monitoring_run(factory, monkeypatch):
    async with factory() as setup_session:
        setup_session.add(
            Source(
                name="Feed", slug="feed", url="https://news.example.com",
                feed_url="https://news.example.com/rss", fetch_method="rss",
                category="sanctions", authority_rank=1,
            )
        )
        await setup_session.commit()

    monkeypatch.setattr(monitor, "get_session_factory", lambda: factory)

    async def fake_fetch(client, robots, source, limit):
        return ENTRIES

    monkeypatch.setattr(monitor, "_fetch_source", fake_fetch)

    # Analysis is official sanctions -> materiality floor raises Medium to High.
    fake_llm = FakeLLM(results=[make_analysis(materiality="Medium")])
    set_llm_client(fake_llm)

    alerts_sent: list[int] = []

    async def alert_callback(session, item) -> int:
        alerts_sent.append(item.id)
        return 1

    try:
        run = await monitor.run_monitoring(trigger="manual", alert_callback=alert_callback)
    finally:
        set_llm_client(None)

    assert run.status == "success"
    assert run.items_new == 3
    assert run.items_prefiltered_out == 1  # LNG item never reaches the LLM
    assert fake_llm.structured_calls == 1  # duplicate merged without a second call
    assert fake_llm.translation_calls == 1  # LNG/duplicate never reach translation
    assert run.items_high == 1
    assert run.alerts_sent == 1
    assert len(alerts_sent) == 1

    async with factory() as session:
        item = await session.scalar(select(IntelligenceItem))
        assert item.materiality == "High"
        assert len(item.all_source_urls) == 2  # both outlets preserved
        # Russian publication version generated in the pipeline
        assert item.publication_ready_ru is True
        assert item.headline_ru and "Suezmax" in item.headline_ru
        assert item.summary_ru
        assert item.impact_on_hm_ru == "не указано в источнике"
        statuses = dict(
            (await session.execute(select(RawItem.url, RawItem.status))).all()
        )
        assert statuses["https://news.example.com/lng-order"] == "prefiltered_out"
        assert statuses["https://news.example.com/ofac-tankers"] == "analyzed"
        assert statuses["https://other.example.com/sanctions-tankers"] == "merged"

    # Second run with identical feed content: nothing new, no repeat alerts.
    fake_llm2 = FakeLLM()
    set_llm_client(fake_llm2)
    try:
        run2 = await monitor.run_monitoring(trigger="manual", alert_callback=alert_callback)
    finally:
        set_llm_client(None)
    assert run2.items_new == 0
    assert run2.alerts_sent == 0
    assert fake_llm2.structured_calls == 0
    assert fake_llm2.translation_calls == 0
    assert len(alerts_sent) == 1

    async with factory() as session:
        count = await session.scalar(select(func.count(IntelligenceItem.id)))
        assert count == 1
