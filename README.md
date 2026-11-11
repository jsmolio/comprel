# compREL

A database-free Next.js site for competitive constructed metagames. Visitors pick a game
on `/`. **Magic: the Gathering** lives under `/magic`. **Riftbound** lives under `/riftbound`.
Every old Magic URL still works: `/modern` permanently redirects to `/magic/modern`, and
`/modern/<archetype>` to `/magic/modern/<archetype>`, query string included.

The site reads published snapshots. It does not open Postgres at request time.

| Game | Pages | Snapshot | Facts |
| --- | --- | --- | --- |
| Magic | `/magic`, `/magic/<format>`, `/magic/<format>/<archetype>` | `data/published/snapshot.json` | `data/facts/v1` |
| Riftbound | `/riftbound`, `/riftbound/<legend>` | `data/published/riftbound/snapshot.json` | `data/facts/riftbound/v1` |

Riftbound is not folded into the Magic snapshot. GitHub warns at 50 MB per file, and the
Magic snapshot is already near that line.

## Magic

Formats: Standard, Pioneer, Modern, Legacy, Vintage, Pauper. Windows: 7, 14, 30, 90, 365
days. Sources: all / paper / MTGO.

- Metagame share, with tails under 0.5% folded into Other.
- Top 8 and Top 32 conversion.
- Aggregate win rate, faded under 20 matches. It comes from pairings, not from a deck's stored record, and mirror matches are excluded.
- Head-to-head matrix for the top 12, with a Wilson 95% confidence interval.
- Archetype pages: signature cards, a 12-month share chart with ban markers, matchups, representative lists (hover images and prices), videos, and a sideboard-guide placeholder.
- Same-day MTGO misses stay in the snapshot coverage JSON and the ingest job summary. The site does not show them. A structural MTGO failure or any missed cache file keeps the previous Magic snapshot.

| Layer | Source |
| --- | --- |
| Decklists, tournaments, pairings | [MTG_decklistcache](https://github.com/fbettega/MTG_decklistcache) |
| Same-day MTGO | [mtgo.com decklists](https://www.mtgo.com/decklists) |
| Archetype rules | [MTGOFormatData](https://github.com/Badaro/MTGOFormatData), vendored under `data/mtgoformatdata/` |
| Card images and prices | [Scryfall](https://scryfall.com/docs/api) |
| Gameplay videos | YouTube Data API v3, optional `YOUTUBE_API_KEY` |

`/api/ingest` returns 410. Publishing is the scheduled workflow, not that route.
`/api/videos` still serves Magic videos from the snapshot (`?format=&archetype=`). It does
not call YouTube.

## Riftbound

Official constructed is one card pool, so there are no Modern/Legacy-style formats. The
format tabs are set eras, edited in [`data/riftbound/eras.json`](data/riftbound/eras.json):
Origins, Spiritforged, Unleashed, Vendetta, Vendetta post-ban, and Radiance. The same
rolling windows sit beside that filter. 2v2, trios, sealed, and draft are not ingested.

An archetype is a **legend**. Color identity is the six domains (Fury, Mind, Calm, Body,
Order, Chaos). Lists are shown as legend, champion, battlefields, main deck, rune deck,
and sideboard. Runes are treated like basic lands when picking signature cards. Empty
champion or battlefield zones are shown as zero. Prices are approximate TCGplayer USD.
Images are hotlinked from OpenRift at 400px, not bulk-mirrored.

Sources: all / UVS / PlayRiftbound / topdeck.gg / Chinese (loltcg). Chinese events count
toward share and are excluded from win rate and the head-to-head matrix. Mirror matches
are excluded and the pages say so. Events need at least 8 players.

Win rates, shares, and Wilson intervals are computed in this repo from raw standings and
pairings. BoundRift's aggregate stat endpoints are not the source of truth.

### What is different, or not available

- No paper/MTGO split. The source toggle is the organizer feed.
- No rules-based archetype taxonomy below the legend.
- PlayRiftbound events publish no decklists. The coverage JSON counts that gap.
- Chinese events publish lists and placements, not match results.
- Some events have standings and still no lists (`hasDeck` is false). Those pilots still count toward share when a legend is known.
- Sideboard guides are a placeholder, same as Magic.
- Gameplay search is `Riftbound {legend} gameplay`. It stays in the no-key state until `YOUTUBE_API_KEY` is set on the publisher. This repo does not configure that secret.
- Era bounds follow English set release dates from OpenRift, which match BoundRift's Radiance window. Chinese printings of earlier sets went on sale sooner; the file is the place to change that. Vendetta post-ban starts 2026-09-18, the date BoundRift documents and the day the rules hub was last updated. Ban dates come from OpenRift `card.bans` and match the cards and battlefields listed on the rules hub. The hub spells the battlefield as Dreaming Tree; the printed name is The Dreaming Tree.

### Sources, attribution, and terms

- Tournaments: [BoundRift](https://boundrift.com) public JSON API (`https://boundrift.com/api`, docs at `https://boundrift.com/llms.txt`). The ingest sends an identifiable User-Agent, keeps concurrency low, honors `Retry-After` on HTTP 429, and caches OpenRift responses with ETags. One event failing never blocks the snapshot. The previous snapshot is held only when the event list is unavailable or every fetched payload fails the shape check.
- Cards: [OpenRift](https://openrift.app/developers), no key. Please keep the User-Agent. Card text and images belong to Riot Games.
- Rules and the current ban list: [Riftbound Rules Hub](https://playriftbound.com/en-us/rules-hub/). There is no machine-readable ban API; `data/riftbound/eras.json` is the maintained copy.
- compREL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riftbound. Riftbound and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

## Scheduled ingest

[`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) runs every 2 hours. Magic and
Riftbound are separate steps. A failure restores that game's working tree and does not
block the other game's commit. Both failing commits nothing. The cron line is unchanged.
Do not dispatch the workflow by hand as part of a change; it stays disabled in the GitHub
UI until someone turns it back on.

```bash
pnpm backfill --incremental                  # Magic only
pnpm backfill --incremental --game=riftbound # Riftbound only
pnpm backfill --game=both                    # local: each game still publishes on its own
```

Magic structural failure (cache holes, MTGO unavailable) still refuses the Magic snapshot.
Riftbound's gate is looser: partial event coverage still publishes. Misses, unattempted
events, PlayRiftbound events with no lists, and events with no legend stay in the snapshot
coverage JSON and the ingest job summary. The site does not show them.

### First Riftbound snapshot

The committed Riftbound facts were generated on 2026-11-11 from BoundRift's featured
event list plus the regionals index. The pull is finished constructed events from the
prior 90 days: regionals, showdowns, other constructed events of 128+ players,
PlayRiftbound, and a 16-event skirmish sample spread across sources. Decklists are capped
at 24 per event (one list per legend, then the next best finishes). That run stored 66
events (about 10 MB of facts). The published snapshot is about 17 MB. One event
(`1247372`, Friday Morning Riftbound Open Play) returned no standings and is recorded as
a miss. Five nexus nights named no legend on standings or pairings and were not stored.
Two PlayRiftbound events are in the window with no lists. Regenerate with:

```bash
pnpm backfill --game=riftbound --days=90 --max-requests=3500 --budget-ms=1200000
```

`--publish-only` rebuilds the snapshot from facts and the OpenRift cache without
calling BoundRift. A smaller incremental run is what the workflow uses (`--incremental`
defaults to 400 requests and 8 minutes). If BoundRift cannot be reached, `/riftbound`
renders the missing snapshot state instead of an empty metagame, and the command above
is the first run.

OpenRift responses are cached under `data/cache/riftbound/`, which is gitignored.

## Scripts

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test
pnpm exec tsc --noEmit
pnpm build        # fails if a snapshot file is present but not schemaVersion 1 / status ok
```

`pnpm build` does not need `DATABASE_URL`. The legacy Prisma scripts (`pnpm db:push`,
`pnpm ingest`) are still in the repo and are not what the site or the scheduled job reads.

## Layout

```
data/facts/v1/                         Magic events, boards, extras
data/facts/riftbound/v1/               Riftbound events, boards, extras
data/published/snapshot.json           Magic display snapshot
data/published/riftbound/snapshot.json Riftbound display snapshot
data/riftbound/eras.json               era windows and ban markers
src/lib/facts/                         shared publish guard, Wilson interval, slice math
src/lib/riftbound/                     BoundRift ingest, era filter, snapshot builder
src/app/                               chooser, /magic, /riftbound
```

Snapshots are schema-checked and renamed into place. A throw before the rename leaves the
previous file untouched.

---

compREL is an unofficial fan project. Magic: the Gathering is © Wizards of the Coast.
Tournament data via MTGODecklistCache and BoundRift. Card data via Scryfall and OpenRift.
