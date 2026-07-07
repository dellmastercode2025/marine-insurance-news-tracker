"""/daily and /weekly — concise Telegram summary first, then the full report
as a Markdown document attachment."""
from __future__ import annotations

import logging

from aiogram import Router
from aiogram.types import BufferedInputFile, Message
from aiogram.filters import Command
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.formatting import chunk_message, local_date
from app.db.models import Report

log = logging.getLogger(__name__)
router = Router(name="reports")


async def deliver_report(message: Message, report: Report) -> None:
    summary = report.telegram_summary or "Report generated."
    for chunk in chunk_message(summary):
        await message.answer(chunk, disable_web_page_preview=True)
    filename = (
        f"{'daily-brief' if report.report_type == 'daily' else 'weekly-report'}-"
        f"{report.period_end.date().isoformat()}.md"
    )
    await message.answer_document(
        BufferedInputFile(report.content_md.encode("utf-8"), filename=filename),
        caption=f"Full {'Daily Intelligence Brief' if report.report_type == 'daily' else 'Weekly Analytical Report'} — {local_date(report.period_end)}",
    )


async def _latest_or_generate(
    message: Message, session: AsyncSession, report_type: str
) -> None:
    report = await session.scalar(
        select(Report)
        .where(Report.report_type == report_type)
        .order_by(desc(Report.generated_at))
        .limit(1)
    )
    if report is not None:
        await deliver_report(message, report)
        return

    await message.answer("No stored report yet — generating one now, this may take a minute…")
    try:
        if report_type == "daily":
            from app.reports.daily import generate_daily_report

            report = await generate_daily_report(session)
        else:
            from app.reports.weekly import generate_weekly_report

            report = await generate_weekly_report(session)
    except Exception as exc:  # noqa: BLE001
        log.exception("On-demand %s report generation failed", report_type)
        await message.answer(f"Report generation failed: {type(exc).__name__}: {exc}")
        return
    await deliver_report(message, report)


@router.message(Command("daily"))
async def cmd_daily(message: Message, session: AsyncSession) -> None:
    await _latest_or_generate(message, session, "daily")


@router.message(Command("weekly"))
async def cmd_weekly(message: Message, session: AsyncSession) -> None:
    await _latest_or_generate(message, session, "weekly")
