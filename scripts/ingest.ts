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
import { importMtgo } from "../src/lib/sources/mtgo";
import { computeAllAggregates } from "../src/lib/analytics/aggregate";
import { enrichCardsFromDb } from "../src/lib/sources/scryfall";
import { syncBanlist } from "../src/lib/sources/banlist-sync";
import { pruneOldData } from "../src/lib/retention";
import { prisma } from "../src/lib/db";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

// Supabase's pooler occasionally refuses connections for a minute or two
// (and refuses them for longer stretches when the project is being restricted
// for quota overage). Retry with backoff before declaring the run dead, so a
// transient blip doesn't fire a failure email.
async function waitForDb() {
  const delaysMs = [0, 5_000, 15_000, 30_000, 60_000];
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      console.log(`  ! database unreachable (attempt ${i + 1}/${delaysMs.length}): ${(e as Error).message.trim().split("\n").pop()}`);
    }
  }
  throw new Error(
    "Database unreachable after ~2 minutes of retries. If this persists, check the Supabase dashboard — the project may be paused or restricted for exceeding free-tier quota (Settings → Usage).",
  );
}

async function main() {
  const args = new Set(process.argv.slice(2).map((a) => a.split("=")[0]));
  const aggregateOnly = args.has("--aggregate-only");
  const incremental = args.has("--incremental");
  const days = Number(flag("days")) || (incremental ? 5 : 12);
  const boardsPerArchetype = Number(flag("boards-per-archetype")) || undefined;
  const keepBoardsDays = Number(flag("keep-boards-days")) || undefined;
  const retentionDays = Number(flag("retention-days")) || undefined;

  console.log("→ Checking database connectivity…");
  await waitForDb();

  let newTournaments = 0;
  let mtgoBroken = false;

  if (!aggregateOnly) {
    console.log(`→ Importing tournaments from MTGODecklistCache${incremental ? " (incremental)" : ""}…`);
    const summary = await importMtgoCache({
      dayFolders: days,
      skipExisting: incremental,
      keepBoardsSinceDays: keepBoardsDays,
      log: (m) => console.log(m),
    });
    console.log("  import summary:", JSON.stringify(summary));
    newTournaments += summary.tournaments;

    if (!args.has("--no-mtgo")) {
      console.log("→ Scraping MTGO directly for same-day results…");
      const mtgo = await importMtgo({ days: 4, log: (m) => console.log(m) });
      console.log("  mtgo:", JSON.stringify(mtgo));
      newTournaments += mtgo.events;
      // Only a real, actionable break (listing 404 / page-structure change) fails the run.
      // Transient network/5xx blips self-heal next cycle, so they don't alert.
      mtgoBroken = mtgo.structuralFailure;
    }
  }

  if (!aggregateOnly && (boardsPerArchetype || keepBoardsDays || retentionDays)) {
    console.log("→ Pruning old data (retention + slim boards)…");
    await pruneOldData({ boardsPerArchetype, keepBoardsDays, retentionDays, log: (m) => console.log(m) });
  }

  if (aggregateOnly || newTournaments > 0) {
    console.log("→ Computing metagame + matchup aggregates…");
    await computeAllAggregates((m) => console.log(m));
  } else {
    console.log("→ No new tournaments — skipping aggregate + card enrichment.");
  }

  if (!aggregateOnly && !args.has("--no-scryfall")) {
    if (newTournaments > 0) {
      console.log("→ Enriching cards from Scryfall…");
      const n = await enrichCardsFromDb((m) => console.log(m));
      console.log(`  enriched ${n} cards`);
    }

    try {
      console.log("→ Syncing B&R changes from Scryfall…");
      const { detected } = await syncBanlist((m) => console.log(m));
      console.log(`  ${detected} B&R change(s) recorded`);
    } catch (e) {
      console.log(`  ! B&R sync skipped: ${(e as Error).message}`);
    }
  }

  await prisma.$disconnect();

  if (mtgoBroken) {
    console.error("✗ MTGO scrape failed (mtgo.com unreachable or page structure changed) — needs attention.");
    process.exit(1); // fail the run so GitHub Actions emails the repo owner
  }
  console.log("✓ Done.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
