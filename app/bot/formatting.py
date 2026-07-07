"""Telegram message formatting (HTML parse mode).

Style requirements: concise, structured, no long unstructured messages.
Full report tables live in the Markdown report document; Telegram gets
compact summaries.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from app.config import get_settings
from app.db.models import IntelligenceItem

MATERIALITY_ICON = {"High": "🔴", "Medium": "🟠", "Low": "⚪"}

UPDATE_TYPE_LABEL = {
    "sanctions": "Sanctions",
    "insurance": "Insurance",
    "pi": "P&I",
    "hm": "H&M",
    "war_risk": "War Risk",
    "tanker_market": "Tanker Market",
    "freight": "Freight",
    "shipbuilding": "Shipbuilding",
    "port": "Port",
    "route": "Route",
    "geopolitical": "Geopolitical",
    "regulation": "Regulation",
}

CLASSIFICATION_SHORT = {
    "Official legal/regulatory information": "Official",
    "Confirmed fact": "Confirmed",
    "Market interpretation": "Interpretation",
    "Assumption": "Assumption",
    "Rumor or unverified": "Unverified",
}


def local_date(dt: datetime | None) -> str:
    if dt is None:
        return "n/a"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(get_settings().tz).strftime("%d %b %Y")


def local_datetime(dt: datetime | None) -> str:
    if dt is None:
        return "n/a"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    tz = get_settings().tz
    return dt.astimezone(tz).strftime("%d %b %Y %H:%M") + f" ({get_settings().app_timezone})"


def item_line(item: IntelligenceItem) -> str:
    """One compact line per item for list commands (/latest etc.)."""
    icon = MATERIALITY_ICON.get(item.materiality, "⚪")
    category = UPDATE_TYPE_LABEL.get(item.update_type, item.update_type)
    return (
        f"{icon} <b>{escape(item.headline)}</b>\n"
        f"    {local_date(item.publication_date)} · {escape(category)} · "
        f"<a href=\"{escape(item.source_url)}\">{escape(item.source_name)}</a>"
    )


def items_list_message(title: str, items: list[IntelligenceItem]) -> str:
    if not items:
        return f"<b>{escape(title)}</b>\n\nNo items found."
    lines = [f"<b>{escape(title)}</b>", ""]
    for item in items:
        lines.append(item_line(item))
        lines.append("")
    return "\n".join(lines).strip()


def high_item_block(item: IntelligenceItem) -> str:
    """Richer block for /high: why it matters + practical review + source."""
    review = (item.recommended_review_points or ["not available in source"])[0]
    category = UPDATE_TYPE_LABEL.get(item.update_type, item.update_type)
    return (
        f"🔴 <b>{escape(item.headline)}</b>\n"
        f"{local_date(item.publication_date)} · {escape(category)} · {escape(item.vessel_type)}\n"
        f"<b>Why it matters:</b> {escape(item.why_it_matters or 'not available in source')}\n"
        f"<b>Review:</b> {escape(review)}\n"
        f"<a href=\"{escape(item.source_url)}\">{escape(item.source_name)}</a>"
    )


def _sources_block(item: IntelligenceItem) -> str:
    links = item.all_source_urls or []
    if not links:
        return f'<a href="{escape(item.source_url)}">{escape(item.source_name)}</a>'
    return "\n".join(
        f'• <a href="{escape(link["url"])}">{escape(link.get("name") or link["url"])}</a>'
        for link in links[:6]
    )


def high_alert_message(item: IntelligenceItem) -> str:
    """The exact high-materiality alert format from the requirements."""
    insurance_bits = []
    for label, value in (
        ("P&I", item.impact_on_pi),
        ("H&M", item.impact_on_hm),
        ("War Risk", item.impact_on_war_risk),
    ):
        if value and value.lower() != "not available in source":
            insurance_bits.append(f"{label}: {value}")
    insurance_text = "\n".join(insurance_bits) or "not available in source"

    review_points = item.recommended_review_points or []
    review_text = "\n".join(f"• {p}" for p in review_points[:5]) or "not available in source"

    category = UPDATE_TYPE_LABEL.get(item.update_type, item.update_type)
    classification = CLASSIFICATION_SHORT.get(item.classification, item.classification)

    return (
        "🚨 <b>HIGH MATERIALITY ALERT</b>\n\n"
        f"<b>Title:</b>\n{escape(item.headline)}\n\n"
        f"<b>Category:</b>\n{escape(category)}\n\n"
        f"<b>Vessel type:</b>\n{escape(item.vessel_type)}\n\n"
        f"<b>Source:</b>\n{escape(item.source_name)}\n\n"
        f"<b>Date:</b>\n{local_date(item.publication_date)}\n\n"
        f"<b>Confidence:</b>\n{escape(item.confidence)}\n\n"
        f"<b>Classification:</b>\n{escape(classification)}\n\n"
        f"<b>Why it matters:</b>\n{escape(item.why_it_matters or 'not available in source')}\n\n"
        f"<b>Insurance implications:</b>\n{escape(insurance_text)}\n\n"
        f"<b>Sanctions/compliance implications:</b>\n"
        f"{escape(item.sanctions_or_compliance_implications or 'not available in source')}\n\n"
        f"<b>Recommended review:</b>\n{escape(review_text)}\n\n"
        f"<b>Sources:</b>\n{_sources_block(item)}"
    )


def chunk_message(text: str, limit: int = 4000) -> list[str]:
    """Split long text on line boundaries below Telegram's 4096-char limit."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.split("\n"):
        if size + len(line) + 1 > limit and current:
            chunks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks
