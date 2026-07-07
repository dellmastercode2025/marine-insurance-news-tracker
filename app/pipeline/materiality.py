"""Deterministic materiality/confidence rules layered on top of AI scoring.

The LLM proposes materiality and confidence; these rules enforce the
requirements' floors (e.g. official sanctions actions are always High) and
apply the multi-source confidence boost during deduplication.
"""
from __future__ import annotations

import re

from app.ai.schemas import AnalysisResult

_LEVELS = ["Low", "Medium", "High"]

_HIGH_FLOOR_HEADLINE = re.compile(
    r"enforcement|designat|sdn|general licen[cs]e|exemption|embargo|seiz|detain|price cap",
    re.IGNORECASE,
)


def _at_least(level: str, floor: str) -> str:
    return floor if _LEVELS.index(level) < _LEVELS.index(floor) else level


def apply_materiality_rules(analysis: AnalysisResult) -> str:
    """Return final materiality after enforcing rule floors."""
    materiality = analysis.materiality
    official = analysis.classification == "Official legal/regulatory information"

    # Official sanctions/regulatory actions affecting oil shipping -> High.
    if analysis.update_type in ("sanctions", "regulation") and official:
        materiality = _at_least(materiality, "High")

    # War risk insurance changes -> High.
    if analysis.update_type == "war_risk":
        materiality = _at_least(materiality, "High")

    # Official P&I club circulars affecting tanker operations -> High.
    if analysis.update_type == "pi" and official:
        materiality = _at_least(materiality, "High")

    # Enforcement/designation/license vocabulary in confirmed-or-better items.
    if (
        analysis.classification in ("Official legal/regulatory information", "Confirmed fact")
        and _HIGH_FLOOR_HEADLINE.search(f"{analysis.headline} {analysis.summary}")
        and analysis.update_type in ("sanctions", "regulation", "geopolitical")
    ):
        materiality = _at_least(materiality, "High")

    # Rumors never rate High regardless of topic.
    if analysis.classification == "Rumor or unverified":
        materiality = "Medium" if materiality == "High" else materiality

    return materiality


def boost_confidence(current: str) -> str:
    """Raise confidence one level (multi-source confirmation)."""
    index = _LEVELS.index(current)
    return _LEVELS[min(index + 1, len(_LEVELS) - 1)]
