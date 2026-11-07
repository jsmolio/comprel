// Publish compact facts and a display snapshot from the public tournament cache.
// Does not connect to Postgres. Exit 0 only after a snapshot rename that passed
// the publish gate. Any other exit leaves the previous snapshot in place.
// The scheduled workflow commits only when this process exits 0.

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import fs from "node:fs";
import path from "node:path";
import { classifierVersion } from "../src/lib/facts/classifier-version";
import { syncBansToExtras } from "../src/lib/facts/bans";
import { cardNamesFromBoards, enrichCardSnaps } from "../src/lib/facts/cards";
import { normalizeCacheItem } from "../src/lib/facts/normalize";
import { publishSnapshot } from "../src/lib/facts/publish";
import { decidePublish } from "../src/lib/facts/publish-policy";
import { FactStore, withPublishLock } from "../src/lib/facts/store";
import type { SnapshotCoverage } from "../src/lib/facts/types";
import { importMtgo } from "../src/lib/sources/mtgo";
import { discoverRecentCacheFiles, SOURCE_LABELS, type DiscoveredCacheFile } from "../src/lib/sources/mtgodecklistcache";
import { FORMATS, type Format, type RawCacheItem } from "../src/lib/types";

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 4;
const POOL = 6;

interface ProgressFile {
  schemaVersion: 1;
  classifierVersion: string;
  done: string[];
}

function progressPath(store: FactStore): string {
  return path.join(store.factDir, "progress.json");
}

function loadDone(store: FactStore, version: string): Set<string> {
  const file = progressPath(store);
  if (!fs.existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ProgressFile;
    if (parsed.classifierVersion !== version) return new Set();
    return new Set(parsed.done ?? []);
  } catch {
    return new Set();
  }
}

function saveDone(store: FactStore, version: string, done: Set<string>) {
  const file = progressPath(store);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: ProgressFile = { schemaVersion: 1, classifierVersion: version, done: [...done].sort() };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, file);
}

type FetchResult = { kind: "event"; item: RawCacheItem } | { kind: "empty" } | { kind: "failed" };

async function fetchJson(url: string): Promise<FetchResult> {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "comprel-ingest" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = await res.text();
        if (!text.trim()) return { kind: "empty" };
        try {
          return { kind: "event", item: JSON.parse(text) as RawCacheItem };
        } catch {
          return { kind: "failed" };
        }
      }
      if (res.status === 404 || (res.status !== 429 && res.status < 500)) return { kind: "failed" };
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return { kind: "failed" };
}

function cacheUrl(sourcePath: string): string {
  const parts = sourcePath.split("/").map((part) => encodeURIComponent(part));
  return `https://raw.githubusercontent.com/fbettega/MTG_decklistcache/main/${parts.join("/")}`;
}

async function mapPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, () => run()));
}

function folderSpan(files: DiscoveredCacheFile[]): { newest: string | null; oldest: string | null } {
  const dates = files.map((file) => file.folderDate).sort();
  return { oldest: dates[0] ?? null, newest: dates[dates.length - 1] ?? null };
}

function lagDays(newest: string | null, now: Date): number | null {
  if (!newest) return null;
  const then = Date.parse(`${newest}T00:00:00.000Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
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
  const allowIncompleteMtgo = args.has("--allow-incomplete-mtgo");
  // `--out`, not `--dir`: pnpm treats `--dir` as its own workspace option.
  const root = flag("out") || process.cwd();
  const store = new FactStore(root);
  const version = classifierVersion();
  const allow = new Set<Format>(FORMATS);
  const log = (message: string) => console.log(message);
  const done = loadDone(store, version);
  const failed: string[] = [];
  let emptyFiles = 0;

  const code = await withPublishLock(store, async () => {
    log(`→ Discovering ${days} cache day(s) across ${yearsToScan} year(s)…`);
    const files = await discoverRecentCacheFiles(days, yearsToScan);
    const span = folderSpan(files);
    log(`  ${files.length} files, folders ${span.oldest ?? "none"} → ${span.newest ?? "none"}`);
    let written = 0;
    let skipped = 0;
    let finished = 0;
    const started = Date.now();

    await mapPool(files, async (file) => {
      if (!incremental && done.has(file.fullPath)) {
        skipped++;
        finished++;
        return;
      }
      const fetched = await fetchJson(file.rawUrl);
      if (fetched.kind === "failed") {
        failed.push(file.fullPath);
        finished++;
        return;
      }
      if (fetched.kind === "empty") {
        emptyFiles++;
        done.add(file.fullPath);
        skipped++;
        finished++;
        return;
      }
      const item = fetched.item;
      const stableId = file.fullPath.split("/").pop()!.replace(/\.json$/i, "");
      const normalized = normalizeCacheItem(file.label, stableId, item, allow, version, file.fullPath);
      if (normalized) {
        const put = store.putEvent(normalized.event);
        if (put.changed) written++;
        else skipped++;
      } else {
        skipped++;
      }
      done.add(file.fullPath);
      finished++;
      if (finished % 25 === 0) saveDone(store, version, done);
      if (finished % 100 === 0 || finished === files.length) {
        const elapsed = (Date.now() - started) / 1000;
        log(`  ${finished}/${files.length} in ${elapsed.toFixed(0)}s (wrote ${written}, skipped ${skipped}, failed ${failed.length})`);
      }
    });
    saveDone(store, version, done);
    log(`  cache events changed ${written}, unchanged or untracked ${skipped}, failed ${failed.length}`);

    let mtgo: SnapshotCoverage["mtgo"] = noMtgo ? "skipped" : "ok";
    if (!noMtgo && failed.length === 0) {
      log("→ Scraping MTGO for same-day events…");
      const scraped = await importMtgo({
        days: Math.min(days, 4),
        log,
        onItem: (item, slug, format) => {
          const inSlug = slug.match(/(\d{4})-(\d{2})-(\d{2})/);
          const date = new Date(item.Tournament.Date);
          const y = inSlug?.[1] ?? String(date.getUTCFullYear());
          const m = inSlug?.[2] ?? String(date.getUTCMonth() + 1).padStart(2, "0");
          const d = inSlug?.[3] ?? String(date.getUTCDate()).padStart(2, "0");
          const sourcePath = `Tournaments/MTGO/${y}/${m}/${d}/${slug}.json`;
          const normalized = normalizeCacheItem("mtgo.com", slug, item, allow, version, sourcePath, format);
          if (!normalized) return;
          store.putEvent(normalized.event);
          // The cache file may not exist yet. Keep the lists we just scraped.
          store.writeBoards(normalized.event.id, normalized.boards);
        },
      });
      if (scraped.structuralFailure) mtgo = "unavailable";
    }

    const decision = decidePublish({
      discovered: files.length,
      failed: failed.length,
      mtgo,
      allowIncompleteMtgo,
    });
    if (!decision.publish) {
      log(`→ Holding previous snapshot: ${decision.reason}`);
      if (failed.length) log(`  first failures: ${failed.slice(0, 8).join(", ")}`);
      return 1;
    }

    if (!noPrune) {
      const { deleted } = store.pruneToHorizon(store.allEvents());
      log(`  pruned ${deleted.length} event(s) older than the trend horizon`);
    }

    if (!noBans) {
      log("→ Syncing ban lists into the extras sidecar…");
      store.writeExtras(await syncBansToExtras(store.readExtras(), log));
    }

    const now = new Date();
    const coverage: SnapshotCoverage = {
      complete: true,
      requestedDays: days,
      discovered: files.length,
      ingested: files.length - failed.length,
      failed: failed.length,
      emptyFiles,
      newestFolderDate: span.newest,
      oldestFolderDate: span.oldest,
      cacheLagDays: lagDays(span.newest, now),
      mtgo,
    };
    if (coverage.cacheLagDays != null && coverage.cacheLagDays > 2) {
      log(`  ! newest cache folder is ${coverage.cacheLagDays} days behind ${now.toISOString().slice(0, 10)}`);
    }

    log("→ Publishing snapshot…");
    const published = await publishSnapshot(store, {
      classifierVersion: version,
      coverage,
      log,
      prepareCards: noScryfall
        ? undefined
        : (boards, previous) => enrichCardSnaps(cardNamesFromBoards(boards), previous, log),
      fetchNormalized: async (sourcePath) => {
        const folder = sourcePath.split("/")[1];
        const label = SOURCE_LABELS[folder];
        if (!label) return null;
        const fetched = await fetchJson(cacheUrl(sourcePath));
        if (fetched.kind !== "event") return null;
        const stableId = sourcePath.split("/").pop()!.replace(/\.json$/i, "");
        return normalizeCacheItem(label, stableId, fetched.item, allow, version, sourcePath);
      },
    });
    log(published.changed ? `  snapshot updated (${decision.reason})` : "  snapshot unchanged");
    return 0;
  });

  if (code !== 0) process.exit(code);
  console.log("✓ Publish finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
