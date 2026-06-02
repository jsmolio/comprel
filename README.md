# compREL

A one-stop site for competitive **Magic: the Gathering** — metagame share, tournament
decklists, and **head-to-head matchup win rates** computed from real pairing data across
every constructed format (Standard, Pioneer, Modern, Legacy, Vintage, Pauper).

Built with Next.js 16 (App Router) + TypeScript + Tailwind v4 + Prisma. No HTML scraping —
all data comes from open datasets and official APIs.

## What it does

- **Metagame share** per format and rolling window (14 / 30 / 90 days).
- **Two distinct win-rate signals**, never conflated:
  - _Aggregate win rate_ — a deck's overall match win % across all events (high volume, MTGO + paper).
  - _Head-to-head matchups_ — deck-vs-deck win % from round-by-round pairings, shown with sample size
    and a **Wilson 95% confidence interval** so small samples are obvious.
- **Decklists** grouped by card type, with hover card previews (Scryfall), price estimates,
  and links back to the source event.
- **Matchup matrix** — a numbered heatmap of the top archetypes for each format.
- **Gameplay videos** per archetype via the YouTube Data API (optional).

## Data sources (no scraping)

| Layer | Source | Notes |
| --- | --- | --- |
| Decklists + tournaments + pairings | [MTG_decklistcache](https://github.com/fbettega/MTG_decklistcache) | Open dataset aggregating MTGO, Melee, TopDeck, Manatraders, CardsRealm |
| Archetype rules + card colors | [MTGOFormatData](https://github.com/Badaro/MTGOFormatData) | Vendored under `data/mtgoformatdata/` (+ local overrides in `data/rule-overrides/`) |
| Card images / oracle / prices | [Scryfall API](https://scryfall.com/docs/api) | Official, keyless |
| Gameplay videos | YouTube Data API v3 | Optional, needs `YOUTUBE_API_KEY` (lazy, on-demand) |

Head-to-head matchups are **computed here** from pairings + archetype classification — they are
not fetched pre-aggregated from anyone.

## Architecture

```
data/mtgoformatdata/     vendored archetype + color rules
prisma/schema.prisma     SQLite (dev) — portable to Postgres/Supabase
src/lib/
  sources/               mtgodecklistcache, scryfall, youtube
  archetype/             rules-based classifier (12 condition types) + color naming
  analytics/aggregate    meta share, aggregate win rate, matchup matrix + Wilson CI
  queries.ts             server-side reads for the pages
src/app/                 / , /[format] , /[format]/[archetype]
src/components/          MetaShareTable, MatchupMatrix, MatchupTable, DeckList, ...
scripts/                 ingest, enrich, videos, watch
```

## Setup

```bash
pnpm install
pnpm db:push            # create the SQLite database
pnpm ingest --days=30   # import -> classify -> aggregate -> enrich cards (real data)
pnpm dev                # http://localhost:3000
```

Optional enrichment:

```bash
YOUTUBE_API_KEY=...  pnpm tsx scripts/videos.ts    # warm the video cache (videos also load lazily on demand)
```

## Scripts

- `pnpm ingest [--days=N] [--no-scryfall]` — full pipeline.
- `pnpm ingest:incremental` — only fetch/import new tournaments (skips known files), then re-aggregate.
- `pnpm aggregate` — recompute meta/matchup stats only.
- `pnpm tsx scripts/enrich.ts` — backfill card data from Scryfall.
- `pnpm tsx scripts/videos.ts` — warm the YouTube video cache (needs key).

## Automatic ingestion

The upstream cache updates daily, so "auto-ingest" just means running the incremental ingest on a
schedule. Pick one:

**Foreground (no setup)** — run it and leave the terminal open:

```bash
pnpm watch                       # incremental ingest now, then every 6h
INGEST_INTERVAL_HOURS=3 pnpm watch
```

**Local cron (macOS, hands-off)** — a launchd agent that runs 4×/day:

```bash
cp deploy/com.comprel.ingest.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.comprel.ingest.plist
launchctl kickstart -k gui/$(id -u)/com.comprel.ingest   # run once now
tail -f ~/Library/Logs/comprel-ingest.log                # watch it
# uninstall: launchctl bootout gui/$(id -u)/com.comprel.ingest && rm ~/Library/LaunchAgents/com.comprel.ingest.plist
```

**HTTP trigger (production)** — `POST/GET /api/ingest`, guarded by `INGEST_TOKEN` (or Vercel's
`CRON_SECRET`). [`vercel.json`](vercel.json) already schedules it every 6 hours via Vercel Cron;
any scheduler that can hit a URL works too.

## Going to production

The schema is written to port cleanly to Postgres/Supabase: change the Prisma `datasource`
provider + `DATABASE_URL`, run `prisma migrate`, and let Vercel Cron hit `/api/ingest` for refresh.

---

compREL is an unofficial fan project. Magic: the Gathering is © Wizards of the Coast.
Tournament data via MTGODecklistCache; archetype rules via MTGOFormatData; card data via Scryfall.
