"""Shared report machinery: item digests, LLM composition, summary extraction."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.analyzer import load_prompt
from app.ai.client import get_llm_client
from app.config import get_settings
from app.db.models import IntelligenceItem, Report

log = logging.getLogger(__name__)

_MATERIALITY_ORDER = {"High": 0, "Medium": 1, "Low": 2}


def _local_date(dt: datetime | None) -> str:
    if dt is None:
        return "n/a"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(get_settings().tz).strftime("%Y-%m-%d")


async def items_in_period(
    session: AsyncSession, start: datetime, end: datetime, limit: int
) -> list[IntelligenceItem]:
    stmt = (
        select(IntelligenceItem)
        .where(IntelligenceItem.detected_at >= start, IntelligenceItem.detected_at < end)
        .order_by(
            func.coalesce(IntelligenceItem.publication_date, IntelligenceItem.detected_at).desc()
        )
        .limit(limit * 3)
    )
    items = list((await session.scalars(stmt)).all())
    items.sort(
        key=lambda i: (_MATERIALITY_ORDER.get(i.materiality, 3), -(i.id or 0))
    )
    return items[:limit]


def digest_for_llm(items: list[IntelligenceItem]) -> str:
    """Bounded JSON digest of structured items — the ONLY factual input the
    report prompt receives, so every report claim traces to stored intelligence."""
    payload = []
    for item in items:
        payload.append(
            {
                "date": _local_date(item.publication_date or item.detected_at),
                "headline": item.headline,
                "category": item.update_type,
                "vessel_type": item.vessel_type,
                "materiality": item.materiality,
                "confidence": item.confidence,
                "classification": item.classification,
                "summary": item.summary,
                "key_facts": (item.key_facts or [])[:6],
                "why_it_matters": item.why_it_matters,
                "impact_on_oil_transportation": item.impact_on_oil_transportation,
                "impact_on_pi": item.impact_on_pi,
                "impact_on_hm": item.impact_on_hm,
                "impact_on_war_risk": item.impact_on_war_risk,
                "sanctions_compliance": item.sanctions_or_compliance_implications,
                "practical_implications": item.practical_business_implications,
                "review_points": (item.recommended_review_points or [])[:4],
                "region": item.region,
                "country": item.country,
                "source": item.source_name,
                "url": item.source_url,
                "extra_sources": [
                    {"name": s.get("name"), "url": s.get("url")}
                    for s in (item.all_source_urls or [])[1:4]
                ],
                "tables": (item.report_tables or [])[:2],
            }
        )
    return json.dumps(payload, ensure_ascii=False)


def extract_executive_summary(markdown: str, fallback_title: str) -> str:
    """Pull the executive-summary section (## 1., any language) out of the
    report for the concise Telegram message (summary first, full report as
    attachment)."""
    match = re.search(
        r"##\s*1\.?[^\n]*\n(.*?)(?=\n##\s|\Z)",
        markdown,
        re.DOTALL | re.IGNORECASE,
    )
    body = match.group(1).strip() if match else ""
    if not body:
        body = "\n".join(markdown.splitlines()[:12]).strip()
    # Markdown bullets render fine as plain text in Telegram.
    return f"<b>{fallback_title}</b>\n\n{_html_escape(body)}"


def _html_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


EMPTY_PERIOD_TEMPLATE_EN = (
    "# {title} — {date}\n\n"
    "## 1. Executive Summary\n"
    "- No material intelligence items were detected in the reporting period.\n\n"
    "All monitored source categories (sanctions, marine insurance, tanker market, "
    "shipbuilding, ports and routes) were checked; no items met relevance and "
    "materiality thresholds.\n"
)

EMPTY_PERIOD_TEMPLATE_RU = (
    "# {title_ru} — {date}\n\n"
    "## 1. Резюме\n"
    "- За отчетный период существенных обновлений не выявлено.\n\n"
    "Все отслеживаемые категории источников (санкции, морское страхование, рынок "
    "танкеров, судостроение, порты и маршруты) проверены; обновлений, отвечающих "
    "критериям релевантности и существенности, не обнаружено.\n"
)

REPORT_TITLE_RU = {
    "Daily Intelligence Brief": "Ежедневная аналитическая сводка",
    "Weekly Analytical Report": "Еженедельный аналитический отчет",
}


async def compose_report(
    session: AsyncSession,
    report_type: str,
    prompt_file: str,
    title: str,
    start: datetime,
    end: datetime,
    max_items: int,
) -> Report:
    settings = get_settings()
    items = await items_in_period(session, start, end, max_items)
    end_local = end.astimezone(settings.tz).strftime("%Y-%m-%d")
    title_ru = REPORT_TITLE_RU.get(title, title)
    languages = ["en"]

    if not items:
        content_en = EMPTY_PERIOD_TEMPLATE_EN.format(title=title, date=end_local)
        content_ru = EMPTY_PERIOD_TEMPLATE_RU.format(title_ru=title_ru, date=end_local)
        languages.append("ru")
    else:
        system = load_prompt(prompt_file).replace("{date}", end_local)
        user = (
            f"Reporting period: {start.astimezone(settings.tz):%Y-%m-%d %H:%M} to "
            f"{end.astimezone(settings.tz):%Y-%m-%d %H:%M} ({settings.app_timezone}).\n"
            f"Intelligence items (JSON):\n{digest_for_llm(items)}"
        )
        content_en = await get_llm_client().text(system, user, model=settings.report_model)

        # Russian publication version — the default delivery language.
        from app.ai.translator import translate_report_markdown

        content_ru = None
        try:
            content_ru = await translate_report_markdown(
                get_llm_client(), content_en, model=settings.report_model
            )
            languages.append("ru")
        except Exception as exc:  # noqa: BLE001 - fall back to English delivery
            log.warning("Russian report translation failed: %s", exc)

    report = Report(
        report_type=report_type,
        period_start=start,
        period_end=end,
        content_md_en=content_en,
        content_md_ru=content_ru,
        generated_language_versions=languages,
        telegram_summary=extract_executive_summary(content_en, f"{title} — {end_local}"),
        telegram_summary_ru=(
            extract_executive_summary(content_ru, f"{title_ru} — {end_local}")
            if content_ru
            else None
        ),
        item_count=len(items),
        status="generated",
    )
    session.add(report)
    await session.commit()
    log.info(
        "Generated %s report %s covering %d items (languages: %s)",
        report_type, report.id, len(items), ",".join(languages),
    )
    return report
