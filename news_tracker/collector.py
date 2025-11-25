from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import logging
from dataclasses import dataclass
from typing import Iterable, List, Sequence
from urllib.error import URLError
from urllib.request import urlopen
import xml.etree.ElementTree as ET

from .sources import FeedSource

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Article:
    """A single news article pulled from a feed."""

    title: str
    link: str
    published: dt.datetime | None
    source: str
    summary: str

    def to_dict(self) -> dict:
        return {
            "id": self.identifier,
            "title": self.title,
            "link": self.link,
            "published": self.published.isoformat() if self.published else None,
            "source": self.source,
            "summary": self.summary,
        }

    @property
    def identifier(self) -> str:
        base = f"{self.link}|{self.title}".encode("utf-8")
        return hashlib.sha256(base).hexdigest()


def _parse_rss(root: ET.Element) -> List[dict]:
    articles: List[dict] = []
    for item in root.findall("channel/item"):
        articles.append(
            {
                "title": (item.findtext("title") or "").strip(),
                "link": (item.findtext("link") or "").strip(),
                "summary": (item.findtext("description") or "").strip(),
                "published": item.findtext("pubDate"),
            }
        )
    return articles


def _parse_atom(root: ET.Element) -> List[dict]:
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    articles: List[dict] = []

    for entry in root.findall("atom:entry", ns):
        link_elem = entry.find("atom:link[@rel='alternate']", ns) or entry.find("atom:link", ns)
        link = link_elem.get("href", "") if link_elem is not None else ""
        summary = entry.findtext("atom:summary", default="", namespaces=ns)
        if not summary:
            content_elem = entry.find("atom:content", ns)
            summary = content_elem.text if content_elem is not None else ""
        articles.append(
            {
                "title": entry.findtext("atom:title", default="", namespaces=ns).strip(),
                "link": link,
                "summary": summary.strip(),
                "published": entry.findtext("atom:updated", default="", namespaces=ns) or entry.findtext(
                    "atom:published", default="", namespaces=ns
                ),
            }
        )
    return articles


def _parse_datetime(value: str | None) -> dt.datetime | None:
    if not value:
        return None

    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed:
            return parsed
    except (TypeError, ValueError):
        pass

    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fetch_entries(source: FeedSource) -> List[dict]:
    try:
        with urlopen(source.url, timeout=30) as response:
            content = response.read()
    except URLError as exc:
        logger.warning("Failed to fetch %s: %s", source.url, exc)
        return []

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        logger.warning("Failed to parse XML from %s: %s", source.url, exc)
        return []

    if root.tag.lower().endswith("rss") or root.find("channel") is not None:
        return _parse_rss(root)
    return _parse_atom(root)


def _matches_keywords(entry: dict, keywords: Sequence[str]) -> bool:
    if not keywords:
        return True

    text = f"{entry.get('title', '')} {entry.get('summary', '')}".lower()
    return any(keyword.lower() in text for keyword in keywords)


def collect_feed(source: FeedSource, keywords: Sequence[str], limit: int | None = None) -> List[Article]:
    articles: List[Article] = []
    for entry in _fetch_entries(source):
        if not _matches_keywords(entry, keywords):
            continue

        article = Article(
            title=entry.get("title", "Untitled"),
            link=entry.get("link", ""),
            published=_parse_datetime(entry.get("published")),
            source=source.name,
            summary=entry.get("summary", ""),
        )
        articles.append(article)

        if limit is not None and len(articles) >= limit:
            break

    return articles


def collect_all(
    sources: Iterable[FeedSource],
    keywords: Sequence[str],
    per_feed_limit: int | None = None,
) -> List[Article]:
    seen = set()
    collected: List[Article] = []

    for source in sources:
        for article in collect_feed(source, keywords=keywords, limit=per_feed_limit):
            if article.identifier in seen:
                continue
            seen.add(article.identifier)
            collected.append(article)

    collected.sort(key=lambda item: item.published or dt.datetime.min.replace(tzinfo=dt.timezone.utc), reverse=True)
    return collected


def as_markdown(articles: Sequence[Article]) -> str:
    lines = ["# Marine Insurance News", ""]
    for article in articles:
        timestamp = article.published.isoformat() if article.published else "Unknown publication time"
        lines.append(f"- **{article.title}** ({article.source}, {timestamp})")
        if article.summary:
            lines.append(f"  - {article.summary.strip()}")
        lines.append(f"  - {article.link}")
    return "\n".join(lines)


__all__ = ["Article", "collect_feed", "collect_all", "as_markdown"]
