# Deploying compREL

The site reads `data/published/magic/` and `data/published/riftbound/` from the deployment. It does not open Postgres at request time. Filter URLs (`?window=&source=`) are still server-rendered from those files. This is not a fully static HTML export of every filter combination.

Postgres, Prisma, and `pnpm export-db` remain for a read-only copy of the existing database. Nothing in the request path writes to it.

## What is stored

- `data/facts/v1/events/` — one file per event, keyed by `source:stableId`, sharded by id hash. Rewritten only when that event’s content changes.
- `data/facts/v1/index/` — one small index per shard, not a single rewritten catalog.
- `data/facts/v1/boards/` — card lists for the five newest decks per format, source, and archetype. Other lists are not kept. Classification never reads these files.
- `data/facts/v1/extras.json` — videos and detected ban changes. Created by `pnpm export-db` or by ban sync. Public backfill cannot recreate videos or historical detected bans.
- `data/published/magic/` — Magic display files (index, cards, and one file per format for summary, each matchup slice, and each source's lists). Replaced by a directory swap. If publishing throws first, the previous tree stays.
- `data/published/riftbound/` — Riftbound display files, split the same way. Magic and Riftbound do not share a file.

Facts are kept back to the format anchor minus 760 days (730 for the current 365-day window plus the previous 365-day trend window, plus 30 days of slack). The old scheduled command deleted tournaments older than 365 days from now, which dropped that previous window. This publisher does not. It also does not delete database rows.

Each event stores `sourcePath` so a later `pnpm reclassify-facts` can refetch the cache file. A failed refetch keeps the stored archetype. Pruned lists cannot be classified into Unknown.

## Bootstrap

No snapshot is committed in this change. An empty metagame is not a successful publish. The pages say so until a real snapshot exists.

Public cache (no database), from a checkout:

```bash
pnpm backfill --days=790 --no-mtgo
```

That downloads roughly two years of compact facts. It does not commit the upstream JSON. Review `data/facts` and `data/published`, then commit the compact files yourself. `--incremental` is the steady-state mode (latest 5 cache days plus a short MTGO scrape).

When the database is reachable again, this reads it and does not modify it:

```bash
DATABASE_URL="postgresql://…" pnpm export-db --yes-read-only
```

Use the direct connection string. The command copies tournaments, non-empty lists, videos, and detected ban rows, then builds a snapshot. Labels stay as stored. They are stamped `db-export:…` so a later reclassify will refetch instead of classifying empty boards.

Not recoverable from the public cache:

- YouTube rows stored only in `Video`
- `BanEvent` rows recorded by past ingests (curated dates in `src/lib/banlist.ts` still render)
- Any event the upstream cache has since removed

Videos are not searched from the website. The scheduled backfill may call YouTube `search.list` at most **36 times per UTC day**, including failed attempts and archetypes that enter the top set later that day. That is 6 formats × the top 6 archetypes in the 30-day all-sources slice, 100 quota units each, **3,600 units** against the default 10,000-unit daily quota. The 2-hour runs do not retry an archetype already attempted that UTC day. The next retry is the next UTC day.

Each stored link must have an 11-character YouTube id and a `publishedAt` within the last **90 days** (also sent as `publishedAfter`). A successful search, including one whose results are all too old or invalid, replaces that archetype's links. A quota error or other failure keeps that archetype's previous links and sets `videosState` to `degraded`, which the page states. No API key spends no attempts, keeps the saved links, and sets `no-key`. Neither case fails the tournament publish.

The workflow reads the Actions secret `YOUTUBE_API_KEY` and does not create it. Add a repository Actions secret with that exact name before expecting new links. Listing secrets returned 403 for this token, so it is not confirmed that the secret exists. A missing secret refreshes nothing.

Same-day MTGO pages that time out, return a non-200, or contain no decklists are logged with the public event URL and a reason. Those events are not imported and any facts already stored for them stay. The snapshot is still published and marked `mtgo: "partial"`. The run fails closed only when the cache file list is incomplete or the MTGO scrape is structural (the listing is gone, or every tracked event failed). A partial board file does not block a fetch of the players it is missing. One request is made per such event. A stored non-empty list is not replaced. A source that confirms a player has no list is not asked again for 7 days. A network failure is not cached and does not erase lists.

## Scheduled publish

`.github/workflows/ingest.yml` runs `pnpm backfill --incremental` and commits `data/facts` and `data/published` only when that process exits 0. A missed cache file or a structural MTGO failure exits 1 before the snapshot is renamed, and GitHub Actions then skips the commit step. There is no path that pushes a snapshot and fails the job afterwards. Passing `--allow-incomplete-mtgo` publishes a cache-complete snapshot that records MTGO as unavailable. The scheduled workflow does not pass that flag.

The workflow stays disabled in the GitHub UI through the first production release. Merging the YAML does not turn a manually disabled workflow back on. Do not dispatch it until that first snapshot is on main and you want the two-hour refresh. A later push to `main` from the enabled job is a production Vercel deploy. Pushes to this PR branch are preview deploys.

Pushing to `main` is what updates production: Vercel deploys that push. GitHub will not start another run of this workflow from the bot’s own push. Do not enable or dispatch the workflow until a snapshot has been reviewed. The workflow was disabled manually; merging this file does not turn it back on.

If `main` requires a pull request, the bot push fails and nothing deploys. Token write permission is declared in the workflow. An organization cap of read-only actions tokens will also reject the push.

## Rollback

The previous deployment keeps serving until a newer one exists. To go back to Postgres reads, revert this branch’s application changes and point the site at the database again. The database is not altered by the new path. `pnpm ingest` is still the legacy writer; do not run it against production unless a write is intended.

## App environment

Runtime does not need `DATABASE_URL`, `DIRECT_URL`, or `YOUTUBE_API_KEY`. `prisma generate` runs at install and does not connect. The YouTube key belongs on the GitHub Actions secret above, not on the website.

`/api/ingest` returns 410 for every caller. It cannot write.
