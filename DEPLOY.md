# Deploying compREL

The site reads `data/published/snapshot.json` from the deployment. It does not open Postgres at request time. Filter URLs (`?window=&source=`) are still server-rendered from that file. This is not a fully static HTML export of every filter combination.

Postgres, Prisma, and `pnpm export-db` remain for a read-only copy of the existing database. Nothing in the request path writes to it.

## What is stored

- `data/facts/v1/events/` — one file per event, keyed by `source:stableId`, sharded by id hash. Rewritten only when that event’s content changes.
- `data/facts/v1/index/` — one small index per shard, not a single rewritten catalog.
- `data/facts/v1/boards/` — card lists for the five newest decks per format, source, and archetype. Other lists are not kept. Classification never reads these files.
- `data/facts/v1/extras.json` — videos and detected ban changes. Created by `pnpm export-db` or by ban sync. Public backfill cannot recreate videos or historical detected bans.
- `data/published/snapshot.json` — the only file the app reads. Replaced by rename. If publishing throws first, the previous file stays.

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

On-demand video search still works when `YOUTUBE_API_KEY` is set, and those hits are not saved.

## Scheduled publish

`.github/workflows/ingest.yml` runs `pnpm backfill --incremental` and commits `data/facts` and `data/published` only when that process exits 0. A missed cache file or a structural MTGO failure exits 1 before the snapshot is renamed, and GitHub Actions then skips the commit step. There is no path that pushes a snapshot and fails the job afterwards. Passing `--allow-incomplete-mtgo` publishes a cache-complete snapshot that records MTGO as unavailable. The scheduled workflow does not pass that flag.

The workflow stays disabled in the GitHub UI through the first production release. Merging the YAML does not turn a manually disabled workflow back on. Do not dispatch it until that first snapshot is on main and you want the two-hour refresh. A later push to `main` from the enabled job is a production Vercel deploy. Pushes to this PR branch are preview deploys.

Pushing to `main` is what updates production: Vercel deploys that push. GitHub will not start another run of this workflow from the bot’s own push. Do not enable or dispatch the workflow until a snapshot has been reviewed. The workflow was disabled manually; merging this file does not turn it back on.

If `main` requires a pull request, the bot push fails and nothing deploys. Token write permission is declared in the workflow. An organization cap of read-only actions tokens will also reject the push.

## Rollback

The previous deployment keeps serving until a newer one exists. To go back to Postgres reads, revert this branch’s application changes and point the site at the database again. The database is not altered by the new path. `pnpm ingest` is still the legacy writer; do not run it against production unless a write is intended.

## App environment

Runtime does not need `DATABASE_URL` or `DIRECT_URL`. `prisma generate` runs at install and does not connect. Optional: `YOUTUBE_API_KEY` for unsaved video search.

`/api/ingest` returns 410 for every caller. It cannot write.
