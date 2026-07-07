"""Application entrypoint: DB init + seed, scheduler, admin API, Telegram bot.

Everything runs in one process/container — suitable for Render, Railway,
Fly.io or any Docker host. The user interacts through Telegram only.
"""
from __future__ import annotations

import asyncio
import logging

import uvicorn

from app.api.admin import api
from app.bot.bot import create_bot, create_dispatcher, run_bot
from app.config import get_settings
from app.db.engine import dispose_engine, get_session_factory, init_db
from app.db.seed import seed_sources
from app.jobs.scheduler import shutdown_scheduler, start_scheduler
from app.logging_conf import setup_logging

log = logging.getLogger(__name__)


async def run_api_server() -> None:
    settings = get_settings()
    config = uvicorn.Config(
        api, host="0.0.0.0", port=settings.port, log_level="warning", loop="asyncio"
    )
    server = uvicorn.Server(config)
    await server.serve()


async def main() -> None:
    setup_logging()
    settings = get_settings()
    log.info("Starting Maritime Tanker Intel Bot (env=%s, tz=%s)", settings.app_env, settings.app_timezone)

    await init_db()
    async with get_session_factory()() as session:
        await seed_sources(session)

    bot = create_bot()
    dp = create_dispatcher()
    start_scheduler()

    api_task = asyncio.create_task(run_api_server())
    try:
        await run_bot(bot, dp)
    finally:
        shutdown_scheduler()
        api_task.cancel()
        await bot.session.close()
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
