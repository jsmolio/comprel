// Foreground auto-ingest: runs an incremental ingest now, then every N hours.
// No OS setup required — just `pnpm watch` in a terminal and leave it running.
//   INGEST_INTERVAL_HOURS=3 pnpm watch
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { importMtgoCache } from "../src/lib/sources/mtgodecklistcache";
import { computeAllAggregates } from "../src/lib/analytics/aggregate";
import { enrichCardsFromDb } from "../src/lib/sources/scryfall";

const INTERVAL_HOURS = Number(process.env.INGEST_INTERVAL_HOURS) || 6;

async function runOnce() {
  const started = new Date().toISOString();
  try {
    const summary = await importMtgoCache({ skipExisting: true, dayFolders: 5 });
    await computeAllAggregates();
    const enriched = await enrichCardsFromDb();
    console.log(`[${started}] ingested: ${JSON.stringify({ ...summary, enriched })}`);
  } catch (e) {
    console.error(`[${started}] ingest failed:`, (e as Error).message);
  }
}

async function main() {
  console.log(`compREL auto-ingest — every ${INTERVAL_HOURS}h. Ctrl-C to stop.`);
  await runOnce();
  setInterval(runOnce, INTERVAL_HOURS * 3_600_000);
}

main();
