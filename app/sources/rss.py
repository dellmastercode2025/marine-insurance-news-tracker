"""RSS/Atom fetcher."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from time import mktime

import feedparser
import httpx

from app.sources.base import FetchedEntry

log = logging.getLogger(__name__)


def _entry_datetime(entry) -> datetime | None:
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                return datetime.fromtimestamp(mktime(parsed), tz=timezone.utc)
            except (OverflowError, ValueError):
                continue
    return None


async def fetch_rss(client: httpx.AsyncClient, feed_url: str, limit: int) -> list[FetchedEntry]:
    resp = await client.get(feed_url)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    entries: list[FetchedEntry] = []
    for entry in feed.entries[:limit]:
        link = getattr(entry, "link", None)
        title = (getattr(entry, "title", "") or "").strip()
        if not link or not title:
            continue
        summary = getattr(entry, "summary", None) or getattr(entry, "description", None)
        entries.append(
            FetchedEntry(
                title=title,
                url=link,
                summary=summary,
                published_at=_entry_datetime(entry),
                external_id=getattr(entry, "id", None) or link,
            )
        )
    return entries
