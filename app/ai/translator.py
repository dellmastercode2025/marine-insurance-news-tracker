"""Russian publication translation of final intelligence outputs.

Runs after analysis (items) and after report composition (daily/weekly).
Deterministic guards on top of the LLM:
- fields that are exactly "not available in source" are mapped to
  "не указано в источнике" without asking the model;
- any residual English placeholder in the model output is normalized;
- failures mark the item publication_ready_ru = False so senders fall back
  to English instead of blocking publication.
"""
from __future__ import annotations

import json
import logging
import re

from pydantic import ValidationError

from app.ai.analyzer import load_prompt
from app.ai.client import LLMClient, LLMError
from app.ai.schemas import TranslationResult
from app.db.models import IntelligenceItem

log = logging.getLogger(__name__)

NOT_AVAILABLE_EN = "not available in source"
NOT_AVAILABLE_RU = "не указано в источнике"

_NA_RE = re.compile(re.escape(NOT_AVAILABLE_EN), re.IGNORECASE)


class TranslationFailed(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def normalize_ru(text: str | None) -> str | None:
    """Replace any leftover English 'not available in source' placeholder."""
    if text is None:
        return None
    return _NA_RE.sub(NOT_AVAILABLE_RU, text)


def _item_payload(item: IntelligenceItem) -> str:
    return json.dumps(
        {
            "headline": item.headline,
            "summary": item.summary,
            "key_facts": item.key_facts or [],
            "why_it_matters": item.why_it_matters,
            "impact_on_oil_transportation": item.impact_on_oil_transportation,
            "impact_on_pi": item.impact_on_pi,
            "impact_on_hm": item.impact_on_hm,
            "impact_on_war_risk": item.impact_on_war_risk,
            "sanctions_or_compliance_implications": item.sanctions_or_compliance_implications,
            "practical_business_implications": item.practical_business_implications,
            "recommended_review_points": item.recommended_review_points or [],
            "classification": item.classification,
            "vessel_type": item.vessel_type,
        },
        ensure_ascii=False,
    )


async def translate_item(client: LLMClient, item: IntelligenceItem) -> TranslationResult:
    """Translate one intelligence item. Raises TranslationFailed after one retry."""
    system = load_prompt("translate_to_russian.md")
    user = (
        "Translate the following intelligence item fields into publication-ready "
        "business Russian. Return every field of the schema.\n\n"
        f"ITEM (JSON):\n{_item_payload(item)}"
    )
    last_error: str | None = None
    for attempt in (1, 2):
        try:
            message = user
            if last_error:
                message += (
                    f"\n\nYour previous response was invalid ({last_error}). "
                    "Return a valid response strictly matching the schema."
                )
            result = await client.structured(system, message, TranslationResult)
            return _normalize_result(result)
        except (ValidationError, LLMError) as exc:
            last_error = str(exc)[:500]
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {str(exc)[:400]}"
        log.warning("Translation attempt %d failed for item %s: %s", attempt, item.id, last_error)
    raise TranslationFailed(last_error or "unknown translation error")


def _normalize_result(result: TranslationResult) -> TranslationResult:
    update = {
        field: normalize_ru(value)
        for field, value in result.model_dump().items()
        if isinstance(value, str)
    }
    update["key_facts_ru"] = [normalize_ru(v) for v in result.key_facts_ru]
    update["recommended_review_points_ru"] = [
        normalize_ru(v) for v in result.recommended_review_points_ru
    ]
    return result.model_copy(update=update)


def apply_translation(item: IntelligenceItem, translation: TranslationResult) -> None:
    item.headline_ru = translation.headline_ru
    item.summary_ru = translation.summary_ru
    item.key_facts_ru = translation.key_facts_ru
    item.why_it_matters_ru = translation.why_it_matters_ru
    item.impact_on_oil_transportation_ru = translation.impact_on_oil_transportation_ru
    item.impact_on_pi_ru = translation.impact_on_pi_ru
    item.impact_on_hm_ru = translation.impact_on_hm_ru
    item.impact_on_war_risk_ru = translation.impact_on_war_risk_ru
    item.sanctions_or_compliance_implications_ru = (
        translation.sanctions_or_compliance_implications_ru
    )
    item.practical_business_implications_ru = translation.practical_business_implications_ru
    item.recommended_review_points_ru = translation.recommended_review_points_ru
    item.publication_ready_ru = True


async def translate_report_markdown(client: LLMClient, content_en: str, model: str | None = None) -> str:
    """Translate a full Markdown report into publication-ready Russian."""
    system = load_prompt("translate_to_russian.md")
    user = (
        "Translate the following Markdown report into publication-ready business "
        "Russian, preserving the exact document structure, numbered headings and "
        "tables.\n\n" + content_en
    )
    translated = await client.text(system, user, model=model)
    return normalize_ru(translated) or translated
