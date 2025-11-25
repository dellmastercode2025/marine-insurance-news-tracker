# marine-insurance-news-tracker

Automatically tracks and aggregates news related to marine insurance, reinsurance, shadow fleet, and maritime sanctions.

## Features
- Curated default RSS feeds focused on maritime, shipping, and insurance topics.
- Keyword filtering for marine insurance, sanctions, and shadow fleet coverage.
- Outputs aggregated items as Markdown or JSON, ready for reports or dashboards.

## Setup
```bash
pip install -r requirements.txt
```

## Usage
Fetch and print recent articles filtered by the default marine insurance keywords:
```bash
python -m news_tracker.cli --limit 10
```

Produce a JSON payload and write it to `out/news.json`:
```bash
python -m news_tracker.cli --format json --output out/news.json
```

Provide your own feed list via JSON (array of `{ "name": "Source", "url": "..." }` objects):
```bash
python -m news_tracker.cli --sources custom_feeds.json --keywords "marine insurance" "OFAC" "P&I"
```

Use `--help` to see all options:
```bash
python -m news_tracker.cli --help
```
