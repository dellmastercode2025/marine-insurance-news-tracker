from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Sequence

from .collector import Article, as_markdown, collect_all
from .sources import DEFAULT_KEYWORDS, DEFAULT_SOURCES, FeedSource, load_sources


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Aggregate marine insurance and maritime sanctions news feeds.")
    parser.add_argument(
        "--keywords",
        nargs="*",
        default=DEFAULT_KEYWORDS,
        help="Keywords to filter against. If omitted, defaults focus on marine insurance and sanctions.",
    )
    parser.add_argument(
        "--sources",
        type=Path,
        help="Optional path to a JSON file with a list of feed definitions.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=15,
        help="Maximum number of articles to capture per feed (after keyword filtering).",
    )
    parser.add_argument(
        "--format",
        choices=["json", "markdown"],
        default="markdown",
        help="Output format for aggregated items.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Path to write the formatted news. Defaults to stdout if omitted.",
    )
    parser.add_argument(
        "--log-level",
        default="WARNING",
        help="Logging level (DEBUG, INFO, WARNING, ERROR).",
    )
    return parser


def _load_sources(path: Path | None) -> Sequence[FeedSource]:
    if path is None:
        return DEFAULT_SOURCES
    return load_sources(path)


def _serialize(articles: Sequence[Article], format: str) -> str:
    if format == "json":
        return json.dumps([article.to_dict() for article in articles], ensure_ascii=False, indent=2)
    return as_markdown(articles)


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.WARNING))

    sources = _load_sources(args.sources)
    articles = collect_all(sources, keywords=args.keywords, per_feed_limit=args.limit)
    payload = _serialize(articles, args.format)

    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload)


if __name__ == "__main__":  # pragma: no cover
    main()
