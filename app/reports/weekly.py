"""Weekly Analytical Report — generated Mondays 09:30 Asia/Aqtau, covering 7 days."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Report
from app.reports.common import compose_report

WEEKLY_MAX_ITEMS = 80


async def generate_weekly_report(
    session: AsyncSession, reference_time: datetime | None = None
) -> Report:
    end = reference_time or datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    return await compose_report(
        session,
        report_type="weekly",
        prompt_file="weekly_report.md",
        title="Weekly Analytical Report",
        start=start,
        end=end,
        max_items=WEEKLY_MAX_ITEMS,
    )
