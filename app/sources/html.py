"""Minimal HTML listing fetcher for public news/circular index pages.

Extracts headline links only (anchor text + href) — never article bodies.
robots.txt is checked before every page fetch.
"""
from __future__ import annotations

import logging
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.sources.base import FetchedEntry, RobotsCache

log = logging.getLogger(__name__)

# Anchor texts that are navigation, not headlines
_NAV_WORDS = {
    "home", "about", "contact", "news", "search", "menu", "login", "subscribe",
    "read more", "more", "next", "previous", "privacy", "cookies", "terms",
    "sitemap", "careers", "events", "publications", "share", "download",
}


async def fetch_html_listing(
    client: httpx.AsyncClient, robots: RobotsCache, page_url: str, limit: int
) -> list[FetchedEntry]:
    if not await robots.allowed(client, page_url):
        log.info("robots.txt disallows %s — skipping", page_url)
        return []
    resp = await client.get(page_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    base_host = urlparse(page_url).netloc
    seen: set[str] = set()
    entries: list[FetchedEntry] = []
    for anchor in soup.find_all("a", href=True):
        text = " ".join(anchor.get_text(" ", strip=True).split())
        if len(text) < 25:  # headlines are longer than nav labels
            continue
        if text.lower() in _NAV_WORDS:
            continue
        url = urljoin(page_url, anchor["href"])
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or parsed.netloc != base_host:
            continue
        if url.rstrip("/") == page_url.rstrip("/"):
            continue
        if url in seen:
            continue
        seen.add(url)
        entries.append(FetchedEntry(title=text, url=url, external_id=url))
        if len(entries) >= limit:
            break
    return entries
