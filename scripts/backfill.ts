// Publish compact facts and a display snapshot from the public tournament cache.
// Does not connect to Postgres. Does not commit; the workflow commits after a
// successful exit. Exit 2 means the snapshot was written but the MTGO scrape
// reported a structural failure (the job should still commit, then fail).

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { classifierVersion } from "../src/lib/facts/classifier-version";
import { syncBansToExtras } from "../src/lib/facts/bans";
import { cardNamesFromBoards, enrichCardSnaps } from "../src/lib/facts/cards";
import { normalizeCacheItem } from "../src/lib/facts/normalize";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore, withPublishLock } from "../src/lib/facts/store";
import type { PlayerBoard } from "../src/lib/facts/types";
import { importMtgo } from "../src/lib/sources/mtgo";
import { discoverRecentCacheFiles, SOURCE_LABELS } from "../src/lib/sources/mtgodecklistcache";
import { FORMATS, type Format, type RawCacheItem } from "../src/lib/types";

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchJson(url: string): Promise<RawCacheItem | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "comprel-ingest" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as RawCacheItem;
}

function cacheUrl(sourcePath: string): string {
  const parts = sourcePath.split("/").map((part) => encodeURIComponent(part));
  return `https://raw.githubusercontent.com/fbettega/MTG_decklistcache/main/${parts.join("/")}`;
}

async function main() {
  const args = new Set(process.argv.slice(2).map((arg) => arg.split("=")[0]));
  const incremental = args.has("--incremental");
  const days = Number(flag("days")) || (incremental ? 5 : 790);
  const yearsToScan = Math.max(2, Math.ceil(days / 365) + 1);
  const noMtgo = args.has("--no-mtgo");
  const noScryfall = args.has("--no-scryfall");
  const noBans = args.has("--no-bans");
  const noPrune = args.has("--no-prune");
  // `--out`, not `--dir`: pnpm treats `--dir` as its own workspace option.
  const root = flag("out") || process.cwd();
  const store = new FactStore(root);
  const version = classifierVersion();
  const allow = new Set<Format>(FORMATS);
  const log = (message: string) => console.log(message);
  const memoryBoards = new Map<string, Record<string, PlayerBoard>>();

  const code = await withPublishLock(store, async () => {
    log(`→ Discovering ${days} cache day(s) across ${yearsToScan} year(s)…`);
    const files = await discoverRecentCacheFiles(days, yearsToScan);
    log(`  ${files.length} files`);
    let written = 0;
    let skipped = 0;
    for (const file of files) {
      const item = await fetchJson(file.rawUrl);
      if (!item) {
        log(`  ! fetch failed ${file.fullPath}`);
        continue;
      }
      const stableId = file.fullPath.split("/").pop()!.replace(/\.json$/i, "");
      const normalized = normalizeCacheItem(file.label, stableId, item, allow, version, file.fullPath);
      if (!normalized) continue;
      const put = store.putEvent(normalized.event);
      if (put.changed) written++;
      else skipped++;
      memoryBoards.set(normalized.event.id, normalized.boards);
    }
    log(`  cache events changed ${written}, unchanged ${skipped}`);

    let mtgoStructural = false;
    if (!noMtgo) {
      log("→ Scraping MTGO for same-day events…");
      const mtgo = await importMtgo({
        days: Math.min(days, 4),
        log,
        onItem: (item, slug, format) => {
          const date = new Date(item.Tournament.Date);
          const y = date.getUTCFullYear();
          const m = String(date.getUTCMonth() + 1).padStart(2, "0");
          const d = String(date.getUTCDate()).padStart(2, "0");
          const sourcePath = `Tournaments/MTGO/${y}/${m}/${d}/${slug}.json`;
          const normalized = normalizeCacheItem("mtgo.com", slug, item, allow, version, sourcePath, format);
          if (!normalized) return;
          store.putEvent(normalized.event);
          memoryBoards.set(normalized.event.id, normalized.boards);
        },
      });
      mtgoStructural = mtgo.structuralFailure;
    }

    if (!noPrune) {
      const { deleted } = store.pruneToHorizon(store.allEvents());
      log(`  pruned ${deleted.length} event(s) older than the trend horizon`);
    }

    if (!noBans) {
      log("→ Syncing ban lists into the extras sidecar…");
      const extras = await syncBansToExtras(store.readExtras(), log);
      store.writeExtras(extras);
    }

    log("→ Publishing snapshot…");
    const published = await publishSnapshot(store, {
      classifierVersion: version,
      memoryBoards,
      log,
      prepareCards: noScryfall
        ? undefined
        : (boards, previous) => enrichCardSnaps(cardNamesFromBoards(boards), previous, log),
      fetchNormalized: async (sourcePath) => {
        const folder = sourcePath.split("/")[1];
        const label = SOURCE_LABELS[folder];
        if (!label) return null;
        const item = await fetchJson(cacheUrl(sourcePath));
        if (!item) return null;
        const stableId = sourcePath.split("/").pop()!.replace(/\.json$/i, "");
        return normalizeCacheItem(label, stableId, item, allow, version, sourcePath);
      },
    });
    log(published.changed ? "  snapshot updated" : "  snapshot unchanged");
    return mtgoStructural ? 2 : 0;
  });

  if (code === 2) {
    console.error("✗ MTGO scrape failed structurally. Snapshot from the public cache was still published.");
    process.exit(2);
  }
  console.log("✓ Publish finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
