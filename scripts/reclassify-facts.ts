// Refetch source files and reclassify events whose classifierVersion is stale.
// A failed fetch keeps the stored archetype. Empty local boards are never classified.

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
import { FORMATS, type Format, type RawCacheItem } from "../src/lib/types";

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
      const normalized = normalizeCacheItem(label, stableId, item, allow, version, event.sourcePath, event.format);
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
