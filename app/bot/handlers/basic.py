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
    "Я ежечасно отслеживаю легально доступные публичные источники и преобразую "
    "новости в структурированную аналитику по темам:\n"
    "• Танкерные перевозки нефти (VLCC / Suezmax / Aframax / продуктовые танкеры)\n"
    "• Фрахтовый рынок танкеров\n"
    "• Морское страхование: P&I, Hull &amp; Machinery, военные риски, грузы\n"
    "• Санкции, лицензии, правоприменение и compliance\n"
    "• Судостроение, влияющее на танкерный флот\n"
    "• Портовые, маршрутные и геополитические риски\n\n"
    "🚨 События высокой существенности приходят срочными уведомлениями.\n"
    "📄 Ежедневная сводка в 09:30 и еженедельный отчет по понедельникам "
    "в 09:30 (Asia/Aqtau). Публикации — на русском языке.\n\n"
    "/help — все команды, /settings — настройка уведомлений."
)

HELP = (
    "<b>Команды</b>\n\n"
    "<b>Ленты</b>\n"
    "/latest — последние 10 обновлений\n"
    "/high — обновления высокой существенности\n"
    "/sanctions — санкции и compliance\n"
    "/insurance — морское страхование\n"
    "/pi — P&amp;I\n"
    "/hm — Hull &amp; Machinery\n"
    "/warrisk — военные риски\n"
    "/market — рынок танкеров\n"
    "/vlcc /aframax /suezmax — обновления по сегментам\n"
    "/shipbuilding — судостроение (нефтяные танкеры)\n"
    "/ports — порты и маршруты\n"
    "/search &lt;слово&gt; — поиск по компании, судну, IMO, страховщику, порту, "
    "регулятору, верфи, стране или теме\n\n"
    "<b>Отчеты</b>\n"
    "/daily — ежедневная аналитическая сводка\n"
    "/weekly — еженедельный аналитический отчет\n\n"
    "<b>Подписки</b>\n"
    "/subscribe — настройки подписки\n"
    "/settings — настройка уведомлений\n"
    "/unsubscribe — отключить уведомления\n\n"
    "<b>Система</b>\n"
    "/status — последний цикл мониторинга и расписание отчетов"
)

HELP_ADMIN = (
    "\n\n<b>Администратор</b>\n"
    "/run — запустить мониторинг сейчас\n"
    "/approve &lt;telegram_id&gt; — открыть пользователю доступ\n"
    "/revoke &lt;telegram_id&gt; — закрыть доступ"
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
    lines = ["<b>Статус системы</b>", ""]
    if run is None:
        lines.append("Циклы мониторинга еще не выполнялись.")
    else:
        lines += [
            f"<b>Последний цикл мониторинга:</b> {local_datetime(run.started_at)}",
            f"Статус: {run.status} ({run.trigger})",
            f"Источников проверено: {run.sources_checked} (сбоев: {run.sources_failed})",
            f"Записей получено: {run.items_fetched}, новых: {run.items_new}",
            f"Проанализировано — High: {run.items_high} / Medium: {run.items_medium} / Low: {run.items_low}",
            f"Отфильтровано: {run.items_prefiltered_out}, уведомлений отправлено: {run.alerts_sent}",
        ]
    from app.jobs.scheduler import get_next_run_times  # deferred: scheduler may be absent in tests

    next_times = get_next_run_times()
    lines.append("")
    lines.append(f"<b>Следующий цикл мониторинга:</b> {local_datetime(next_times.get('monitoring'))}")
    lines.append(f"<b>Следующая ежедневная сводка:</b> {local_datetime(next_times.get('daily_report'))}")
    lines.append(f"<b>Следующий еженедельный отчет:</b> {local_datetime(next_times.get('weekly_report'))}")
    await message.answer("\n".join(lines))


@router.message(Command("run"))
async def cmd_run(message: Message, db_user: User) -> None:
    if not db_user.is_admin:
        await message.answer("Admin command.")
        return
    from app.bot.alerts import send_high_alert
    from app.pipeline.monitor import run_monitoring

    await message.answer("Цикл мониторинга запущен…")

    async def _run() -> None:
        try:
            run = await run_monitoring(trigger="manual", alert_callback=send_high_alert)
            await message.answer(
                f"Цикл завершен: новых записей — {run.items_new}, "
                f"H/M/L = {run.items_high}/{run.items_medium}/{run.items_low}, "
                f"уведомлений — {run.alerts_sent}. Статус: {run.status}."
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("Manual monitoring run failed")
            await message.answer(f"Сбой цикла: {type(exc).__name__}: {exc}")

    asyncio.create_task(_run())


async def _set_approval(
    message: Message, session: AsyncSession, db_user: User,
    command: CommandObject, approved: bool,
) -> None:
    if not db_user.is_admin:
        await message.answer("Команда доступна только администратору.")
        return
    arg = (command.args or "").strip()
    if not arg.isdigit():
        await message.answer(f"Использование: /{'approve' if approved else 'revoke'} &lt;telegram_id&gt;")
        return
    telegram_id = int(arg)
    user = await session.scalar(select(User).where(User.telegram_user_id == telegram_id))
    if user is None:
        if not approved:
            await message.answer("Пользователь не найден.")
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
        f"Пользователю <code>{telegram_id}</code> доступ "
        f"{'открыт' if approved else 'закрыт'}."
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
