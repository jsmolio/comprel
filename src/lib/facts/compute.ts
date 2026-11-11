import { wilson } from "./wilson";
import {
  ANCHOR_DECK_INDEX,
  CHART_DAYS,
  DAY_MS,
  LISTS_PER_ARCHETYPE,
  MIN_DECKS_FOR_MATRIX,
} from "./horizon";
import type {
  FactEvent,
  FormatSnap,
  PlayerBoard,
  PublishedDeck,
  SnapMatchup,
  SnapRow,
  SnapSlice,
  SnapWeek,
  SnapshotBody,
} from "./types";
import {
  FORMATS,
  SOURCE_FILTERS,
  SOURCE_GROUP_MEMBERS,
  WINDOW_CHOICES,
  type SourceFilter,
} from "../types";

export { wilson } from "./wilson";

const SEP = String.fromCharCode(31);

export function eventTime(event: Pick<FactEvent, "date">): number {
  return new Date(event.date).getTime();
}

export function inSource(source: string, filter: SourceFilter): boolean {
  if (filter === "all") return true;
  return (SOURCE_GROUP_MEMBERS[filter] as readonly string[]).includes(source);
}

export function sliceKey(windowDays: number, source: SourceFilter): string {
  return `${windowDays}:${source}`;
}

/** 25th-newest deck instant for a format, or the oldest deck when fewer than 25 exist. */
export function anchorMs(events: readonly { date: string; decks: readonly unknown[] }[]): number | null {
  const times: number[] = [];
  for (const event of events) {
    if (event.decks.length === 0) continue;
    const t = eventTime(event);
    for (let i = 0; i < event.decks.length; i++) times.push(t);
  }
  if (times.length === 0) return null;
  times.sort((a, b) => b - a);
  return times[Math.min(ANCHOR_DECK_INDEX, times.length - 1)];
}

function modeColor(names: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const name of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
    const n = counts.get(name)!;
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  }
  return best;
}

function weekStart(ms: number): string {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
  return new Date(monday).toISOString().slice(0, 10);
}

interface DeckRef {
  event: FactEvent;
  player: string;
  archetype: string;
  colorName: string | null;
  rank: number | null;
  time: number;
}

function deckRefs(events: FactEvent[], filter: SourceFilter): DeckRef[] {
  const out: DeckRef[] = [];
  for (const event of events) {
    if (!inSource(event.source, filter)) continue;
    const time = eventTime(event);
    for (const deck of event.decks) {
      out.push({
        event,
        player: deck.player,
        archetype: deck.archetype || "Unknown",
        colorName: deck.colorName,
        rank: deck.rank,
        time,
      });
    }
  }
  return out;
}

/** Fields the share / win-rate math reads. Magic facts satisfy this, and so do other games. */
export interface SliceEvent {
  id: string;
  source: string;
  date: string;
  deckCount: number;
  decks: { player: string; archetype: string; colorName: string | null; rank: number | null }[];
  matches: { player1: string; player2: string; winner: 0 | 1 | 2 }[];
}

/**
 * Optional predicates so a second game can reuse the same window, share, and
 * Wilson math. Omitted predicates keep the Magic source-filter behavior.
 */
export interface SliceScope {
  includeDeck?: (event: SliceEvent) => boolean;
  includeMatch?: (event: SliceEvent) => boolean;
}

function archetypeByPlayer(event: SliceEvent): Map<string, string> {
  const map = new Map<string, string>();
  for (const deck of event.decks) {
    if (!map.has(deck.player) && deck.archetype) map.set(deck.player, deck.archetype);
  }
  return map;
}

function sliceDecks(events: readonly SliceEvent[], allow: (event: SliceEvent) => boolean) {
  const out: { player: string; archetype: string; colorName: string | null; rank: number | null; time: number; deckCount: number }[] = [];
  for (const event of events) {
    if (!allow(event)) continue;
    const time = eventTime(event);
    for (const deck of event.decks) {
      out.push({
        player: deck.player,
        archetype: deck.archetype || "Unknown",
        colorName: deck.colorName,
        rank: deck.rank,
        time,
        deckCount: event.deckCount,
      });
    }
  }
  return out;
}

export function computeSlice(
  events: readonly SliceEvent[],
  anchor: number,
  windowDays: number,
  filter: SourceFilter,
  scope?: SliceScope,
): SnapSlice {
  const cutoff = anchor - windowDays * DAY_MS;
  const prevCutoff = cutoff - windowDays * DAY_MS;
  const allowDeck = scope?.includeDeck ?? ((event: SliceEvent) => inSource(event.source, filter));
  const allowMatch = scope?.includeMatch ?? ((event: SliceEvent) => inSource(event.source, filter));
  const decks = sliceDecks(events, allowDeck);

  const current = decks.filter((d) => d.time >= cutoff);
  const previous = decks.filter((d) => d.time >= prevCutoff && d.time < cutoff);

  const colors = new Map<string, (string | null)[]>();
  const curCount = new Map<string, number>();
  for (const deck of current) {
    curCount.set(deck.archetype, (curCount.get(deck.archetype) ?? 0) + 1);
    const list = colors.get(deck.archetype);
    if (list) list.push(deck.colorName);
    else colors.set(deck.archetype, [deck.colorName]);
  }
  const totalDecks = current.length;
  const prevCount = new Map<string, number>();
  for (const deck of previous) prevCount.set(deck.archetype, (prevCount.get(deck.archetype) ?? 0) + 1);
  const prevTotal = previous.length;

  const relevant = new Set([...curCount.entries()].filter(([, n]) => n >= MIN_DECKS_FOR_MATRIX).map(([name]) => name));

  type Rec = { w: number; l: number; d: number };
  const recs = new Map<string, Rec>();
  const rec = (name: string) => {
    let row = recs.get(name);
    if (!row) recs.set(name, (row = { w: 0, l: 0, d: 0 }));
    return row;
  };
  type Cell = { winsA: number; winsB: number; draws: number };
  const grid = new Map<string, Cell>();
  const cell = (a: string, b: string) => {
    const key = `${a}${SEP}${b}`;
    let row = grid.get(key);
    if (!row) grid.set(key, (row = { winsA: 0, winsB: 0, draws: 0 }));
    return row;
  };

  const conv = new Map<string, { top8: number; elig8: number; top32: number; elig32: number }>();
  const bumpConv = (name: string) => {
    let row = conv.get(name);
    if (!row) conv.set(name, (row = { top8: 0, elig8: 0, top32: 0, elig32: 0 }));
    return row;
  };
  for (const deck of current) {
    const row = bumpConv(deck.archetype);
    if (deck.rank != null && deck.deckCount >= 16) {
      row.elig8++;
      if (deck.rank <= 8) row.top8++;
    }
    if (deck.rank != null && deck.deckCount >= 64) {
      row.elig32++;
      if (deck.rank <= 32) row.top32++;
    }
  }

  for (const event of events) {
    if (!allowMatch(event) || eventTime(event) < cutoff) continue;
    const byPlayer = archetypeByPlayer(event);
    for (const match of event.matches) {
      const a = byPlayer.get(match.player1);
      const b = byPlayer.get(match.player2);
      if (!a || !b || a === b) continue;
      const ra = rec(a);
      const rb = rec(b);
      if (match.winner === 1) {
        ra.w++;
        rb.l++;
      } else if (match.winner === 2) {
        ra.l++;
        rb.w++;
      } else {
        ra.d++;
        rb.d++;
      }
      if (relevant.has(a) && relevant.has(b)) {
        const ab = cell(a, b);
        const ba = cell(b, a);
        if (match.winner === 1) {
          ab.winsA++;
          ba.winsB++;
        } else if (match.winner === 2) {
          ab.winsB++;
          ba.winsA++;
        } else {
          ab.draws++;
          ba.draws++;
        }
      }
    }
  }

  const rows: SnapRow[] = [...curCount.entries()]
    .map(([archetype, deckCount]) => {
      const record = recs.get(archetype) ?? { w: 0, l: 0, d: 0 };
      const decided = record.w + record.l;
      const prevN = prevCount.get(archetype);
      const row: SnapRow = {
        archetype,
        colorName: modeColor(colors.get(archetype) ?? []),
        deckCount,
        metaShare: totalDecks ? deckCount / totalDecks : 0,
        matchWins: record.w,
        matchLosses: record.l,
        matchDraws: record.d,
        winRate: decided > 0 ? record.w / decided : 0,
        conversion: conv.get(archetype) ?? { top8: 0, elig8: 0, top32: 0, elig32: 0 },
      };
      if (prevTotal > 0 && prevN !== undefined && prevN > 0) row.prevShare = prevN / prevTotal;
      return row;
    })
    .sort((a, b) => b.deckCount - a.deckCount || a.archetype.localeCompare(b.archetype));

  const matchups: SnapMatchup[] = [...grid.entries()].map(([key, value]) => {
    const [archetypeA, archetypeB] = key.split(SEP);
    const decided = value.winsA + value.winsB;
    const ci = wilson(value.winsA, decided);
    return {
      archetypeA,
      archetypeB,
      matches: value.winsA + value.winsB + value.draws,
      winsA: value.winsA,
      winsB: value.winsB,
      draws: value.draws,
      winRateA: decided ? value.winsA / decided : 0,
      ciLow: ci.low,
      ciHigh: ci.high,
    };
  });

  return { totalDecks, rows, matchups };
}

export function computeWeekly(
  events: readonly SliceEvent[],
  anchor: number,
  filter: SourceFilter,
  scope?: Pick<SliceScope, "includeDeck">,
): SnapWeek[] {
  const start = anchor - CHART_DAYS * DAY_MS;
  const allowDeck = scope?.includeDeck ?? ((event: SliceEvent) => inSource(event.source, filter));
  const byWeek = new Map<string, SnapWeek>();
  for (const deck of sliceDecks(events, allowDeck)) {
    if (deck.time < start) continue;
    const week = weekStart(deck.time);
    let row = byWeek.get(week);
    if (!row) byWeek.set(week, (row = { week, total: 0, counts: {} }));
    row.total++;
    row.counts[deck.archetype] = (row.counts[deck.archetype] ?? 0) + 1;
  }
  return [...byWeek.values()].filter((w) => w.total > 0).sort((a, b) => a.week.localeCompare(b.week));
}

function listSort(a: DeckRef, b: DeckRef): number {
  if (a.time !== b.time) return b.time - a.time;
  const aNull = a.rank == null ? 1 : 0;
  const bNull = b.rank == null ? 1 : 0;
  if (aNull !== bNull) return aNull - bNull;
  if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
  return a.player.localeCompare(b.player) || a.event.id.localeCompare(b.event.id);
}

export interface KeptDeck {
  event: FactEvent;
  player: string;
  archetype: string;
}

/** Up to 5 lists per format, source, and archetype. Same ordering as the deck-page SQL. */
export function selectKeptDecks(events: FactEvent[]): KeptDeck[] {
  const kept: KeptDeck[] = [];
  for (const format of FORMATS) {
    const inFormat = events.filter((e) => e.format === format);
    for (const filter of SOURCE_FILTERS) {
      const grouped = new Map<string, DeckRef[]>();
      for (const deck of deckRefs(inFormat, filter)) {
        const list = grouped.get(deck.archetype);
        if (list) list.push(deck);
        else grouped.set(deck.archetype, [deck]);
      }
      for (const [archetype, refs] of grouped) {
        refs.sort(listSort);
        // Keep a few extras so an event with no published list does not blank the column.
        for (const ref of refs.slice(0, LISTS_PER_ARCHETYPE + 3)) {
          kept.push({ event: ref.event, player: ref.player, archetype });
        }
      }
    }
  }
  return kept;
}

function publishedDeck(event: FactEvent, player: string, board: PlayerBoard): PublishedDeck {
  return {
    player,
    result: board.result,
    rank: event.decks.find((d) => d.player === player)?.rank ?? null,
    anchorUri: board.anchorUri,
    mainboard: board.mainboard,
    sideboard: board.sideboard,
    tournamentName: event.name,
    tournamentDate: event.date,
    tournamentUri: event.uri,
    source: event.source,
  };
}

export function buildSnapshotBody(
  events: FactEvent[],
  boards: Map<string, Record<string, PlayerBoard>>,
  extras: { videos: SnapshotBody["videos"]; banEvents: SnapshotBody["banEvents"]; cards: SnapshotBody["cards"] },
  classifierVersion: string,
): SnapshotBody {
  const formats: FormatSnap[] = FORMATS.map((format) => {
    const mine = events.filter((e) => e.format === format);
    const anchor = anchorMs(mine);
    const latestOf = (filter: SourceFilter) => {
      let max = -Infinity;
      let iso: string | null = null;
      for (const event of mine) {
        if (!inSource(event.source, filter) || event.decks.length === 0) continue;
        const t = eventTime(event);
        if (t > max) {
          max = t;
          iso = event.date;
        }
      }
      return iso;
    };
    const slices: FormatSnap["slices"] = {};
    const weekly: FormatSnap["weekly"] = { all: { top10: [], weeks: [] }, paper: { top10: [], weeks: [] }, mtgo: { top10: [], weeks: [] } };
    if (anchor != null) {
      for (const filter of SOURCE_FILTERS) {
        for (const windowDays of WINDOW_CHOICES) {
          slices[sliceKey(windowDays, filter)] = computeSlice(mine, anchor, windowDays, filter);
        }
        const year = slices[sliceKey(365, filter)];
        const top10 = (year?.rows ?? []).slice(0, 10).map((r) => r.archetype);
        weekly[filter] = { top10, weeks: computeWeekly(mine, anchor, filter) };
      }
    }
    const lists = { all: {}, paper: {}, mtgo: {} } as FormatSnap["lists"];
    for (const filter of SOURCE_FILTERS) {
      const grouped = new Map<string, DeckRef[]>();
      for (const deck of deckRefs(mine, filter)) {
        const list = grouped.get(deck.archetype);
        if (list) list.push(deck);
        else grouped.set(deck.archetype, [deck]);
      }
      for (const [archetype, refs] of grouped) {
        refs.sort(listSort);
        const decks: PublishedDeck[] = [];
        for (const ref of refs) {
          if (decks.length >= LISTS_PER_ARCHETYPE) break;
          const board = boards.get(ref.event.id)?.[ref.player];
          if (!board) continue;
          if (board.mainboard.length === 0 && board.sideboard.length === 0) continue;
          decks.push(publishedDeck(ref.event, ref.player, board));
        }
        if (decks.length) lists[filter][archetype] = decks;
      }
    }
    return {
      format,
      anchor: anchor == null ? null : new Date(anchor).toISOString(),
      latest: latestOf("all"),
      latestBySource: { all: latestOf("all"), paper: latestOf("paper"), mtgo: latestOf("mtgo") },
      slices,
      weekly,
      lists,
    };
  });

  return {
    schemaVersion: 1,
    status: "ok",
    classifierVersion,
    eventCount: events.length,
    formats,
    cards: extras.cards,
    videos: extras.videos,
    banEvents: extras.banEvents,
  };
}
