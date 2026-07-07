"""Russian publication layer: translation, guards, report versions."""
from datetime import datetime, timedelta, timezone

import pytest

from app.ai.client import LLMError, set_llm_client
from app.ai.translator import (
    NOT_AVAILABLE_RU,
    TranslationFailed,
    apply_translation,
    normalize_ru,
    translate_item,
)
from app.db.models import IntelligenceItem
from app.reports.daily import generate_daily_report
from app.pipeline.store import create_intelligence_item

from tests.conftest import FakeLLM, make_analysis, make_raw_item, make_source, make_translation


def test_normalize_ru_replaces_placeholder():
    assert normalize_ru("not available in source") == NOT_AVAILABLE_RU
    assert normalize_ru("Not Available In Source") == NOT_AVAILABLE_RU
    assert normalize_ru("P&I: not available in source.") == f"P&I: {NOT_AVAILABLE_RU}."
    assert normalize_ru("уже по-русски") == "уже по-русски"
    assert normalize_ru(None) is None


def test_translation_result_preserves_abbreviations():
    translation = make_translation()
    text = " ".join(
        [translation.headline_ru, translation.summary_ru, translation.impact_on_pi_ru]
    )
    assert "Suezmax" in text
    assert "SDN" in translation.sanctions_or_compliance_implications_ru
    assert "P&I" in translation.impact_on_pi_ru


async def test_translate_item_normalizes_residual_placeholders(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "Test", "https://x.com/tr1")
    session.add(raw)
    await session.flush()
    item = await create_intelligence_item(session, make_analysis(), raw, source, "High")

    # Model left an English placeholder in one field — the guard fixes it.
    fake = FakeLLM(
        translation_results=[make_translation(impact_on_war_risk_ru="not available in source")]
    )
    translation = await translate_item(fake, item)
    assert translation.impact_on_war_risk_ru == NOT_AVAILABLE_RU


async def test_apply_translation_sets_fields_and_flag(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "Test", "https://x.com/tr2")
    session.add(raw)
    await session.flush()
    item = await create_intelligence_item(session, make_analysis(), raw, source, "High")
    assert item.publication_ready_ru is False

    apply_translation(item, make_translation())
    assert item.publication_ready_ru is True
    assert item.headline_ru.startswith("OFAC")
    assert item.summary_ru
    assert item.recommended_review_points_ru
    assert item.impact_on_hm_ru == NOT_AVAILABLE_RU


async def test_translate_item_fails_after_two_attempts(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "Test", "https://x.com/tr3")
    session.add(raw)
    await session.flush()
    item = await create_intelligence_item(session, make_analysis(), raw, source, "High")

    fake = FakeLLM(translation_results=[LLMError("bad"), LLMError("bad again")])
    with pytest.raises(TranslationFailed):
        await translate_item(fake, item)
    assert fake.translation_calls == 2


async def test_report_has_both_language_versions(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "Test", "https://x.com/tr4")
    session.add(raw)
    await session.flush()
    item = await create_intelligence_item(session, make_analysis(), raw, source, "High")
    item.detected_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await session.commit()

    fake = FakeLLM(text_result="# Отчет\n\n## 1. Резюме\n- пункт один\n\n## 2. Дальше\n...")
    set_llm_client(fake)
    try:
        report = await generate_daily_report(session)
    finally:
        set_llm_client(None)

    assert fake.text_calls == 2  # compose EN + translate RU
    assert report.content_md_en
    assert report.content_md_ru
    assert report.generated_language_versions == ["en", "ru"]
    assert report.publication_language == "ru"
    # Telegram summary extracted from the ## 1. section of the RU version
    assert "пункт один" in report.telegram_summary_ru
    assert report.publication_summary == report.telegram_summary_ru


async def test_empty_period_report_is_russian_without_llm(session):
    fake = FakeLLM()
    set_llm_client(fake)
    try:
        report = await generate_daily_report(session)
    finally:
        set_llm_client(None)
    assert fake.text_calls == 0  # no items -> static templates, no LLM cost
    assert "Резюме" in report.content_md_ru
    assert "существенных обновлений не выявлено" in report.content_md_ru
    assert report.generated_language_versions == ["en", "ru"]
