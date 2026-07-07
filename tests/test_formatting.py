from datetime import datetime, timezone

from app.bot.formatting import (
    chunk_message,
    high_alert_message,
    high_item_block,
    items_list_message,
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
    )
    defaults.update(overrides)
    return IntelligenceItem(**defaults)


def test_high_alert_contains_required_sections():
    text = high_alert_message(_item())
    for section in (
        "HIGH MATERIALITY ALERT", "Title:", "Category:", "Vessel type:", "Source:",
        "Date:", "Confidence:", "Classification:", "Why it matters:",
        "Insurance implications:", "Sanctions/compliance implications:",
        "Recommended review:", "Sources:",
    ):
        assert section in text, f"missing {section}"
    # HTML-escaped headline
    assert "&lt;shadow&gt;" in text
    # Both source links preserved
    assert "https://ofac.gov/action" in text and "https://press.com/1" in text
    # 'not available in source' H&M line filtered out of insurance block
    assert "H&M: not available" not in text
    assert "P&amp;I cover ceases" in text or "P&I cover ceases" in text


def test_alert_fits_telegram_limit():
    assert len(high_alert_message(_item())) < 4096


def test_list_message_and_empty_state():
    assert "No items found" in items_list_message("Latest", [])
    message = items_list_message("Latest", [_item()])
    assert "OFAC" in message and "Sanctions" in message


def test_high_block_has_review_point_and_source():
    block = high_item_block(_item())
    assert "Why it matters:" in block
    assert "Check SDN list" in block
    assert "ofac.gov" in block


def test_chunking_respects_limit_and_preserves_content():
    long_text = "\n".join(f"line {i} " + "x" * 80 for i in range(200))
    chunks = chunk_message(long_text, limit=4000)
    assert all(len(c) <= 4000 for c in chunks)
    assert "\n".join(chunks) == long_text
