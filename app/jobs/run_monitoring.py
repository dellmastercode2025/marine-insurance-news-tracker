"""Manual monitoring run: python -m app.jobs.run_monitoring"""
from __future__ import annotations

import asyncio

from app.db.engine import get_session_factory, init_db
from app.db.seed import seed_sources
from app.logging_conf import setup_logging
from app.pipeline.monitor import run_monitoring


async def main() -> None:
    setup_logging()
    await init_db()
    async with get_session_factory()() as session:
        await seed_sources(session)
    from app.bot.alerts import send_high_alert

    run = await run_monitoring(trigger="manual", alert_callback=send_high_alert)
    print(
        f"Run {run.id}: status={run.status} sources={run.sources_checked} "
        f"new={run.items_new} H/M/L={run.items_high}/{run.items_medium}/{run.items_low}"
    )


if __name__ == "__main__":
    asyncio.run(main())
