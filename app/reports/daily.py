"""Daily Intelligence Brief — generated at 09:30 Asia/Aqtau, covering 24h."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Report
from app.reports.common import compose_report

DAILY_MAX_ITEMS = 40


async def generate_daily_report(
    session: AsyncSession, reference_time: datetime | None = None
) -> Report:
    end = reference_time or datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    return await compose_report(
        session,
        report_type="daily",
        prompt_file="daily_brief.md",
        title="Daily Intelligence Brief",
        start=start,
        end=end,
        max_items=DAILY_MAX_ITEMS,
    )
