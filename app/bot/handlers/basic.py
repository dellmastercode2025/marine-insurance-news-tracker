"""/start, /help, /status and admin commands (/approve, /revoke, /run)."""
from __future__ import annotations

import asyncio
import logging

from aiogram import Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.formatting import local_datetime
from app.db.models import MonitoringRun, User

log = logging.getLogger(__name__)
router = Router(name="basic")

WELCOME = (
    "🛢 <b>Maritime Tanker Intelligence Bot</b>\n\n"
    "I monitor legally accessible public sources every hour and convert raw updates "
    "into structured intelligence on:\n"
    "• Oil tanker transportation (VLCC / Suezmax / Aframax / product tankers)\n"
    "• Tanker freight markets\n"
    "• Marine insurance: P&I, Hull &amp; Machinery, war risk, cargo\n"
    "• Sanctions, licenses, enforcement and compliance\n"
    "• Shipbuilding affecting oil tanker capacity\n"
    "• Port, route and geopolitical risks\n\n"
    "🚨 High-materiality events trigger urgent alerts.\n"
    "📄 Daily Intelligence Brief at 09:30 and Weekly Analytical Report on Mondays "
    "at 09:30 (Asia/Aqtau).\n\n"
    "Use /help to see all commands, /settings to manage alert preferences."
)

HELP = (
    "<b>Commands</b>\n\n"
    "<b>Feeds</b>\n"
    "/latest — latest 10 intelligence items\n"
    "/high — latest high-materiality alerts\n"
    "/sanctions — sanctions &amp; compliance updates\n"
    "/insurance — marine insurance updates\n"
    "/pi — P&amp;I updates\n"
    "/hm — Hull &amp; Machinery updates\n"
    "/warrisk — war risk updates\n"
    "/market — tanker market updates\n"
    "/vlcc /aframax /suezmax — segment updates\n"
    "/shipbuilding — shipbuilding affecting oil tankers\n"
    "/ports — port and route disruptions\n"
    "/search &lt;keyword&gt; — search by company, vessel, IMO, insurer, port, "
    "regulator, shipyard, country or topic\n\n"
    "<b>Reports</b>\n"
    "/daily — latest Daily Intelligence Brief\n"
    "/weekly — latest Weekly Analytical Report\n\n"
    "<b>Subscriptions</b>\n"
    "/subscribe — subscription settings\n"
    "/settings — manage alert preferences\n"
    "/unsubscribe — disable alerts\n\n"
    "<b>System</b>\n"
    "/status — last monitoring run and next scheduled reports"
)

HELP_ADMIN = (
    "\n\n<b>Admin</b>\n"
    "/run — trigger a monitoring run now\n"
    "/approve &lt;telegram_id&gt; — grant a user access\n"
    "/revoke &lt;telegram_id&gt; — remove a user's access"
)


@router.message(Command("start"))
async def cmd_start(message: Message) -> None:
    await message.answer(WELCOME, disable_web_page_preview=True)


@router.message(Command("help"))
async def cmd_help(message: Message, db_user: User) -> None:
    text = HELP + (HELP_ADMIN if db_user.is_admin else "")
    await message.answer(text)


@router.message(Command("status"))
async def cmd_status(message: Message, session: AsyncSession) -> None:
    run = await session.scalar(
        select(MonitoringRun).order_by(desc(MonitoringRun.id)).limit(1)
    )
    lines = ["<b>System status</b>", ""]
    if run is None:
        lines.append("No monitoring runs recorded yet.")
    else:
        lines += [
            f"<b>Last monitoring run:</b> {local_datetime(run.started_at)}",
            f"Status: {run.status} ({run.trigger})",
            f"Sources checked: {run.sources_checked} (failed: {run.sources_failed})",
            f"Items fetched: {run.items_fetched}, new: {run.items_new}",
            f"Analyzed — High: {run.items_high} / Medium: {run.items_medium} / Low: {run.items_low}",
            f"Filtered out: {run.items_prefiltered_out}, alerts sent: {run.alerts_sent}",
        ]
    from app.jobs.scheduler import get_next_run_times  # deferred: scheduler may be absent in tests

    next_times = get_next_run_times()
    lines.append("")
    lines.append(f"<b>Next monitoring run:</b> {local_datetime(next_times.get('monitoring'))}")
    lines.append(f"<b>Next Daily Brief:</b> {local_datetime(next_times.get('daily_report'))}")
    lines.append(f"<b>Next Weekly Report:</b> {local_datetime(next_times.get('weekly_report'))}")
    await message.answer("\n".join(lines))


@router.message(Command("run"))
async def cmd_run(message: Message, db_user: User) -> None:
    if not db_user.is_admin:
        await message.answer("Admin command.")
        return
    from app.bot.alerts import send_high_alert
    from app.pipeline.monitor import run_monitoring

    await message.answer("Monitoring run started…")

    async def _run() -> None:
        try:
            run = await run_monitoring(trigger="manual", alert_callback=send_high_alert)
            await message.answer(
                f"Run finished: {run.items_new} new items, "
                f"H/M/L = {run.items_high}/{run.items_medium}/{run.items_low}, "
                f"{run.alerts_sent} alerts. Status: {run.status}."
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("Manual monitoring run failed")
            await message.answer(f"Run failed: {type(exc).__name__}: {exc}")

    asyncio.create_task(_run())


async def _set_approval(
    message: Message, session: AsyncSession, db_user: User,
    command: CommandObject, approved: bool,
) -> None:
    if not db_user.is_admin:
        await message.answer("Admin command.")
        return
    arg = (command.args or "").strip()
    if not arg.isdigit():
        await message.answer(f"Usage: /{'approve' if approved else 'revoke'} &lt;telegram_id&gt;")
        return
    telegram_id = int(arg)
    user = await session.scalar(select(User).where(User.telegram_user_id == telegram_id))
    if user is None:
        if not approved:
            await message.answer("User not found.")
            return
        user = User(telegram_user_id=telegram_id, is_approved=True)
        session.add(user)
        await session.flush()
    user.is_approved = approved
    if approved:
        from app.bot.middleware import ensure_default_subscriptions

        await ensure_default_subscriptions(session, user)
    await session.commit()
    await message.answer(
        f"User <code>{telegram_id}</code> {'approved' if approved else 'revoked'}."
    )


@router.message(Command("approve"))
async def cmd_approve(
    message: Message, session: AsyncSession, db_user: User, command: CommandObject
) -> None:
    await _set_approval(message, session, db_user, command, approved=True)


@router.message(Command("revoke"))
async def cmd_revoke(
    message: Message, session: AsyncSession, db_user: User, command: CommandObject
) -> None:
    await _set_approval(message, session, db_user, command, approved=False)
