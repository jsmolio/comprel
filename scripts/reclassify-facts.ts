// Refetch source files and reclassify events whose classifierVersion is stale.
// Writes data/facts/v1 event files and republishes data/published/magic. It does
// not open Postgres, read secrets, or change the scheduled workflow.
//
//   pnpm reclassify-facts
//
// The scheduled ingest reclassifies lists that are already stored when upstream
// rules change. This command is the full pass for every other list: it refetches
// sourcePath from the public decklist cache. A failed fetch keeps the stored
// archetype. Empty local boards are never classified.

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* optional */
}

import { classifierVersion } from "../src/lib/facts/classifier-version";
import { normalizeCacheItem } from "../src/lib/facts/normalize";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore, withPublishLock } from "../src/lib/facts/store";
import type { PlayerBoard } from "../src/lib/facts/types";
import { SOURCE_LABELS } from "../src/lib/sources/mtgodecklistcache";
import { createPremierDraftLookup, draftNumbersFromCacheItem, isPremierName } from "../src/lib/sources/premier-parse";
import { FORMATS, type Format, type RawCacheItem } from "../src/lib/types";

async function readUpstream(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "comprel-reclassify" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

const draftLookup = createPremierDraftLookup(readUpstream);

async function draftNumbersFor(item: RawCacheItem, stableId: string): Promise<Set<number> | null> {
  const fromItem = draftNumbersFromCacheItem(item);
  if (fromItem) return fromItem;
  const label = `${item.Tournament?.Name ?? ""} ${stableId}`;
  if (!isPremierName(label)) return null;
  try {
    return await draftLookup(label);
  } catch {
    return null;
  }
}

async function fetchItem(sourcePath: string): Promise<RawCacheItem | null> {
  const url = `https://raw.githubusercontent.com/fbettega/MTG_decklistcache/main/${sourcePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const res = await fetch(url, { headers: { "User-Agent": "comprel-reclassify" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  return (await res.json()) as RawCacheItem;
}

async function main() {
  const store = new FactStore(process.cwd());
  const version = classifierVersion();
  const allow = new Set<Format>(FORMATS);
  const memoryBoards = new Map<string, Record<string, PlayerBoard>>();
  let updated = 0;
  let kept = 0;
  let skipped = 0;

  await withPublishLock(store, async () => {
    for (const event of store.allEvents()) {
      if (event.classifierVersion === version) continue;
      if (!event.sourcePath) {
        skipped++;
        console.log(`  ! ${event.id}: no source path, keeping stored archetypes`);
        continue;
      }
      const item = await fetchItem(event.sourcePath);
      if (!item) {
        kept++;
        console.log(`  ! ${event.id}: refetch failed, keeping stored archetypes`);
        continue;
      }
      const folder = event.sourcePath.split("/")[1];
      const label = SOURCE_LABELS[folder] ?? event.source;
      const stableId = event.id.startsWith(`${label}:`) ? event.id.slice(label.length + 1) : event.sourcePath.split("/").pop()!.replace(/\.json$/i, "");
      const draftNumbers = await draftNumbersFor(item, stableId);
      const normalized = normalizeCacheItem(label, stableId, item, allow, version, event.sourcePath, event.format, draftNumbers);
      if (!normalized) {
        kept++;
        console.log(`  ! ${event.id}: refetch was not a tracked event, keeping stored archetypes`);
        continue;
      }
      normalized.event.id = event.id;
      store.putEvent(normalized.event);
      memoryBoards.set(event.id, normalized.boards);
      updated++;
    }
    await publishSnapshot(store, {
      classifierVersion: version,
      memoryBoards,
      log: (message) => console.log(message),
    });
  });
  console.log(`✓ reclassified ${updated}, kept after failed refetch ${kept}, no source path ${skipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
