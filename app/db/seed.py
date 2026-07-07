"""Seed the sources table from config/sources.yaml (idempotent upsert by slug)."""
from __future__ import annotations

import logging
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Source

log = logging.getLogger(__name__)

SOURCES_FILE = Path(__file__).resolve().parents[2] / "config" / "sources.yaml"


async def seed_sources(session: AsyncSession, path: Path | None = None) -> int:
    path = path or SOURCES_FILE
    if not path.exists():
        log.warning("sources.yaml not found at %s — skipping seed", path)
        return 0

    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = data.get("sources", [])
    existing = {
        s.slug: s for s in (await session.scalars(select(Source))).all()
    }
    added = 0
    for entry in entries:
        slug = entry["slug"]
        if slug in existing:
            src = existing[slug]
            src.name = entry["name"]
            src.url = entry["url"]
            src.feed_url = entry.get("feed_url")
            src.fetch_method = entry.get("fetch_method", "rss")
            src.category = entry.get("category", "market")
            src.authority_rank = entry.get("authority_rank", 3)
            src.country = entry.get("country")
            src.language = entry.get("language", "en")
        else:
            session.add(
                Source(
                    name=entry["name"],
                    slug=slug,
                    url=entry["url"],
                    feed_url=entry.get("feed_url"),
                    fetch_method=entry.get("fetch_method", "rss"),
                    category=entry.get("category", "market"),
                    authority_rank=entry.get("authority_rank", 3),
                    country=entry.get("country"),
                    language=entry.get("language", "en"),
                    enabled=entry.get("enabled", True),
                )
            )
            added += 1
    await session.commit()
    log.info("Seeded sources: %d new, %d total in file", added, len(entries))
    return added
