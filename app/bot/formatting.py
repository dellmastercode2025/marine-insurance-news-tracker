"""Telegram message formatting (HTML parse mode).

Russian is the default publication language: all user-facing output uses the
item's Russian publication fields when publication_ready_ru is set, falling
back to English otherwise. Vessel classes and standard abbreviations
(VLCC, P&I, H&M, OFAC, …) stay in English; materiality/confidence levels stay
High/Medium/Low per the alert specification.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from app.config import get_settings
from app.db.models import IntelligenceItem

MATERIALITY_ICON = {"High": "🔴", "Medium": "🟠", "Low": "⚪"}

UPDATE_TYPE_LABEL_RU = {
    "sanctions": "Санкции",
    "insurance": "Страхование",
    "pi": "P&I",
    "hm": "H&M",
    "war_risk": "Военные риски",
    "tanker_market": "Рынок танкеров",
    "freight": "Фрахт",
    "shipbuilding": "Судостроение",
    "port": "Порт",
    "route": "Маршрут",
    "geopolitical": "Геополитика",
    "regulation": "Регулирование",
}

CLASSIFICATION_RU = {
    "Official legal/regulatory information": "официальная правовая/регуляторная информация",
    "Confirmed fact": "подтвержденный факт",
    "Market interpretation": "рыночная интерпретация",
    "Assumption": "допущение",
    "Rumor or unverified": "неподтвержденная информация",
}

_RU_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

NOT_AVAILABLE_RU = "не указано в источнике"


def vessel_type_label(vessel_type: str) -> str:
    """Vessel classes stay in English; only Unknown is localized."""
    return "неизвестно" if vessel_type == "Unknown" else vessel_type


def category_label(update_type: str) -> str:
    return UPDATE_TYPE_LABEL_RU.get(update_type, update_type)


def classification_label(classification: str) -> str:
    return CLASSIFICATION_RU.get(classification, classification)


def _to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(get_settings().tz)


def local_date(dt: datetime | None) -> str:
    if dt is None:
        return "н/д"
    local = _to_local(dt)
    return f"{local.day:02d} {_RU_MONTHS[local.month - 1]} {local.year}"


def local_datetime(dt: datetime | None) -> str:
    if dt is None:
        return "н/д"
    local = _to_local(dt)
    return (
        f"{local.day:02d} {_RU_MONTHS[local.month - 1]} {local.year} "
        f"{local.strftime('%H:%M')} ({get_settings().app_timezone})"
    )


# --- Russian publication field accessors (English fallback) -----------------

def pub_headline(item: IntelligenceItem) -> str:
    if item.publication_ready_ru and item.headline_ru:
        return item.headline_ru
    return item.headline


def pub_field(item: IntelligenceItem, field: str) -> str:
    """Return the Russian publication value for a text field, falling back to
    English, then to the 'not available' placeholder."""
    if item.publication_ready_ru:
        value_ru = getattr(item, f"{field}_ru", None)
        if value_ru:
            return value_ru
    return getattr(item, field, None) or NOT_AVAILABLE_RU


def pub_review_points(item: IntelligenceItem) -> list[str]:
    if item.publication_ready_ru and item.recommended_review_points_ru:
        return item.recommended_review_points_ru
    return item.recommended_review_points or []


# --- Messages ----------------------------------------------------------------

def item_line(item: IntelligenceItem) -> str:
    """One compact line per item for list commands (/latest etc.)."""
    icon = MATERIALITY_ICON.get(item.materiality, "⚪")
    return (
        f"{icon} <b>{escape(pub_headline(item))}</b>\n"
        f"    {local_date(item.publication_date)} · {escape(category_label(item.update_type))} · "
        f"<a href=\"{escape(item.source_url)}\">{escape(item.source_name)}</a>"
    )


def items_list_message(title: str, items: list[IntelligenceItem]) -> str:
    if not items:
        return f"<b>{escape(title)}</b>\n\nОбновлений не найдено."
    lines = [f"<b>{escape(title)}</b>", ""]
    for item in items:
        lines.append(item_line(item))
        lines.append("")
    return "\n".join(lines).strip()


def high_item_block(item: IntelligenceItem) -> str:
    """Richer block for /high: why it matters + practical review + source."""
    review_points = pub_review_points(item)
    review = review_points[0] if review_points else NOT_AVAILABLE_RU
    return (
        f"🔴 <b>{escape(pub_headline(item))}</b>\n"
        f"{local_date(item.publication_date)} · {escape(category_label(item.update_type))} · "
        f"{escape(vessel_type_label(item.vessel_type))}\n"
        f"<b>Почему это важно:</b> {escape(pub_field(item, 'why_it_matters'))}\n"
        f"<b>Проверить:</b> {escape(review)}\n"
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
    """High-materiality alert in Russian (publication language)."""
    insurance_bits = []
    for label, field in (("P&I", "impact_on_pi"), ("H&M", "impact_on_hm"),
                         ("War Risk", "impact_on_war_risk")):
        value = pub_field(item, field)
        if value.lower() not in (NOT_AVAILABLE_RU, "not available in source"):
            insurance_bits.append(f"{label}: {value}")
    insurance_text = "\n".join(insurance_bits) or NOT_AVAILABLE_RU

    review_points = pub_review_points(item)
    review_text = "\n".join(f"• {p}" for p in review_points[:5]) or NOT_AVAILABLE_RU

    return (
        "🚨 <b>ВАЖНОЕ ОБНОВЛЕНИЕ</b>\n\n"
        f"<b>Тема:</b>\n{escape(pub_headline(item))}\n\n"
        f"<b>Категория:</b>\n{escape(category_label(item.update_type))}\n\n"
        f"<b>Тип судна:</b>\n{escape(vessel_type_label(item.vessel_type))}\n\n"
        f"<b>Источник:</b>\n{escape(item.source_name)}\n\n"
        f"<b>Дата:</b>\n{local_date(item.publication_date)}\n\n"
        f"<b>Уровень существенности:</b>\n{escape(item.materiality)}\n\n"
        f"<b>Уровень уверенности:</b>\n{escape(item.confidence)}\n\n"
        f"<b>Классификация:</b>\n{escape(classification_label(item.classification))}\n\n"
        f"<b>Почему это важно:</b>\n{escape(pub_field(item, 'why_it_matters'))}\n\n"
        f"<b>Влияние на страхование:</b>\n{escape(insurance_text)}\n\n"
        f"<b>Санкционные / compliance implications:</b>\n"
        f"{escape(pub_field(item, 'sanctions_or_compliance_implications'))}\n\n"
        f"<b>Что проверить:</b>\n{escape(review_text)}\n\n"
        f"<b>Источники:</b>\n{_sources_block(item)}"
    )


def chunk_message(text: str, limit: int = 4000) -> list[str]:
    """Split long text on line boundaries below Telegram's 4096-char limit."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.split("\n"):
        while len(line) > limit:  # pathological single line — hard split
            if current:
                chunks.append("\n".join(current))
                current, size = [], 0
            chunks.append(line[:limit])
            line = line[limit:]
        if size + len(line) + 1 > limit and current:
            chunks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks
