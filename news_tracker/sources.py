from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
from typing import Iterable, List


@dataclass(frozen=True)
class FeedSource:
    name: str
    url: str


DEFAULT_SOURCES: List[FeedSource] = [
    FeedSource(
        name="Insurance Journal (International)",
        url="https://www.insurancejournal.com/rss/news/international/",
    ),
    FeedSource(name="gCaptain", url="https://gcaptain.com/feed/"),
    FeedSource(name="The Maritime Executive", url="https://www.maritime-executive.com/rss"),
    FeedSource(name="Safety4Sea", url="https://safety4sea.com/feed/"),
    FeedSource(name="MarineLink", url="https://www.marinelink.com/rss/news"),
]

DEFAULT_KEYWORDS: List[str] = [
    "marine insurance",
    "maritime insurance",
    "P&I",
    "shadow fleet",
    "sanctions",
    "shipping insurance",
]


def load_sources(path: Path) -> List[FeedSource]:
    """
    Load feed sources from a JSON file.

    Expected JSON format: [{"name": "Source", "url": "https://..."}, ...].
    """

    with path.open("r", encoding="utf-8") as handle:
        raw_sources = json.load(handle)

    if not isinstance(raw_sources, list):
        raise ValueError("Source file must contain a list of feed definitions")

    feeds: List[FeedSource] = []
    for entry in raw_sources:
        if not isinstance(entry, dict):
            raise ValueError("Each feed definition must be a JSON object")
        name = entry.get("name")
        url = entry.get("url")
        if not name or not url:
            raise ValueError("Feed definitions require 'name' and 'url' keys")
        feeds.append(FeedSource(name=name, url=url))
    return feeds


__all__ = ["FeedSource", "DEFAULT_SOURCES", "DEFAULT_KEYWORDS", "load_sources"]
