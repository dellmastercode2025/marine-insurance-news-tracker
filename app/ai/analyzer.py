"""AI analysis of raw items → validated AnalysisResult.

Retry policy per requirements: if the structured output is malformed, retry
once; if still invalid, raise AnalysisFailed so the pipeline marks the raw
item analysis_failed and stores the error.
"""
from __future__ import annotations

import logging
from pathlib import Path

from pydantic import ValidationError

from app.ai.client import LLMClient, LLMError
from app.ai.schemas import AnalysisResult
from app.db.models import RawItem, Source

log = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


class AnalysisFailed(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def build_user_message(item: RawItem, source: Source) -> str:
    published = item.published_at.isoformat() if item.published_at else "not available in source"
    snippet = (item.snippet or "").strip() or "not available in source"
    return (
        f"SOURCE NAME: {source.name}\n"
        f"SOURCE CATEGORY: {source.category}\n"
        f"SOURCE AUTHORITY LEVEL: {source.authority_rank} (1=official regulator ... 5=aggregator)\n"
        f"PUBLICATION DATE: {published}\n"
        f"URL: {item.url}\n"
        f"TITLE: {item.title.strip()}\n"
        f"EXCERPT (may be truncated):\n{snippet}\n"
    )


async def analyze_raw_item(
    client: LLMClient, item: RawItem, source: Source
) -> AnalysisResult:
    """Analyze one raw item. Raises AnalysisFailed after one retry."""
    system = load_prompt("analyze_item.md")
    user = build_user_message(item, source)

    last_error: str | None = None
    for attempt in (1, 2):
        try:
            message = user
            if last_error:
                message += (
                    "\n\nYour previous response was invalid "
                    f"({last_error}). Return a valid response strictly matching the schema."
                )
            return await client.structured(system, message, AnalysisResult)
        except (ValidationError, LLMError) as exc:
            last_error = str(exc)[:500]
            log.warning("Analysis attempt %d failed for raw_item %s: %s", attempt, item.id, last_error)
        except Exception as exc:  # noqa: BLE001 - transport errors are also retried once
            last_error = f"{type(exc).__name__}: {str(exc)[:400]}"
            log.warning("Analysis attempt %d errored for raw_item %s: %s", attempt, item.id, last_error)

    raise AnalysisFailed(last_error or "unknown analysis error")
