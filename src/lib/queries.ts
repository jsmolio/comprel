import { prisma } from "./db";
import { slugify } from "./slug";
import { anchorDateForFormat } from "./analytics/aggregate";
import { BANS } from "./banlist";
import {
  DEFAULT_SOURCE,
  DEFAULT_WINDOW_DAYS,
  FORMATS,
  SOURCE_FILTERS,
  SOURCE_GROUP_MEMBERS,
  WINDOW_CHOICES,
  type BoardCard,
  type Format,
  type SourceFilter,
} from "./types";

export function normalizeWindow(value: string | undefined): number {
  const n = Number(value);
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_WINDOW_DAYS;
}

export function normalizeSource(value: string | undefined): SourceFilter {
  return (SOURCE_FILTERS as readonly string[]).includes(value ?? "") ? (value as SourceFilter) : DEFAULT_SOURCE;
}

// Prisma relation filter scoping decks/tournaments to a source group.
function sourceFilter(source: SourceFilter) {
  return source === "all" ? {} : { tournament: { source: { in: SOURCE_GROUP_MEMBERS[source] } } };
}

export interface Conversion {
  top8: number;
  elig8: number;
  top32: number;
  elig32: number;
}

export interface ArchetypeRow {
  archetype: string;
  slug: string;
  colorName: string | null;
  deckCount: number;
  metaShare: number;
  winRate: number;
  sampleMatches: number;
  // On-demand enrichments (computed live from Deck rows, not precomputed).
  prevShare?: number; // metaShare in the immediately-preceding equal window (trend)
  conversion?: Conversion;
}

// SQL-safe `IN (...)` clause from the fixed source-group constants (not user input).
function sourceSql(source: SourceFilter): string {
  if (source === "all") return "";
  return `AND t.source IN (${SOURCE_GROUP_MEMBERS[source].map((s) => `'${s}'`).join(",")})`;
}

/**
 * Top-8 / Top-32 conversion per archetype, computed live. Only entries from events
 * that published standings (rank not null) and were large enough that the cut is
 * selective count toward the denominator — 5-0 league dumps and tiny events do not.
 * Top-8 over events >= 16 players; Top-32 over events >= 64.
 */
export async function getConversionMap(
  format: Format,
  windowDays: number,
  source: SourceFilter,
): Promise<Map<string, Conversion>> {
  const anchor = await anchorDateForFormat(format);
  if (!anchor) return new Map();
  const cutoff = new Date(anchor.getTime() - windowDays * 86_400_000);
  const rows = await prisma.$queryRawUnsafe<
    { archetype: string | null; top8: number; elig8: number; top32: number; elig32: number }[]
  >(
    `SELECT d.archetype,
        count(*) FILTER (WHERE d.rank IS NOT NULL AND t."deckCount" >= 16)::int AS elig8,
        count(*) FILTER (WHERE d.rank <= 8 AND t."deckCount" >= 16)::int AS top8,
        count(*) FILTER (WHERE d.rank IS NOT NULL AND t."deckCount" >= 64)::int AS elig32,
        count(*) FILTER (WHERE d.rank <= 32 AND t."deckCount" >= 64)::int AS top32
     FROM "Deck" d JOIN "Tournament" t ON t.id = d."tournamentId"
     WHERE d.format = $1 AND d.date >= $2 ${sourceSql(source)}
     GROUP BY d.archetype`,
    format,
    cutoff,
  );
  const m = new Map<string, Conversion>();
  for (const r of rows) {
    if (r.archetype) m.set(r.archetype, { top8: r.top8, elig8: r.elig8, top32: r.top32, elig32: r.elig32 });
  }
  return m;
}

/** Per-archetype meta share in the window immediately before the current one (for the trend). */
export async function getPrevShareMap(
  format: Format,
  windowDays: number,
  source: SourceFilter,
): Promise<Map<string, number>> {
  const anchor = await anchorDateForFormat(format);
  if (!anchor) return new Map();
  const cutoff = new Date(anchor.getTime() - windowDays * 86_400_000);
  const prevCutoff = new Date(cutoff.getTime() - windowDays * 86_400_000);
  const rows = await prisma.$queryRawUnsafe<{ archetype: string | null; n: number }[]>(
    `SELECT d.archetype, count(*)::int AS n
     FROM "Deck" d JOIN "Tournament" t ON t.id = d."tournamentId"
     WHERE d.format = $1 AND d.date >= $2 AND d.date < $3 ${sourceSql(source)}
     GROUP BY d.archetype`,
    format,
    prevCutoff,
    cutoff,
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  const m = new Map<string, number>();
  if (total > 0) for (const r of rows) if (r.archetype) m.set(r.archetype, r.n / total);
  return m;
}

export interface TimelinePoint {
  week: string; // ISO date of the week start
  n: number; // archetype decks that week
  total: number; // all format decks that week
  top10: number; // decks from the format's top-10 archetypes that week
}

/**
 * Weekly deck counts for one archetype over the last ~52 weeks, plus two
 * denominators: the whole field (`total`) and just the top-10 archetypes
 * (`top10`). The chart toggles which denominator it divides by.
 */
export async function getArchetypeTimeline(
  format: Format,
  archetype: string,
  source: SourceFilter,
): Promise<TimelinePoint[]> {
  const anchor = await anchorDateForFormat(format);
  if (!anchor) return [];
  const start = new Date(anchor.getTime() - 364 * 86_400_000);

  // Top-10 archetypes over the chart range (from the precomputed 365-day stats).
  const top = await prisma.archetypeStat.findMany({
    where: { format, windowDays: 365, source },
    orderBy: { deckCount: "desc" },
    take: 10,
    select: { archetype: true },
  });
  // Names come from our own DB; single quotes are doubled so apostrophe'd names are safe.
  const inList = top.length ? top.map((t) => `'${t.archetype.replace(/'/g, "''")}'`).join(",") : "''";

  const rows = await prisma.$queryRawUnsafe<{ week: Date; n: number; total: number; top10: number }[]>(
    `SELECT date_trunc('week', d.date) AS week,
        count(*) FILTER (WHERE d.archetype = $3)::int AS n,
        count(*)::int AS total,
        count(*) FILTER (WHERE d.archetype IN (${inList}))::int AS top10
     FROM "Deck" d JOIN "Tournament" t ON t.id = d."tournamentId"
     WHERE d.format = $1 AND d.date >= $2 ${sourceSql(source)}
     GROUP BY week ORDER BY week`,
    format,
    start,
    archetype,
  );
  return rows
    .filter((r) => r.total > 0)
    .map((r) => ({
      week: new Date(r.week).toISOString().slice(0, 10),
      n: r.n,
      total: r.total,
      top10: r.top10,
    }));
}

export interface BanMarker {
  date: string; // YYYY-MM-DD
  label: string;
}

/**
 * B&R markers for a format's timeline: the curated historical list merged with
 * changes auto-detected from Scryfall (the BanEvent table). Same-day auto changes
 * collapse into one marker; a curated entry wins for a given date. Falls back to
 * curated-only if the BanEvent table hasn't been migrated yet.
 */
export async function getBanMarkers(format: Format): Promise<BanMarker[]> {
  const curated: BanMarker[] = BANS[format].map((b) => ({ date: b.date, label: b.label }));
  let auto: BanMarker[] = [];
  try {
    const rows = await prisma.banEvent.findMany({ where: { format }, orderBy: { date: "asc" } });
    const byDate = new Map<string, string[]>();
    for (const r of rows) {
      const d = r.date.toISOString().slice(0, 10);
      byDate.set(d, [...(byDate.get(d) ?? []), `${r.card} ${r.action}`]);
    }
    auto = [...byDate.entries()].map(([date, parts]) => ({ date, label: parts.join(", ") }));
  } catch {
    // BanEvent table not present yet — show curated history only.
  }
  const seen = new Set(curated.map((c) => c.date));
  return [...curated, ...auto.filter((a) => !seen.has(a.date))].sort((x, y) => x.date.localeCompare(y.date));
}

function toRow(s: {
  archetype: string;
  colorName: string | null;
  deckCount: number;
  metaShare: number;
  winRate: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
}): ArchetypeRow {
  return {
    archetype: s.archetype,
    slug: slugify(s.archetype),
    colorName: s.colorName,
    deckCount: s.deckCount,
    metaShare: s.metaShare,
    winRate: s.winRate,
    sampleMatches: s.matchWins + s.matchLosses + s.matchDraws,
  };
}

export interface FormatSummary {
  format: Format;
  decks: number;
  archetypes: number;
  latest: Date | null;
  top: ArchetypeRow[];
}

/** Home-page snapshot for every tracked format (using the default window). */
export async function getFormatSummaries(): Promise<FormatSummary[]> {
  return Promise.all(
    FORMATS.map(async (format) => {
      const [stats, latest, prevMap] = await Promise.all([
        prisma.archetypeStat.findMany({
          where: { format, windowDays: DEFAULT_WINDOW_DAYS, source: DEFAULT_SOURCE },
          orderBy: { deckCount: "desc" },
        }),
        prisma.deck.findFirst({ where: { format }, orderBy: { date: "desc" }, select: { date: true } }),
        getPrevShareMap(format, DEFAULT_WINDOW_DAYS, DEFAULT_SOURCE),
      ]);
      return {
        format,
        decks: stats.reduce((n, s) => n + s.deckCount, 0),
        archetypes: stats.length,
        latest: latest?.date ?? null,
        top: stats.slice(0, 4).map((s) => ({ ...toRow(s), prevShare: prevMap.get(s.archetype) })),
      };
    }),
  );
}

export interface MetaBreakdown {
  rows: ArchetypeRow[];
  totalDecks: number;
  latest: Date | null;
}

export async function getMetaBreakdown(format: Format, windowDays: number, source: SourceFilter): Promise<MetaBreakdown> {
  const [stats, latest, convMap, prevMap] = await Promise.all([
    prisma.archetypeStat.findMany({ where: { format, windowDays, source }, orderBy: { deckCount: "desc" } }),
    prisma.deck.findFirst({ where: { format, ...sourceFilter(source) }, orderBy: { date: "desc" }, select: { date: true } }),
    getConversionMap(format, windowDays, source),
    getPrevShareMap(format, windowDays, source),
  ]);
  return {
    rows: stats.map((s) => ({ ...toRow(s), prevShare: prevMap.get(s.archetype), conversion: convMap.get(s.archetype) })),
    totalDecks: stats.reduce((n, s) => n + s.deckCount, 0),
    latest: latest?.date ?? null,
  };
}

export interface MatrixCell {
  winRateA: number;
  matches: number;
  winsA: number;
  winsB: number;
  draws: number;
  ciLow: number;
  ciHigh: number;
}

export interface MatchupMatrix {
  archetypes: { archetype: string; slug: string; colorName: string | null; deckCount: number }[];
  cell: (a: string, b: string) => MatrixCell | null;
}

/** Top-N head-to-head matrix for a format (only pairing-bearing data). */
export async function getMatchupMatrix(format: Format, windowDays: number, source: SourceFilter, topN = 12): Promise<MatchupMatrix> {
  const top = await prisma.archetypeStat.findMany({
    where: { format, windowDays, source },
    orderBy: { deckCount: "desc" },
    take: topN,
  });
  const names = new Set(top.map((t) => t.archetype));
  const cells = await prisma.matchupStat.findMany({
    where: { format, windowDays, source, archetypeA: { in: [...names] }, archetypeB: { in: [...names] } },
  });
  const lookup = new Map(cells.map((c) => [`${c.archetypeA}|${c.archetypeB}`, c]));
  return {
    archetypes: top.map((t) => ({ archetype: t.archetype, slug: slugify(t.archetype), colorName: t.colorName, deckCount: t.deckCount })),
    cell: (a, b) => {
      const c = lookup.get(`${a}|${b}`);
      return c ? { winRateA: c.winRateA, matches: c.matches, winsA: c.winsA, winsB: c.winsB, draws: c.draws, ciLow: c.ciLow, ciHigh: c.ciHigh } : null;
    },
  };
}

export interface DeckView {
  id: string;
  player: string;
  result: string | null;
  rank: number | null;
  anchorUri: string | null;
  wins: number;
  losses: number;
  draws: number;
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  tournamentName: string;
  tournamentDate: Date;
  tournamentUri: string | null;
  source: string;
}

export interface MatchupRow extends MatrixCell {
  opponent: string;
  slug: string;
}

export interface ArchetypeDetail {
  format: Format;
  archetype: string;
  colorName: string | null;
  stat: ArchetypeRow | null;
  matchups: MatchupRow[];
  decks: DeckView[];
  timeline: TimelinePoint[];
}

/** Resolve a format's archetype by slug across any window (names are stable). */
async function resolveArchetypeName(format: Format, slug: string): Promise<string | null> {
  const all = await prisma.archetypeStat.findMany({ where: { format }, select: { archetype: true }, distinct: ["archetype"] });
  return all.find((a) => slugify(a.archetype) === slug)?.archetype ?? null;
}

export async function getArchetypeDetail(
  format: Format,
  windowDays: number,
  source: SourceFilter,
  slug: string,
): Promise<ArchetypeDetail | null> {
  const archetype = await resolveArchetypeName(format, slug);
  if (!archetype) return null;

  const statRow = await prisma.archetypeStat.findUnique({
    where: { format_windowDays_source_archetype: { format, windowDays, source, archetype } },
  });

  const [matchupRows, deckRows, convMap, prevMap, timeline] = await Promise.all([
    prisma.matchupStat.findMany({
      where: { format, windowDays, source, archetypeA: archetype },
      orderBy: [{ winRateA: "desc" }, { matches: "desc" }],
    }),
    prisma.deck.findMany({
      where: { format, archetype, ...sourceFilter(source) },
      orderBy: { date: "desc" },
      take: 40,
      include: { tournament: true },
    }),
    getConversionMap(format, windowDays, source),
    getPrevShareMap(format, windowDays, source),
    getArchetypeTimeline(format, archetype, source),
  ]);

  // Best finishes first (rank asc, nulls last), then most recent.
  deckRows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.date.getTime() - a.date.getTime());

  return {
    format,
    archetype,
    colorName: statRow?.colorName ?? deckRows[0]?.colorName ?? null,
    stat: statRow ? { ...toRow(statRow), prevShare: prevMap.get(archetype), conversion: convMap.get(archetype) } : null,
    timeline,
    matchups: matchupRows.map((m) => ({
      opponent: m.archetypeB,
      slug: slugify(m.archetypeB),
      winRateA: m.winRateA,
      matches: m.matches,
      winsA: m.winsA,
      winsB: m.winsB,
      draws: m.draws,
      ciLow: m.ciLow,
      ciHigh: m.ciHigh,
    })),
    decks: deckRows.slice(0, 6).map((d) => ({
      id: d.id,
      player: d.player,
      result: d.result,
      rank: d.rank,
      anchorUri: d.anchorUri,
      wins: d.wins,
      losses: d.losses,
      draws: d.draws,
      mainboard: d.mainboard as unknown as BoardCard[],
      sideboard: d.sideboard as unknown as BoardCard[],
      tournamentName: d.tournament.name,
      tournamentDate: d.tournament.date,
      tournamentUri: d.tournament.uri,
      source: d.tournament.source,
    })),
  };
}

export async function getCardMap(names: string[]) {
  const cards = await prisma.card.findMany({ where: { name: { in: [...new Set(names)] } } });
  return new Map(cards.map((c) => [c.name, c]));
}

export interface VideoView {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  publishedAt: Date | null;
}

export async function getArchetypeVideos(format: Format, archetype: string): Promise<VideoView[]> {
  const vids = await prisma.video.findMany({
    where: { format, archetype },
    orderBy: { publishedAt: "desc" },
    take: 8,
  });
  return vids.map((v) => ({
    id: v.id,
    title: v.title,
    channelTitle: v.channelTitle,
    thumbnail: v.thumbnail,
    publishedAt: v.publishedAt,
  }));
}
