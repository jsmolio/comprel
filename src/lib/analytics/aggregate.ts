import { prisma } from "../db";
import { FORMATS, SOURCE_GROUP_MEMBERS, WINDOW_CHOICES, type Format, type SourceFilter } from "../types";

/**
 * Wilson score interval for a binomial proportion. Gives a sane confidence
 * range even for tiny samples, which is exactly where naive win% misleads.
 */
export function wilson(successes: number, n: number, z = 1.96): { p: number; low: number; high: number } {
  if (n <= 0) return { p: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return { p, low: Math.max(0, (center - margin) / denom), high: Math.min(1, (center + margin) / denom) };
}

// Only build matchups among archetypes with at least this many decks in-window,
// so the matrix stays meaningful and bounded.
const MIN_DECKS_FOR_MATRIX = 3;

// Pair-key delimiter for the matchup grid. Archetype names contain spaces, so a
// space-joined key would split ambiguously and collide distinct pairs; a control
// char never appears in a deck/card name.
const SEP = String.fromCharCode(31);

const SOURCE_GROUPS: { key: SourceFilter; sources?: string[] }[] = [
  { key: "all" },
  { key: "paper", sources: SOURCE_GROUP_MEMBERS.paper },
  { key: "mtgo", sources: SOURCE_GROUP_MEMBERS.mtgo },
];

// Anchor the rolling window to a dense recent date (the 25th most recent deck)
// rather than the absolute max, so a lone stray tournament does not strand the
// window past the real bulk of the data. Computed across all sources so a given
// window covers the same calendar range for every source filter.
async function anchorDateForFormat(format: Format): Promise<Date | null> {
  const rows = await prisma.deck.findMany({
    where: { format },
    orderBy: { date: "desc" },
    take: 25,
    select: { date: true },
  });
  if (rows.length === 0) return null;
  return rows[rows.length - 1].date;
}

async function computeForWindow(
  format: Format,
  windowDays: number,
  anchor: Date,
  group: { key: SourceFilter; sources?: string[] },
) {
  const cutoff = new Date(anchor.getTime() - windowDays * 86_400_000);
  const sourceWhere = group.sources ? { tournament: { source: { in: group.sources } } } : {};

  const decks = await prisma.deck.findMany({
    where: { format, date: { gte: cutoff }, ...sourceWhere },
    select: { tournamentId: true, player: true, archetype: true, colorName: true },
  });

  // ---- Metagame share (every deck counts, including 5-0 league dumps) ----
  const byArch = new Map<string, { count: number; colorName: string | null }>();
  for (const dk of decks) {
    const key = dk.archetype ?? "Unknown";
    const e = byArch.get(key) ?? { count: 0, colorName: dk.colorName };
    e.count++;
    byArch.set(key, e);
  }
  const totalDecks = decks.length;

  const relevant = new Set([...byArch.entries()].filter(([, e]) => e.count >= MIN_DECKS_FOR_MATRIX).map(([a]) => a));

  // player -> archetype, scoped per tournament (a player runs one deck per event).
  const archOf = new Map<string, string>();
  for (const dk of decks) if (dk.archetype) archOf.set(`${dk.tournamentId}::${dk.player}`, dk.archetype);

  const matches = await prisma.match.findMany({
    where: { format, date: { gte: cutoff }, ...sourceWhere },
    select: { tournamentId: true, player1: true, player2: true, winner: true },
  });

  // Aggregate win rate is derived from PAIRINGS, not stored deck records, so MTGO
  // 5-0 league selection bias does not inflate it.
  type Rec = { w: number; l: number; d: number };
  const archRecord = new Map<string, Rec>();
  const rec = (a: string) => {
    let r = archRecord.get(a);
    if (!r) archRecord.set(a, (r = { w: 0, l: 0, d: 0 }));
    return r;
  };

  type Cell = { winsA: number; winsB: number; draws: number };
  const grid = new Map<string, Cell>();
  const cell = (a: string, b: string) => {
    const k = `${a}${SEP}${b}`;
    let c = grid.get(k);
    if (!c) grid.set(k, (c = { winsA: 0, winsB: 0, draws: 0 }));
    return c;
  };

  for (const m of matches) {
    const a1 = archOf.get(`${m.tournamentId}::${m.player1}`);
    const a2 = archOf.get(`${m.tournamentId}::${m.player2}`);
    if (!a1 || !a2 || a1 === a2) continue; // need both known; skip mirrors

    const r1 = rec(a1);
    const r2 = rec(a2);
    if (m.winner === 1) {
      r1.w++;
      r2.l++;
    } else if (m.winner === 2) {
      r1.l++;
      r2.w++;
    } else {
      r1.d++;
      r2.d++;
    }

    if (relevant.has(a1) && relevant.has(a2)) {
      const ab = cell(a1, a2);
      const ba = cell(a2, a1);
      if (m.winner === 1) {
        ab.winsA++;
        ba.winsB++;
      } else if (m.winner === 2) {
        ab.winsB++;
        ba.winsA++;
      } else {
        ab.draws++;
        ba.draws++;
      }
    }
  }

  const archStats = [...byArch.entries()].map(([archetype, e]) => {
    const r = archRecord.get(archetype) ?? { w: 0, l: 0, d: 0 };
    return {
      format,
      windowDays,
      source: group.key,
      archetype,
      colorName: e.colorName,
      deckCount: e.count,
      metaShare: totalDecks ? e.count / totalDecks : 0,
      matchWins: r.w,
      matchLosses: r.l,
      matchDraws: r.d,
      winRate: r.w + r.l > 0 ? r.w / (r.w + r.l) : 0,
    };
  });

  const matchupStats = [...grid.entries()].map(([k, c]) => {
    const [archetypeA, archetypeB] = k.split(SEP);
    const decided = c.winsA + c.winsB;
    const ci = wilson(c.winsA, decided);
    return {
      format,
      windowDays,
      source: group.key,
      archetypeA,
      archetypeB,
      matches: c.winsA + c.winsB + c.draws,
      winsA: c.winsA,
      winsB: c.winsB,
      draws: c.draws,
      winRateA: decided ? c.winsA / decided : 0,
      ciLow: ci.low,
      ciHigh: ci.high,
    };
  });

  await prisma.$transaction([
    prisma.archetypeStat.deleteMany({ where: { format, windowDays, source: group.key } }),
    prisma.archetypeStat.createMany({ data: archStats }),
    prisma.matchupStat.deleteMany({ where: { format, windowDays, source: group.key } }),
    prisma.matchupStat.createMany({ data: matchupStats }),
  ]);

  return { decks: totalDecks, archetypes: archStats.length, matchups: matchupStats.length };
}

export async function computeAllAggregates(log: (m: string) => void = () => {}) {
  for (const format of FORMATS) {
    const anchor = await anchorDateForFormat(format);
    if (!anchor) {
      log(`  ${format}: no data`);
      continue;
    }
    for (const windowDays of WINDOW_CHOICES) {
      const byGroup: Record<string, { decks: number }> = {};
      for (const group of SOURCE_GROUPS) {
        byGroup[group.key] = await computeForWindow(format, windowDays, anchor, group);
      }
      log(`  ${format} ${windowDays}d: all=${byGroup.all.decks} paper=${byGroup.paper.decks} mtgo=${byGroup.mtgo.decks} decks`);
    }
  }
}
