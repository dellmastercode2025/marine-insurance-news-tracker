"""Bot and dispatcher setup, long-polling runner."""
from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from app.bot.middleware import AccessControlMiddleware
from app.bot.handlers import basic, feeds, reports, subscriptions
from app.config import get_settings

log = logging.getLogger(__name__)

_bot: Bot | None = None

COMMANDS = [
    BotCommand(command="latest", description="Последние 10 обновлений"),
    BotCommand(command="high", description="Обновления высокой существенности"),
    BotCommand(command="sanctions", description="Санкции и compliance"),
    BotCommand(command="insurance", description="Морское страхование"),
    BotCommand(command="pi", description="P&I"),
    BotCommand(command="hm", description="Hull & Machinery"),
    BotCommand(command="warrisk", description="Военные риски"),
    BotCommand(command="market", description="Рынок танкеров"),
    BotCommand(command="vlcc", description="Обновления VLCC"),
    BotCommand(command="aframax", description="Обновления Aframax"),
    BotCommand(command="suezmax", description="Обновления Suezmax"),
    BotCommand(command="shipbuilding", description="Судостроение (нефтяные танкеры)"),
    BotCommand(command="ports", description="Порты и маршруты"),
    BotCommand(command="search", description="Поиск по базе аналитики"),
    BotCommand(command="daily", description="Ежедневная аналитическая сводка"),
    BotCommand(command="weekly", description="Еженедельный аналитический отчет"),
    BotCommand(command="subscribe", description="Настройки подписки"),
    BotCommand(command="settings", description="Настройка уведомлений"),
    BotCommand(command="unsubscribe", description="Отключить уведомления"),
    BotCommand(command="status", description="Статус мониторинга"),
    BotCommand(command="help", description="Все команды"),
]


def get_bot() -> Bot | None:
    """The process-wide bot instance (None when running pipeline-only/CLI)."""
    return _bot


def create_bot() -> Bot:
    global _bot
    settings = get_settings()
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")
    _bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    return _bot


def create_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    access = AccessControlMiddleware()
    dp.message.outer_middleware(access)
    dp.callback_query.outer_middleware(access)
    dp.include_router(basic.router)
    dp.include_router(feeds.router)
    dp.include_router(subscriptions.router)
    dp.include_router(reports.router)
    return dp


async def run_bot(bot: Bot, dp: Dispatcher) -> None:
    await bot.set_my_commands(COMMANDS)
    log.info("Starting Telegram long-polling")
    await dp.start_polling(bot, handle_signals=False)
