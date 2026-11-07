import { BANS } from "./banlist";
import { sliceKey } from "./facts/compute";
import type { FormatSnap, SnapMatchup, SnapRow, Snapshot } from "./facts/types";
import { loadPublished } from "./published/load";
import { slugify } from "./slug";
import {
  DEFAULT_SOURCE,
  DEFAULT_WINDOW_DAYS,
  FORMATS,
  SOURCE_FILTERS,
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
  prevShare?: number;
  conversion?: Conversion;
}

export interface FormatSummary {
  format: Format;
  decks: number;
  archetypes: number;
  latest: Date | null;
  top: ArchetypeRow[];
}

export interface MetaBreakdown {
  rows: ArchetypeRow[];
  totalDecks: number;
  latest: Date | null;
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

export interface TimelinePoint {
  week: string;
  n: number;
  total: number;
  top10: number;
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

export interface BanMarker {
  date: string;
  label: string;
  affectsFormat: boolean;
}

export interface VideoView {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  publishedAt: Date | null;
}

function requireSnapshot(): Snapshot {
  const loaded = loadPublished();
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.snapshot;
}

function formatSnap(snapshot: Snapshot, format: Format): FormatSnap | undefined {
  return snapshot.formats.find((f) => f.format === format);
}

function toRow(row: SnapRow): ArchetypeRow {
  return {
    archetype: row.archetype,
    slug: slugify(row.archetype),
    colorName: row.colorName,
    deckCount: row.deckCount,
    metaShare: row.metaShare,
    winRate: row.winRate,
    sampleMatches: row.matchWins + row.matchLosses + row.matchDraws,
    prevShare: row.prevShare,
    conversion: row.conversion,
  };
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSummaries(snapshot: Snapshot): FormatSummary[] {
  return FORMATS.map((format) => {
    const snap = formatSnap(snapshot, format);
    const slice = snap?.slices[sliceKey(DEFAULT_WINDOW_DAYS, DEFAULT_SOURCE)];
    const rows = slice?.rows ?? [];
    return {
      format,
      decks: slice?.totalDecks ?? 0,
      archetypes: rows.length,
      latest: asDate(snap?.latest),
      top: rows.slice(0, 4).map(toRow),
    };
  });
}

export async function getFormatSummaries(): Promise<FormatSummary[]> {
  return formatSummaries(requireSnapshot());
}

export function lastRefresh(snapshot: Snapshot): Date | null {
  return asDate(snapshot.publishedAt);
}

export async function getLastRefresh(): Promise<Date | null> {
  return lastRefresh(requireSnapshot());
}

export function metaBreakdown(snapshot: Snapshot, format: Format, windowDays: number, source: SourceFilter): MetaBreakdown {
  const snap = formatSnap(snapshot, format);
  const slice = snap?.slices[sliceKey(windowDays, source)];
  return {
    rows: (slice?.rows ?? []).map(toRow),
    totalDecks: slice?.totalDecks ?? 0,
    latest: asDate(snap?.latestBySource[source]),
  };
}

export async function getMetaBreakdown(format: Format, windowDays: number, source: SourceFilter): Promise<MetaBreakdown> {
  return metaBreakdown(requireSnapshot(), format, windowDays, source);
}

function cellOf(matchup: SnapMatchup): MatrixCell {
  return {
    winRateA: matchup.winRateA,
    matches: matchup.matches,
    winsA: matchup.winsA,
    winsB: matchup.winsB,
    draws: matchup.draws,
    ciLow: matchup.ciLow,
    ciHigh: matchup.ciHigh,
  };
}

export function matchupMatrix(snapshot: Snapshot, format: Format, windowDays: number, source: SourceFilter, topN = 12): MatchupMatrix {
  const slice = formatSnap(snapshot, format)?.slices[sliceKey(windowDays, source)];
  const top = (slice?.rows ?? []).slice(0, topN);
  const names = new Set(top.map((row) => row.archetype));
  const lookup = new Map<string, SnapMatchup>();
  for (const matchup of slice?.matchups ?? []) {
    if (names.has(matchup.archetypeA) && names.has(matchup.archetypeB)) {
      lookup.set(`${matchup.archetypeA}|${matchup.archetypeB}`, matchup);
    }
  }
  return {
    archetypes: top.map((row) => ({
      archetype: row.archetype,
      slug: slugify(row.archetype),
      colorName: row.colorName,
      deckCount: row.deckCount,
    })),
    cell: (a, b) => {
      const found = lookup.get(`${a}|${b}`);
      return found ? cellOf(found) : null;
    },
  };
}

export async function getMatchupMatrix(format: Format, windowDays: number, source: SourceFilter, topN = 12): Promise<MatchupMatrix> {
  return matchupMatrix(requireSnapshot(), format, windowDays, source, topN);
}

function archetypeNames(snap: FormatSnap | undefined): string[] {
  const names = new Set<string>();
  if (!snap) return [];
  for (const slice of Object.values(snap.slices)) for (const row of slice.rows) names.add(row.archetype);
  for (const lists of Object.values(snap.lists)) for (const name of Object.keys(lists)) names.add(name);
  return [...names];
}

export function archetypeDetail(
  snapshot: Snapshot,
  format: Format,
  windowDays: number,
  source: SourceFilter,
  slug: string,
): ArchetypeDetail | null {
  const snap = formatSnap(snapshot, format);
  const archetype = archetypeNames(snap).find((name) => slugify(name) === slug);
  if (!archetype || !snap) return null;
  const slice = snap.slices[sliceKey(windowDays, source)];
  const row = slice?.rows.find((r) => r.archetype === archetype) ?? null;
  const weekly = snap.weekly[source];
  const top10 = new Set(weekly?.top10 ?? []);
  const timeline: TimelinePoint[] = (weekly?.weeks ?? []).map((week) => ({
    week: week.week,
    n: week.counts[archetype] ?? 0,
    total: week.total,
    top10: [...top10].reduce((sum, name) => sum + (week.counts[name] ?? 0), 0),
  }));
  const decks = (snap.lists[source]?.[archetype] ?? []).map((deck, index) => ({
    id: `${format}:${source}:${archetype}:${index}`,
    player: deck.player,
    result: deck.result,
    rank: deck.rank,
    anchorUri: deck.anchorUri,
    wins: 0,
    losses: 0,
    draws: 0,
    mainboard: deck.mainboard,
    sideboard: deck.sideboard,
    tournamentName: deck.tournamentName,
    tournamentDate: new Date(deck.tournamentDate),
    tournamentUri: deck.tournamentUri,
    source: deck.source,
  }));
  const matchups = (slice?.matchups ?? [])
    .filter((matchup) => matchup.archetypeA === archetype)
    .map((matchup) => ({
      opponent: matchup.archetypeB,
      slug: slugify(matchup.archetypeB),
      ...cellOf(matchup),
    }))
    .sort((a, b) => b.matches - a.matches || a.opponent.localeCompare(b.opponent));
  return {
    format,
    archetype,
    colorName: row?.colorName ?? null,
    stat: row ? toRow(row) : null,
    matchups,
    decks,
    timeline,
  };
}

export async function getArchetypeDetail(
  format: Format,
  windowDays: number,
  source: SourceFilter,
  slug: string,
): Promise<ArchetypeDetail | null> {
  return archetypeDetail(requireSnapshot(), format, windowDays, source, slug);
}

export function cardMap(snapshot: Snapshot, names: string[]) {
  const map = new Map<string, { imageUrl: string | null; typeLine: string | null; manaCost: string | null; priceUsd: string | null }>();
  for (const name of names) {
    const card = snapshot.cards[name];
    if (!card) continue;
    map.set(name, { imageUrl: card.imageUrl, typeLine: card.typeLine, manaCost: null, priceUsd: card.priceUsd });
  }
  return map;
}

export async function getCardMap(names: string[]) {
  return cardMap(requireSnapshot(), names);
}

export function archetypeVideos(snapshot: Snapshot, format: Format, archetype: string): VideoView[] {
  return snapshot.videos
    .filter((video) => video.format === format && video.archetype === archetype)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 8)
    .map((video) => ({
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      thumbnail: video.thumbnail,
      publishedAt: asDate(video.publishedAt),
    }));
}

export async function getArchetypeVideos(format: Format, archetype: string): Promise<VideoView[]> {
  return archetypeVideos(requireSnapshot(), format, archetype);
}

export function banMarkers(snapshot: Snapshot, format: Format): BanMarker[] {
  const byDate = new Map<string, Map<Format, string[]>>();
  const add = (date: string, f: Format, label: string) => {
    if (!byDate.has(date)) byDate.set(date, new Map());
    const perFmt = byDate.get(date)!;
    perFmt.set(f, [...(perFmt.get(f) ?? []), label]);
  };
  for (const f of FORMATS) for (const ban of BANS[f]) add(ban.date, f, ban.label);
  for (const event of snapshot.banEvents) {
    if (!(FORMATS as readonly string[]).includes(event.format)) continue;
    add(event.date.slice(0, 10), event.format as Format, `${event.card} ${event.action}`);
  }
  return [...byDate.entries()]
    .map(([date, perFmt]) => {
      const here = perFmt.get(format) ?? [];
      const others = [...perFmt.keys()].filter((f) => f !== format);
      const label = here.length > 0 ? here.join(", ") : `No ${format} changes — ${others.join(", ")} updated`;
      return { date, label, affectsFormat: here.length > 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getBanMarkers(format: Format): Promise<BanMarker[]> {
  return banMarkers(requireSnapshot(), format);
}

export function snapshotHasArchetype(snapshot: Snapshot, format: Format, archetype: string): boolean {
  const snap = formatSnap(snapshot, format);
  return archetypeNames(snap).includes(archetype);
}
