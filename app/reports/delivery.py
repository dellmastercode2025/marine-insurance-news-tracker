"""Push generated reports to subscribed users (summary + Markdown document)."""
from __future__ import annotations

import asyncio
import logging

from aiogram.types import BufferedInputFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.formatting import chunk_message
from app.db.models import Report, Subscription, SubscriptionTopic, User

log = logging.getLogger(__name__)

_TOPIC_FOR_TYPE = {
    "daily": SubscriptionTopic.DAILY_BRIEF.value,
    "weekly": SubscriptionTopic.WEEKLY_REPORT.value,
}


async def send_report_to_subscribers(session: AsyncSession, report: Report) -> int:
    from app.bot.bot import get_bot

    bot = get_bot()
    if bot is None:
        log.info("No bot instance — report %s stored but not pushed", report.id)
        return 0

    topic = _TOPIC_FOR_TYPE[report.report_type]
    users = (
        await session.scalars(
            select(User)
            .join(Subscription, Subscription.user_id == User.id)
            .where(
                User.is_active.is_(True),
                User.is_approved.is_(True),
                Subscription.topic == topic,
                Subscription.enabled.is_(True),
            )
        )
    ).all()

    filename = (
        f"{'daily-brief' if report.report_type == 'daily' else 'weekly-report'}-"
        f"{report.period_end.date().isoformat()}.md"
    )
    sent = 0
    for user in users:
        try:
            for chunk in chunk_message(report.telegram_summary or "Report generated."):
                await bot.send_message(
                    user.telegram_user_id, chunk, disable_web_page_preview=True
                )
            await bot.send_document(
                user.telegram_user_id,
                BufferedInputFile(report.content_md.encode("utf-8"), filename=filename),
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("Report delivery failed to user %s: %s", user.telegram_user_id, exc)
        await asyncio.sleep(0.1)

    report.status = "sent"
    await session.commit()
    log.info("Report %s delivered to %d subscribers", report.id, sent)
    return sent
