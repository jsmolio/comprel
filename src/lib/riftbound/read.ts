import type { ArchetypeRow, BanMarker, MatchupMatrix, MatrixCell, TimelinePoint } from "../queries";
import { slugify } from "../slug";
import { DEFAULT_WINDOW_DAYS, WINDOW_CHOICES } from "../types";
import { sliceKey, weeklyKey, listKey } from "./aggregate";
import { ALL_ERA } from "./eras";
import { DEFAULT_RIFTBOUND_SOURCE, RIFTBOUND_SOURCES, type RiftboundSource } from "./sources";
import type { RiftboundList, RiftboundSnapshot } from "./types";
import type { SnapMatchup, SnapRow } from "../facts/types";

export function normalizeRiftboundWindow(value: string | undefined): number {
  const n = Number(value);
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_WINDOW_DAYS;
}

export function normalizeRiftboundSource(value: string | undefined): RiftboundSource {
  return (RIFTBOUND_SOURCES as readonly string[]).includes(value ?? "") ? (value as RiftboundSource) : DEFAULT_RIFTBOUND_SOURCE;
}

export function normalizeEra(value: string | undefined, eras: { id: string }[]): string {
  if (!value || value === ALL_ERA) return ALL_ERA;
  return eras.some((era) => era.id === value) ? value : ALL_ERA;
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

export function riftboundRows(snapshot: RiftboundSnapshot, windowDays: number, source: string, era: string): ArchetypeRow[] {
  return (snapshot.slices[sliceKey(windowDays, source, era)]?.rows ?? []).map(toRow);
}

export function riftboundTotal(snapshot: RiftboundSnapshot, windowDays: number, source: string, era: string): number {
  return snapshot.slices[sliceKey(windowDays, source, era)]?.totalDecks ?? 0;
}

export function cellOf(matchup: SnapMatchup): MatrixCell {
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

export function riftboundMatrix(snapshot: RiftboundSnapshot, windowDays: number, source: string, era: string, topN = 12): MatchupMatrix {
  const slice = snapshot.slices[sliceKey(windowDays, source, era)];
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

export function legendNames(snapshot: RiftboundSnapshot): string[] {
  const names = new Set<string>();
  for (const slice of Object.values(snapshot.slices)) for (const row of slice.rows) names.add(row.archetype);
  for (const lists of Object.values(snapshot.lists)) for (const name of Object.keys(lists)) names.add(name);
  return [...names];
}

export function findLegend(snapshot: RiftboundSnapshot, slug: string): string | null {
  return legendNames(snapshot).find((name) => slugify(name) === slug) ?? null;
}

export function legendTimeline(snapshot: RiftboundSnapshot, legend: string, source: string, era: string): TimelinePoint[] {
  const weekly = snapshot.weekly[weeklyKey(source, era)];
  const top10 = new Set(weekly?.top10 ?? []);
  return (weekly?.weeks ?? []).map((week) => ({
    week: week.week,
    n: week.counts[legend] ?? 0,
    total: week.total,
    top10: [...top10].reduce((sum, name) => sum + (week.counts[name] ?? 0), 0),
  }));
}

export function legendLists(snapshot: RiftboundSnapshot, legend: string, source: string, era: string): RiftboundList[] {
  return snapshot.lists[listKey(source, era)]?.[legend] ?? snapshot.lists[listKey("all", era)]?.[legend] ?? [];
}

export function riftboundBanMarkers(snapshot: RiftboundSnapshot): BanMarker[] {
  const byDate = new Map<string, string[]>();
  for (const ban of snapshot.banEvents) {
    const list = byDate.get(ban.date) ?? [];
    list.push(ban.card);
    byDate.set(ban.date, list);
  }
  return [...byDate.entries()]
    .map(([date, cards]) => ({ date, label: cards.join(", "), affectsFormat: true }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
