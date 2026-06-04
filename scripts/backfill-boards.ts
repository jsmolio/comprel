// One-time backfill: restore card lists for the N most-recent decks per archetype
// that were slimmed away, by re-fetching only those decks' tournaments from the
// source cache. Targeted (no full re-import) so it adds no storage spike.
//   pnpm backfill-boards               (writes restored lists)
//   pnpm backfill-boards --dry-run     (no writes; just reports reachability)
//   pnpm backfill-boards --per=5 --limit=40
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { REPO, SOURCE_LABELS } from "../src/lib/sources/mtgodecklistcache";
import type { RawCacheItem, RawDeckItem } from "../src/lib/types";

const FOLDER_OF: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_LABELS).map(([folder, label]) => [label, folder]),
);
const API = "https://api.github.com";

function flagNum(name: string, def: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
}

function toBoard(items: RawDeckItem[] | null | undefined) {
  return (items ?? []).map((i) => ({ name: i.CardName, count: i.Count }));
}

async function ghBranch(): Promise<string> {
  const headers: Record<string, string> = { "User-Agent": "comprel-backfill", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${API}/repos/${REPO}`, { headers });
  if (!res.ok) throw new Error(`github ${res.status} resolving default branch`);
  return ((await res.json()) as { default_branch: string }).default_branch;
}

// The folder date and the stored tournament date can differ by a day (timezone),
// so try the tournament date and its neighbours.
function candidateUrls(branch: string, source: string, date: Date, base: string): string[] {
  const folder = FOLDER_OF[source];
  if (!folder) return [];
  return [0, -1, 1].map((off) => {
    const d = new Date(date.getTime() + off * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `https://raw.githubusercontent.com/${REPO}/${branch}/Tournaments/${folder}/${y}/${m}/${day}/${encodeURIComponent(base)}.json`;
  });
}

async function fetchItem(urls: string[]): Promise<RawCacheItem | null> {
  for (const url of urls) {
    const res = await fetch(url, { headers: { "User-Agent": "comprel-backfill" } });
    if (res.ok) return (await res.json()) as RawCacheItem;
  }
  return null;
}

async function main() {
  const per = flagNum("per", 5);
  const limit = flagNum("limit", 0); // 0 = all
  const dryRun = process.argv.includes("--dry-run");

  // Decks among the N most-recent per (format, archetype) that currently have no list.
  const need = await prisma.$queryRawUnsafe<{ id: string; tournamentId: string; player: string }[]>(
    `WITH ranked AS (
       SELECT id, "tournamentId", player, mainboard,
              row_number() OVER (PARTITION BY format, archetype ORDER BY date DESC, id) AS rn
       FROM "Deck" WHERE archetype IS NOT NULL
     )
     SELECT id, "tournamentId", player FROM ranked WHERE rn <= $1 AND mainboard = '[]'::jsonb`,
    per,
  );
  const byTourney = new Map<string, { id: string; player: string }[]>();
  for (const d of need) {
    const a = byTourney.get(d.tournamentId) ?? [];
    a.push({ id: d.id, player: d.player });
    byTourney.set(d.tournamentId, a);
  }
  let tourneyIds = [...byTourney.keys()];
  if (limit > 0) tourneyIds = tourneyIds.slice(0, limit);
  console.log(
    `${need.length} decklists to restore across ${byTourney.size} tournaments` +
      `${limit ? ` (processing ${tourneyIds.length})` : ""}${dryRun ? " — DRY RUN (no writes)" : ""}`,
  );

  const tourneys = await prisma.tournament.findMany({
    where: { id: { in: tourneyIds } },
    select: { id: true, source: true, date: true },
  });
  const branch = await ghBranch();

  let restored = 0;
  let reachable = 0;
  let missed = 0;
  let i = 0;
  for (const t of tourneys) {
    const base = t.id.slice(t.source.length + 1);
    const item = await fetchItem(candidateUrls(branch, t.source, t.date, base));
    if (!item) {
      if (missed < 8) console.log(`  ! unreachable: ${t.id}`);
      missed++;
      continue;
    }
    reachable++;
    const byPlayer = new Map((item.Decks ?? []).map((dk) => [dk.Player, dk]));
    for (const { id, player } of byTourney.get(t.id)!) {
      const dk = byPlayer.get(player);
      if (!dk) continue;
      if (!dryRun) {
        await prisma.deck.update({
          where: { id },
          data: {
            mainboard: toBoard(dk.Mainboard) as unknown as Prisma.InputJsonValue,
            sideboard: toBoard(dk.Sideboard) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      restored++;
    }
    if (++i % 50 === 0) console.log(`  …${i}/${tourneys.length} tournaments, ${restored} lists ${dryRun ? "matched" : "restored"}`);
    await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`✓ ${dryRun ? "would restore" : "restored"} ${restored} decklists — ${reachable} tournaments reachable, ${missed} not found`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
