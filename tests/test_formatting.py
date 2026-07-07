from datetime import datetime, timezone

from app.bot.formatting import (
    chunk_message,
    high_alert_message,
    high_item_block,
    items_list_message,
    vessel_type_label,
)
from app.db.models import IntelligenceItem


def _item(**overrides) -> IntelligenceItem:
    defaults = dict(
        publication_date=datetime(2026, 7, 7, 9, 0, tzinfo=timezone.utc),
        detected_at=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc),
        source_name="OFAC",
        source_url="https://ofac.gov/action",
        all_source_urls=[
            {"name": "OFAC", "url": "https://ofac.gov/action", "authority_rank": 1},
            {"name": "Trade Press", "url": "https://press.com/1", "authority_rank": 3},
        ],
        headline="OFAC designates <shadow> fleet tankers",
        vessel_type="Suezmax",
        update_type="sanctions",
        summary="Summary.",
        why_it_matters="Vessels lose insurance cover.",
        impact_on_pi="P&I cover ceases",
        impact_on_hm="not available in source",
        impact_on_war_risk="War risk premiums may rise",
        sanctions_or_compliance_implications="Screen counterparties.",
        recommended_review_points=["Check SDN list", "Review charter parties"],
        materiality="High",
        confidence="High",
        classification="Official legal/regulatory information",
        publication_ready_ru=False,
    )
    defaults.update(overrides)
    return IntelligenceItem(**defaults)


def _item_ru(**overrides) -> IntelligenceItem:
    ru = dict(
        publication_ready_ru=True,
        headline_ru="OFAC вносит танкеры <теневого> флота в санкционный список",
        summary_ru="Краткое содержание.",
        why_it_matters_ru="Суда теряют страховое покрытие P&I.",
        impact_on_pi_ru="Покрытие P&I прекращается",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="Премии War Risk могут вырасти",
        sanctions_or_compliance_implications_ru="Проверить контрагентов по списку SDN.",
        recommended_review_points_ru=["Проверить список SDN", "Проверить чартеры"],
    )
    ru.update(overrides)
    return _item(**ru)


def test_high_alert_russian_template_sections():
    text = high_alert_message(_item_ru())
    for section in (
        "ВАЖНОЕ ОБНОВЛЕНИЕ", "Тема:", "Категория:", "Тип судна:", "Источник:",
        "Дата:", "Уровень существенности:", "Уровень уверенности:",
        "Классификация:", "Почему это важно:", "Влияние на страхование:",
        "Санкционные / compliance implications:", "Что проверить:", "Источники:",
    ):
        assert section in text, f"missing {section}"
    # Russian publication fields are used by default
    assert "теневого" in text
    assert "официальная правовая/регуляторная информация" in text
    # Category localized, vessel class and abbreviations stay in English
    assert "Санкции" in text
    assert "Suezmax" in text
    assert "P&amp;I: Покрытие P&amp;I прекращается" in text  # HTML-escaped for Telegram
    # 'не указано в источнике' H&M line filtered out of insurance block
    assert "H&M: не указано" not in text
    # Both source links preserved
    assert "https://ofac.gov/action" in text and "https://press.com/1" in text


def test_high_alert_falls_back_to_english_fields():
    text = high_alert_message(_item())  # publication_ready_ru=False
    assert "ВАЖНОЕ ОБНОВЛЕНИЕ" in text  # template stays Russian
    assert "Vessels lose insurance cover." in text  # content falls back to EN
    assert "&lt;shadow&gt;" in text


def test_alert_fits_telegram_limit():
    assert len(high_alert_message(_item_ru())) < 4096


def test_list_message_russian_default():
    assert "Обновлений не найдено" in items_list_message("Последние обновления", [])
    message = items_list_message("Последние обновления", [_item_ru()])
    assert "теневого" in message  # Russian headline used
    assert "Санкции" in message
    assert "июл 2026" in message  # Russian month in dates


def test_high_block_russian():
    block = high_item_block(_item_ru())
    assert "Почему это важно:" in block
    assert "Проверить список SDN" in block
    assert "ofac.gov" in block


def test_vessel_type_labels():
    assert vessel_type_label("VLCC") == "VLCC"
    assert vessel_type_label("Product Tanker") == "Product Tanker"
    assert vessel_type_label("Unknown") == "неизвестно"


def test_chunking_respects_limit_and_preserves_content():
    long_text = "\n".join(f"line {i} " + "x" * 80 for i in range(200))
    chunks = chunk_message(long_text, limit=4000)
    assert all(len(c) <= 4000 for c in chunks)
    assert "\n".join(chunks) == long_text
