import { prisma } from "./db";
import { slugify } from "./slug";
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

export interface ArchetypeRow {
  archetype: string;
  slug: string;
  colorName: string | null;
  deckCount: number;
  metaShare: number;
  winRate: number;
  sampleMatches: number;
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
      const stats = await prisma.archetypeStat.findMany({
        where: { format, windowDays: DEFAULT_WINDOW_DAYS, source: DEFAULT_SOURCE },
        orderBy: { deckCount: "desc" },
      });
      const latest = await prisma.deck.findFirst({
        where: { format },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        format,
        decks: stats.reduce((n, s) => n + s.deckCount, 0),
        archetypes: stats.length,
        latest: latest?.date ?? null,
        top: stats.slice(0, 4).map(toRow),
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
  const stats = await prisma.archetypeStat.findMany({
    where: { format, windowDays, source },
    orderBy: { deckCount: "desc" },
  });
  const latest = await prisma.deck.findFirst({
    where: { format, ...sourceFilter(source) },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return {
    rows: stats.map(toRow),
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

  const matchupRows = await prisma.matchupStat.findMany({
    where: { format, windowDays, source, archetypeA: archetype },
    orderBy: { matches: "desc" },
  });

  const deckRows = await prisma.deck.findMany({
    where: { format, archetype, ...sourceFilter(source) },
    orderBy: { date: "desc" },
    take: 40,
    include: { tournament: true },
  });

  // Best finishes first (rank asc, nulls last), then most recent.
  deckRows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.date.getTime() - a.date.getTime());

  return {
    format,
    archetype,
    colorName: statRow?.colorName ?? deckRows[0]?.colorName ?? null,
    stat: statRow ? toRow(statRow) : null,
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
