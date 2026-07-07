"""Minimal HTTP surface: health check + token-gated manual triggers.

The user interacts through Telegram only; this API exists for platform health
checks and for wiring external cron services if in-process scheduling is ever
moved out.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings

log = logging.getLogger(__name__)

api = FastAPI(title="Maritime Tanker Intel Bot", docs_url=None, redoc_url=None)
_bearer = HTTPBearer(auto_error=False)


def require_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    settings = get_settings()
    if not settings.admin_api_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ADMIN_API_TOKEN not configured")
    if credentials is None or credentials.credentials != settings.admin_api_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


@api.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@api.post("/admin/run-monitoring", dependencies=[Depends(require_admin_token)])
async def trigger_monitoring() -> dict:
    from app.bot.alerts import send_high_alert
    from app.pipeline.monitor import run_monitoring

    asyncio.create_task(run_monitoring(trigger="api", alert_callback=send_high_alert))
    return {"status": "started"}


@api.post("/admin/generate-report/{report_type}", dependencies=[Depends(require_admin_token)])
async def trigger_report(report_type: str) -> dict:
    if report_type not in ("daily", "weekly"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "report_type must be daily or weekly")

    from app.db.engine import get_session_factory
    from app.reports.delivery import send_report_to_subscribers

    async def _generate() -> None:
        async with get_session_factory()() as session:
            if report_type == "daily":
                from app.reports.daily import generate_daily_report

                report = await generate_daily_report(session)
            else:
                from app.reports.weekly import generate_weekly_report

                report = await generate_weekly_report(session)
            await send_report_to_subscribers(session, report)

    asyncio.create_task(_generate())
    return {"status": "started"}
