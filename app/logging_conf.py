import logging
import sys

from app.config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        stream=sys.stdout,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    # Keep chatty third-party loggers at WARNING unless debugging
    for noisy in ("httpx", "httpcore", "aiogram.event", "apscheduler.executors"):
        logging.getLogger(noisy).setLevel(max(level, logging.WARNING))
