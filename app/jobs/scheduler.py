"""APScheduler wiring — all times in the operational timezone (Asia/Aqtau).

Jobs:
- monitoring: hourly
- daily_report: 09:30 daily
- weekly_report: Monday 09:30
"""
from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings

log = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _monitoring_job() -> None:
    from app.bot.alerts import send_high_alert
    from app.pipeline.monitor import run_monitoring

    await run_monitoring(trigger="schedule", alert_callback=send_high_alert)


async def _daily_report_job() -> None:
    from app.db.engine import get_session_factory
    from app.reports.daily import generate_daily_report
    from app.reports.delivery import send_report_to_subscribers

    async with get_session_factory()() as session:
        report = await generate_daily_report(session)
        await send_report_to_subscribers(session, report)


async def _weekly_report_job() -> None:
    from app.db.engine import get_session_factory
    from app.reports.delivery import send_report_to_subscribers
    from app.reports.weekly import generate_weekly_report

    async with get_session_factory()() as session:
        report = await generate_weekly_report(session)
        await send_report_to_subscribers(session, report)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone=settings.tz)
    scheduler.add_job(
        _monitoring_job,
        IntervalTrigger(minutes=settings.monitor_interval_minutes, timezone=settings.tz),
        id="monitoring",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _daily_report_job,
        CronTrigger(
            hour=settings.daily_report_hour,
            minute=settings.daily_report_minute,
            timezone=settings.tz,
        ),
        id="daily_report",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _weekly_report_job,
        CronTrigger(
            day_of_week=settings.weekly_report_day,
            hour=settings.weekly_report_hour,
            minute=settings.weekly_report_minute,
            timezone=settings.tz,
        ),
        id="weekly_report",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    log.info(
        "Scheduler started (%s): monitoring every %d min, daily %02d:%02d, weekly %s %02d:%02d",
        settings.app_timezone,
        settings.monitor_interval_minutes,
        settings.daily_report_hour,
        settings.daily_report_minute,
        settings.weekly_report_day,
        settings.weekly_report_hour,
        settings.weekly_report_minute,
    )
    return scheduler


def get_next_run_times() -> dict[str, datetime | None]:
    """Next run per job in the operational timezone (for /status)."""
    result: dict[str, datetime | None] = {
        "monitoring": None,
        "daily_report": None,
        "weekly_report": None,
    }
    if _scheduler is None:
        return result
    for job_id in result:
        job = _scheduler.get_job(job_id)
        if job is not None:
            result[job_id] = job.next_run_time
    return result


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
