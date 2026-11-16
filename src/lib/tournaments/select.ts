import { createHash } from "node:crypto";
import { DAY_MS } from "../facts/horizon";
import { parseDeckResult } from "../result";
import { slugify } from "../slug";

/** Events shown on a format page before the "see all" link. */
export const TOURNAMENT_PREVIEW = 10;
/** Newest events kept per source group so a paper or MTGO filter still has a list. */
export const TOURNAMENTS_PER_SOURCE = 24;
/** Top finishes rendered for each event. */
export const TOP_FINISHES = 8;

const RECORD = /^(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/;

/**
 * A win-loss record from a deck result string.
 * "5-0" and "5-2-1" count. "1st Place" and "Top 8" do not.
 */
export function recordFromResult(result: string | null | undefined): string | null {
  if (!result) return null;
  const text = result.trim();
  if (/^(?:\d+)(?:st|nd|rd|th)\b/i.test(text)) return null;
  if (/^top\s*\d+/i.test(text)) return null;
  const match = text.match(RECORD);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  const draws = match[3] ? Number(match[3]) : 0;
  if (wins + losses + draws === 0) return null;
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

export interface FinishInput {
  player: string;
  archetype: string;
  rank: number | null;
  result: string | null;
  hasList: boolean;
}

function compareFinish(a: FinishInput, b: FinishInput): number {
  const aRanked = a.rank == null ? 1 : 0;
  const bRanked = b.rank == null ? 1 : 0;
  if (aRanked !== bRanked) return aRanked - bRanked;
  if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
  const aRecord = recordFromResult(a.result);
  const bRecord = recordFromResult(b.result);
  if (Boolean(aRecord) !== Boolean(bRecord)) return aRecord ? -1 : 1;
  if (aRecord && bRecord) {
    const ar = parseDeckResult(a.result);
    const br = parseDeckResult(b.result);
    if (ar.wins !== br.wins) return br.wins - ar.wins;
    if (ar.losses !== br.losses) return ar.losses - br.losses;
    if (ar.draws !== br.draws) return ar.draws - br.draws;
  }
  if (a.hasList !== b.hasList) return a.hasList ? -1 : 1;
  return a.player.localeCompare(b.player);
}

/**
 * Top finishes for one event.
 * Ranked events use placement. Unranked events (leagues) use recorded win-loss
 * results, and fall back to listed decks when nothing has a record.
 */
export function topFinishes(decks: readonly FinishInput[], limit = TOP_FINISHES): FinishInput[] {
  const byPlayer = new Map<string, FinishInput>();
  for (const deck of decks) {
    const prev = byPlayer.get(deck.player);
    if (!prev || compareFinish(deck, prev) < 0) byPlayer.set(deck.player, deck);
  }
  const unique = [...byPlayer.values()];
  const ranked = unique.some((deck) => deck.rank != null);
  let pool = unique;
  if (!ranked) {
    const withRecord = unique.filter((deck) => recordFromResult(deck.result));
    if (withRecord.length) pool = withRecord;
  }
  return [...pool].sort(compareFinish).slice(0, Math.max(0, limit));
}

export function byNewest<T extends { date: string; id: string }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Newest `perSource` events from each source group, then newest overall.
 * A source that matches no group is its own group, so it is not dropped.
 */
export function selectPerSource<T extends { date: string; id: string; source: string }>(
  events: readonly T[],
  groups: readonly { match: (source: string) => boolean }[],
  perSource = TOURNAMENTS_PER_SOURCE,
): T[] {
  const chosen = new Map<string, T>();
  const take = (rows: readonly T[]) => {
    const sorted = [...rows].sort(byNewest);
    for (const row of sorted.slice(0, perSource)) chosen.set(row.id, row);
  };
  for (const group of groups) take(events.filter((event) => group.match(event.source)));
  take(events.filter((event) => !groups.some((group) => group.match(event.source))));
  return [...chosen.values()].sort(byNewest);
}

export function assignSlugs<T extends { id: string }>(events: readonly T[]): (T & { slug: string })[] {
  const used = new Set<string>();
  return events.map((event) => {
    let base = slugify(event.id).slice(0, 80);
    if (!/^[a-z0-9]/.test(base)) base = "event";
    let slug = base;
    if (used.has(slug)) {
      const hash = createHash("sha256").update(event.id).digest("hex").slice(0, 6);
      slug = `${base.slice(0, 72)}-${hash}`;
    }
    while (used.has(slug)) slug = `${slug}-2`;
    used.add(slug);
    return { ...event, slug };
  });
}

/** True when the event falls in the same window the metagame table uses. */
export function eventInWindow(date: string, anchor: string | null, windowDays: number): boolean {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return false;
  if (!anchor) return true;
  const anchorTime = Date.parse(anchor);
  if (!Number.isFinite(anchorTime)) return true;
  return time >= anchorTime - windowDays * DAY_MS;
}

export function filterTournamentEvents<T extends { date: string; source: string }>(
  events: readonly T[],
  opts: {
    sourceMatch: (source: string) => boolean;
    anchor: string | null;
    windowDays: number;
    /** Inclusive start, exclusive end, YYYY-MM-DD. */
    era?: { start: string; end: string } | null;
  },
): T[] {
  return events.filter((event) => {
    if (!opts.sourceMatch(event.source)) return false;
    if (opts.era) {
      const day = event.date.slice(0, 10);
      if (day < opts.era.start || day >= opts.era.end) return false;
    }
    return eventInWindow(event.date, opts.anchor, opts.windowDays);
  });
}

export function tournamentSizeLabel(event: { playerCount?: number | null; deckCount?: number | null }): string | null {
  if (typeof event.playerCount === "number" && event.playerCount > 0) {
    return `${event.playerCount} player${event.playerCount === 1 ? "" : "s"}`;
  }
  if (typeof event.deckCount === "number" && event.deckCount > 0) {
    return `${event.deckCount} deck${event.deckCount === 1 ? "" : "s"}`;
  }
  return null;
}
