"""Fetching foundation: politeness, robots.txt respect, shared HTTP client.

Source discipline: honest User-Agent, robots.txt checked for HTML pages,
bounded excerpts only (headline + short summary + link), no authentication,
no paywall bypass, per-run item caps.
"""
from __future__ import annotations

import dataclasses
import logging
from datetime import datetime
from urllib import robotparser
from urllib.parse import urlparse, urlunparse

import httpx

log = logging.getLogger(__name__)

USER_AGENT = (
    "MaritimeTankerIntelBot/0.1 (+https://github.com/dellmastercode2025/"
    "marine-insurance-news-tracker; monitoring public maritime publications)"
)

HTTP_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


@dataclasses.dataclass
class FetchedEntry:
    title: str
    url: str
    summary: str | None = None
    published_at: datetime | None = None
    external_id: str | None = None


def make_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT,
        follow_redirects=True,
    )


class RobotsCache:
    """Per-host robots.txt cache. Fail-open only on fetch errors; an explicit
    disallow always blocks."""

    def __init__(self) -> None:
        self._parsers: dict[str, robotparser.RobotFileParser | None] = {}

    async def allowed(self, client: httpx.AsyncClient, url: str) -> bool:
        host = urlparse(url).netloc
        if host not in self._parsers:
            robots_url = urlunparse((urlparse(url).scheme, host, "/robots.txt", "", "", ""))
            parser = robotparser.RobotFileParser()
            try:
                resp = await client.get(robots_url)
                if resp.status_code == 200:
                    parser.parse(resp.text.splitlines())
                    self._parsers[host] = parser
                else:
                    self._parsers[host] = None  # no robots.txt -> allowed
            except httpx.HTTPError as exc:
                log.debug("robots.txt fetch failed for %s: %s", host, exc)
                self._parsers[host] = None
        parser = self._parsers[host]
        if parser is None:
            return True
        return parser.can_fetch(USER_AGENT, url)
