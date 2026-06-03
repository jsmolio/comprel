// compREL ingest CLI.
//   pnpm ingest                 full run: import -> aggregate -> enrich cards
//   pnpm ingest --days=21       widen the import window (default 12 day-folders)
//   pnpm ingest --no-scryfall   skip card image/price enrichment
//   pnpm aggregate              recompute stats only (no fetching)

// Load .env without a dependency (Node >= 20.12 / 22).
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { importMtgoCache } from "../src/lib/sources/mtgodecklistcache";
import { computeAllAggregates } from "../src/lib/analytics/aggregate";
import { enrichCardsFromDb } from "../src/lib/sources/scryfall";
import { syncBanlist } from "../src/lib/sources/banlist-sync";
import { pruneOldData } from "../src/lib/retention";
import { prisma } from "../src/lib/db";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  const args = new Set(process.argv.slice(2).map((a) => a.split("=")[0]));
  const aggregateOnly = args.has("--aggregate-only");
  const incremental = args.has("--incremental");
  const days = Number(flag("days")) || (incremental ? 5 : 12);
  const keepBoardsDays = Number(flag("keep-boards-days")) || undefined;
  const retentionDays = Number(flag("retention-days")) || undefined;

  if (!aggregateOnly) {
    console.log(`→ Importing tournaments from MTGODecklistCache${incremental ? " (incremental)" : ""}…`);
    const summary = await importMtgoCache({
      dayFolders: days,
      skipExisting: incremental,
      keepBoardsSinceDays: keepBoardsDays,
      log: (m) => console.log(m),
    });
    console.log("  import summary:", JSON.stringify(summary));
  }

  if (!aggregateOnly && (keepBoardsDays || retentionDays)) {
    console.log("→ Pruning old data (retention + slim boards)…");
    await pruneOldData({ keepBoardsDays, retentionDays, log: (m) => console.log(m) });
  }

  console.log("→ Computing metagame + matchup aggregates…");
  await computeAllAggregates((m) => console.log(m));

  if (!aggregateOnly && !args.has("--no-scryfall")) {
    console.log("→ Enriching cards from Scryfall…");
    const n = await enrichCardsFromDb((m) => console.log(m));
    console.log(`  enriched ${n} cards`);

    try {
      console.log("→ Syncing B&R changes from Scryfall…");
      const { detected } = await syncBanlist((m) => console.log(m));
      console.log(`  ${detected} B&R change(s) recorded`);
    } catch (e) {
      console.log(`  ! B&R sync skipped: ${(e as Error).message}`);
    }
  }

  await prisma.$disconnect();
  console.log("✓ Done.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
