import { Prisma } from "@prisma/client";
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
export async function anchorDateForFormat(format: Format): Promise<Date | null> {
  const rows = await prisma.deck.findMany({
    where: { format },
    orderBy: { date: "desc" },
    take: 25,
    select: { date: true },
  });
  if (rows.length === 0) return null;
  return rows[rows.length - 1].date;
}

// Both aggregation queries group INSIDE Postgres and return one small row set
// covering every window at once (via `FILTER (WHERE date >= cutoff)` columns),
// instead of shipping every deck/match row to Node per window. This keeps
// egress to a few KB per format — critical on Supabase's metered free tier.

type DeckCountRow = { archetype: string; colorName: string | null } & Record<`c${number}`, number>;
type PairRow = { a1: string; a2: string } & Record<`wa${number}` | `wb${number}` | `dr${number}`, number>;

async function fetchGroupRows(format: Format, cutoffs: Date[], sources?: string[]) {
  const maxCutoff = cutoffs[cutoffs.length - 1];

  const deckCountCols = cutoffs.map(
    (c, i) => Prisma.sql`count(*) FILTER (WHERE d.date >= ${c})::int AS ${Prisma.raw(`c${i}`)}`,
  );
  const deckSourceJoin = sources
    ? Prisma.sql`JOIN "Tournament" t ON t.id = d."tournamentId" AND t.source IN (${Prisma.join(sources)})`
    : Prisma.empty;
  const deckRows = await prisma.$queryRaw<DeckCountRow[]>(Prisma.sql`
    SELECT COALESCE(d.archetype, 'Unknown') AS archetype,
           mode() WITHIN GROUP (ORDER BY d."colorName") AS "colorName",
           ${Prisma.join(deckCountCols)}
    FROM "Deck" d
    ${deckSourceJoin}
    WHERE d.format = ${format} AND d.date >= ${maxCutoff}
    GROUP BY 1`);

  const pairCols = cutoffs.flatMap((c, i) => [
    Prisma.sql`count(*) FILTER (WHERE m.winner = 1 AND m.date >= ${c})::int AS ${Prisma.raw(`wa${i}`)}`,
    Prisma.sql`count(*) FILTER (WHERE m.winner = 2 AND m.date >= ${c})::int AS ${Prisma.raw(`wb${i}`)}`,
    Prisma.sql`count(*) FILTER (WHERE m.winner <> 1 AND m.winner <> 2 AND m.date >= ${c})::int AS ${Prisma.raw(`dr${i}`)}`,
  ]);
  const matchSourceJoin = sources
    ? Prisma.sql`JOIN "Tournament" t ON t.id = m."tournamentId" AND t.source IN (${Prisma.join(sources)})`
    : Prisma.empty;
  // A player runs one deck per event, so archetype resolution is scoped to the
  // tournament (DISTINCT ON guards against duplicate deck rows).
  const pairRows = await prisma.$queryRaw<PairRow[]>(Prisma.sql`
    WITH dk AS (
      SELECT DISTINCT ON ("tournamentId", player) "tournamentId", player, archetype
      FROM "Deck"
      WHERE format = ${format} AND date >= ${maxCutoff} AND archetype IS NOT NULL
      ORDER BY "tournamentId", player, date DESC, id
    )
    SELECT d1.archetype AS a1, d2.archetype AS a2, ${Prisma.join(pairCols)}
    FROM "Match" m
    JOIN dk d1 ON d1."tournamentId" = m."tournamentId" AND d1.player = m.player1
    JOIN dk d2 ON d2."tournamentId" = m."tournamentId" AND d2.player = m.player2
    ${matchSourceJoin}
    WHERE m.format = ${format} AND m.date >= ${maxCutoff} AND d1.archetype <> d2.archetype
    GROUP BY 1, 2`);

  return { deckRows, pairRows };
}

function statsForWindow(
  format: Format,
  windowDays: number,
  windowIdx: number,
  group: { key: SourceFilter; sources?: string[] },
  deckRows: DeckCountRow[],
  pairRows: PairRow[],
) {
  const byArch = new Map<string, { count: number; colorName: string | null }>();
  for (const r of deckRows) {
    const count = r[`c${windowIdx}`];
    if (count > 0) byArch.set(r.archetype, { count, colorName: r.colorName });
  }
  const totalDecks = [...byArch.values()].reduce((n, e) => n + e.count, 0);

  const relevant = new Set([...byArch.entries()].filter(([, e]) => e.count >= MIN_DECKS_FOR_MATRIX).map(([a]) => a));

  // Aggregate win rate is derived from PAIRINGS (mirrors excluded), not stored
  // deck records, so MTGO 5-0 league selection bias does not inflate it.
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

  for (const p of pairRows) {
    const wa = p[`wa${windowIdx}`];
    const wb = p[`wb${windowIdx}`];
    const dr = p[`dr${windowIdx}`];
    if (wa + wb + dr === 0) continue;

    const r1 = rec(p.a1);
    const r2 = rec(p.a2);
    r1.w += wa;
    r1.l += wb;
    r1.d += dr;
    r2.w += wb;
    r2.l += wa;
    r2.d += dr;

    if (relevant.has(p.a1) && relevant.has(p.a2)) {
      const ab = cell(p.a1, p.a2);
      const ba = cell(p.a2, p.a1);
      ab.winsA += wa;
      ab.winsB += wb;
      ab.draws += dr;
      ba.winsA += wb;
      ba.winsB += wa;
      ba.draws += dr;
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

  return { totalDecks, archStats, matchupStats };
}

export async function computeAllAggregates(log: (m: string) => void = () => {}) {
  for (const format of FORMATS) {
    const anchor = await anchorDateForFormat(format);
    if (!anchor) {
      log(`  ${format}: no data`);
      continue;
    }
    const cutoffs = WINDOW_CHOICES.map((w) => new Date(anchor.getTime() - w * 86_400_000));

    const decksByWindow: Record<string, number[]> = {};
    for (const group of SOURCE_GROUPS) {
      const { deckRows, pairRows } = await fetchGroupRows(format, cutoffs, group.sources);
      decksByWindow[group.key] = [];
      for (let i = 0; i < WINDOW_CHOICES.length; i++) {
        const windowDays = WINDOW_CHOICES[i];
        const { totalDecks, archStats, matchupStats } = statsForWindow(format, windowDays, i, group, deckRows, pairRows);
        decksByWindow[group.key][i] = totalDecks;
        await prisma.$transaction([
          prisma.archetypeStat.deleteMany({ where: { format, windowDays, source: group.key } }),
          prisma.archetypeStat.createMany({ data: archStats }),
          prisma.matchupStat.deleteMany({ where: { format, windowDays, source: group.key } }),
          prisma.matchupStat.createMany({ data: matchupStats }),
        ]);
      }
    }
    WINDOW_CHOICES.forEach((windowDays, i) => {
      log(
        `  ${format} ${windowDays}d: all=${decksByWindow.all[i]} paper=${decksByWindow.paper[i]} mtgo=${decksByWindow.mtgo[i]} decks`,
      );
    });
  }
}
