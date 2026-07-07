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
    BotCommand(command="latest", description="Latest 10 intelligence items"),
    BotCommand(command="high", description="High-materiality alerts"),
    BotCommand(command="sanctions", description="Sanctions & compliance"),
    BotCommand(command="insurance", description="Marine insurance"),
    BotCommand(command="pi", description="P&I updates"),
    BotCommand(command="hm", description="Hull & Machinery updates"),
    BotCommand(command="warrisk", description="War risk updates"),
    BotCommand(command="market", description="Tanker market updates"),
    BotCommand(command="vlcc", description="VLCC updates"),
    BotCommand(command="aframax", description="Aframax updates"),
    BotCommand(command="suezmax", description="Suezmax updates"),
    BotCommand(command="shipbuilding", description="Shipbuilding affecting tankers"),
    BotCommand(command="ports", description="Port & route disruptions"),
    BotCommand(command="search", description="Search the intelligence database"),
    BotCommand(command="daily", description="Daily Intelligence Brief"),
    BotCommand(command="weekly", description="Weekly Analytical Report"),
    BotCommand(command="subscribe", description="Subscription settings"),
    BotCommand(command="settings", description="Alert preferences"),
    BotCommand(command="unsubscribe", description="Disable alerts"),
    BotCommand(command="status", description="Monitoring status"),
    BotCommand(command="help", description="All commands"),
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
