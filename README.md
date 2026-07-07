# Maritime Tanker Intelligence Bot

A cloud-based Telegram bot that monitors legally accessible public sources and
delivers structured intelligence on:

- **Oil tanker transportation** — crude and petroleum products by sea
- **Tanker markets** — VLCC, Suezmax, Aframax, product tankers, freight rates
- **Marine insurance** — P&I, Hull & Machinery, war risk, cargo insurance
- **Sanctions & compliance** — designations, licenses, guidance, enforcement
- **Shipbuilding** — only where it affects oil tanker fleet capacity
- **Ports & routes** — chokepoints, disruptions, geopolitical risk

The bot does **not** repost news. Every item is converted by an LLM into
structured, business-oriented intelligence: what happened, why it matters,
impact on oil transportation, insurance implications (P&I / H&M / war risk),
sanctions/compliance implications, and practical review actions. LNG/gas and
general shipping topics are excluded.

**Russian is the default publication language.** Analysis runs in English (or
the source language); before anything is sent, a second AI pass produces a
polished business-Russian version (`app/ai/prompts/translate_to_russian.md`):
faithful to the original, no added facts, no softened risks, standard
abbreviations (P&I, H&M, VLCC, IMO, OFAC, …) kept in English, and
"not available in source" rendered as «не указано в источнике». Alerts, list
commands and Daily/Weekly reports are delivered in Russian, falling back to
English only if a translation failed (`publication_ready_ru = false`). Both
report language versions are stored (`content_md_en` / `content_md_ru`).

Everything runs in the cloud in a single container — the user interacts
through Telegram only. No local scripts, databases or schedulers required.

## Architecture

```
one process / one container
├── Telegram bot (aiogram 3, long-polling — no inbound webhook needed)
├── Monitoring pipeline (hourly):
│     fetch (RSS + robots-respecting HTML listings)
│     → normalize → pre-dedup (URL/title/simhash)
│     → keyword prefilter (hard LNG/gas exclusion)
│     → OpenAI structured analysis (Pydantic-validated JSON, retry once)
│     → event-level dedup & merge (all sources kept, confidence boost)
│     → materiality rules → Russian publication translation
│     → store → High-materiality alerts in Russian (send-once)
├── Reports: Daily Brief 09:30 Asia/Aqtau, Weekly Report Mon 09:30 Asia/Aqtau
├── APScheduler (all times in APP_TIMEZONE, default Asia/Aqtau)
└── FastAPI: /healthz + token-gated manual triggers
        ↕
PostgreSQL (production) / SQLite (zero-setup development)
```

Key modules:

| Path | Purpose |
|---|---|
| `app/sources/` | RSS + HTML fetchers, robots.txt respect, honest User-Agent |
| `app/pipeline/` | normalize, prefilter, dedup, materiality, monitor orchestrator |
| `app/ai/` | provider-agnostic LLM client (OpenAI default), schemas, prompts |
| `app/bot/` | private-access middleware, command handlers, alert dispatch |
| `app/reports/` | Daily/Weekly report composition and delivery |
| `app/jobs/` | APScheduler wiring, manual run CLI |
| `config/sources.yaml` | seed source registry (categories, authority ranks) |
| `migrations/` | Alembic migrations |

## Bot commands

`/latest` `/high` `/sanctions` `/insurance` `/pi` `/hm` `/warrisk` `/market`
`/vlcc` `/aframax` `/suezmax` `/shipbuilding` `/ports` `/search <keyword>`
`/daily` `/weekly` `/subscribe` `/settings` `/unsubscribe` `/status` `/help`

Admin only: `/run` (trigger monitoring now), `/approve <telegram_id>`,
`/revoke <telegram_id>`.

**Access is private by default.** Only users in `ADMIN_TELEGRAM_USER_IDS` or
approved via `/approve` can use the bot; everyone else sees
*"Access restricted. Please contact the administrator."*

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | Token from @BotFather |
| `ADMIN_TELEGRAM_USER_IDS` | yes | Comma-separated numeric Telegram IDs |
| `DATABASE_URL` | yes | `postgresql+asyncpg://…` (prod) or `sqlite+aiosqlite:///./data/app.db` (dev) |
| `LLM_PROVIDER` | no | `openai` (default; layer is provider-agnostic) |
| `OPENAI_API_KEY` | yes | OpenAI API key (backend only, never client-side) |
| `OPENAI_MODEL` | no | default `gpt-4o-mini` |
| `OPENAI_REPORT_MODEL` | no | stronger model for daily/weekly reports (optional) |
| `APP_ENV` | no | `development` / `production` |
| `LOG_LEVEL` | no | default `INFO` |
| `APP_TIMEZONE` | no | default `Asia/Aqtau` (scheduling + displayed times) |
| `ADMIN_API_TOKEN` | yes | Bearer token for `POST /admin/run-monitoring` |
| `PORT` | no | HTTP port for health/admin API (default 8000) |

Copy `.env.example` to `.env` and fill in values. **Never commit secrets.**

## Run locally

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env        # fill in TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, ADMIN_TELEGRAM_USER_IDS
python -m app.main          # starts bot + scheduler + health API (SQLite by default)
```

Useful:

```bash
python -m app.jobs.run_monitoring      # run one monitoring cycle manually
python -m scripts.seed_sample_data     # load demo intelligence items
pytest                                 # run the test suite
alembic upgrade head                   # apply migrations (tables are also auto-created on boot)
```

### Docker Compose (app + PostgreSQL)

```bash
cp .env.example .env   # fill values
docker compose up --build
```

## Deployment (Render — primary path)

1. Push this repository to GitHub.
2. In Render: **New → Web Service**, connect the repo, environment **Docker**.
3. Add a **PostgreSQL** instance (Render managed). Copy its *Internal Database
   URL* and set `DATABASE_URL`, replacing `postgres://` with
   `postgresql+asyncpg://`.
4. Set the remaining environment variables from the table above.
5. Deploy. Render's health check can point at `/healthz` on the exposed port.

The hourly monitor, the 09:30 Daily Brief, and the Monday 09:30 Weekly Report
(Asia/Aqtau) all run inside the service via APScheduler — no separate worker
or cron needed. If you prefer an external scheduler, call
`POST /admin/run-monitoring` with `Authorization: Bearer $ADMIN_API_TOKEN`
from Render Cron / GitHub Actions and disable nothing — runs are idempotent
and duplicate-safe.

**Railway / Fly.io:** same container works as-is. Provision managed Postgres,
set the env vars, expose port 8000 for health checks. On Fly, add
`internal_port = 8000` to `fly.toml`.

> Note: long-polling requires a single always-on instance (scale = 1).

## Getting started as a user

1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. Get your numeric Telegram ID (e.g. from @userinfobot) and put it in
   `ADMIN_TELEGRAM_USER_IDS`.
3. Deploy, open your bot, send `/start`.
4. `/run` to trigger the first monitoring cycle, `/latest` to see results,
   `/settings` to tune alert topics.
5. Grant colleagues access with `/approve <their_telegram_id>`.

## Source discipline (legal access)

The monitor uses only legally accessible public sources (see
`config/sources.yaml`): official regulator publications (OFAC, OFSI, EU
Council, IMO), P&I club news pages, canal/port authority notices, and public
maritime press RSS feeds. The fetcher:

- respects `robots.txt` for HTML pages and sends an honest `User-Agent`;
- stores only headline + bounded excerpt + link — never full article bodies;
- never authenticates, never bypasses paywalls, never shares credentials;
- summarizes and transforms content into original intelligence rather than
  reproducing articles.

Before enabling additional sources, check their terms of use.

## Data model

Ten tables: `sources`, `raw_items`, `intelligence_items`, `duplicate_groups`,
`entities` (+ link table), `alerts`, `users`, `subscriptions`, `reports`,
`monitoring_runs`. Each intelligence item stores the full structured payload
(entities, impacts, implications, review points, materiality, confidence,
classification, merged source links). Alerts have a DB-level unique
constraint guaranteeing each user is alerted at most once per event.

## Tests

```bash
pytest
```

Covers: keyword prefilter and LNG/gas exclusion, AI schema validation and
retry/analysis-failed policy, both dedup stages (URL/title/simhash and
event-key merge with confidence boost), materiality rule floors, the Russian
publication layer (fields generated in the pipeline, «не указано в источнике»
normalization, preserved P&I/H&M/VLCC abbreviations, Russian-default Telegram
output, dual-language reports), Telegram formatting (required alert sections,
4096-char chunking), and an end-to-end monitoring run with faked fetchers and
a fake LLM.
