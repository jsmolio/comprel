import { anchorMs, computeSlice, computeWeekly, type SliceEvent } from "../facts/compute";
import { LISTS_PER_ARCHETYPE } from "../facts/horizon";
import { WINDOW_CHOICES } from "../types";
import { ALL_ERA, eraContains, type EraDef } from "./eras";
import { RIFTBOUND_SOURCES, sourceMatches } from "./sources";
import type { RiftboundBoard, RiftboundFactEvent, RiftboundList, RiftboundSnapshotBody } from "./types";

export function sliceKey(windowDays: number, source: string, era: string): string {
  return `${windowDays}:${source}:${era}`;
}

export function weeklyKey(source: string, era: string): string {
  return `${source}:${era}`;
}

export function listKey(source: string, era: string): string {
  return `${source}:${era}`;
}

function asSlice(event: RiftboundFactEvent): SliceEvent {
  return event;
}

function scopeFor(source: string, era: EraDef | null) {
  const includeDeck = (event: SliceEvent) =>
    sourceMatches(event.source, source) && (era == null || eraContains(era, event.date));
  const includeMatch = (event: SliceEvent) => includeDeck(event) && event.source !== "loltcg";
  return { includeDeck, includeMatch };
}

function boardUseful(board: RiftboundBoard | undefined): board is RiftboundBoard {
  if (!board) return false;
  return (
    board.main.length + board.runePool.length + board.sideboard.length + board.legend.length + board.champion.length + board.battlefield.length >
    0
  );
}

interface DeckRef {
  event: RiftboundFactEvent;
  player: string;
  name: string;
  archetype: string;
  rank: number | null;
  time: number;
}

function refsFor(events: RiftboundFactEvent[], source: string, era: EraDef | null): DeckRef[] {
  const out: DeckRef[] = [];
  for (const event of events) {
    if (!sourceMatches(event.source, source)) continue;
    if (era && !eraContains(era, event.date)) continue;
    const time = Date.parse(event.date);
    for (const deck of event.decks) {
      out.push({
        event,
        player: deck.player,
        name: deck.name,
        archetype: deck.archetype || "Unknown",
        rank: deck.rank,
        time,
      });
    }
  }
  return out;
}

function byRecency(a: DeckRef, b: DeckRef): number {
  if (a.time !== b.time) return b.time - a.time;
  const aNull = a.rank == null ? 1 : 0;
  const bNull = b.rank == null ? 1 : 0;
  if (aNull !== bNull) return aNull - bNull;
  if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
  return a.player.localeCompare(b.player) || a.event.id.localeCompare(b.event.id);
}

function toList(ref: DeckRef, board: RiftboundBoard): RiftboundList {
  return {
    player: ref.name,
    playerId: ref.player,
    rank: ref.rank,
    anchorUri: board.anchorUri,
    legend: board.legend,
    champion: board.champion,
    battlefield: board.battlefield,
    main: board.main,
    runePool: board.runePool,
    sideboard: board.sideboard,
    tournamentName: ref.event.name,
    tournamentDate: ref.event.date,
    tournamentUri: ref.event.uri,
    source: ref.event.source,
  };
}

export function buildRiftboundSnapshot(
  events: RiftboundFactEvent[],
  boards: Map<string, Record<string, RiftboundBoard>>,
  extras: {
    videos: RiftboundSnapshotBody["videos"];
    banEvents: RiftboundSnapshotBody["banEvents"];
    cards: RiftboundSnapshotBody["cards"];
    eras: EraDef[];
  },
): RiftboundSnapshotBody {
  const sliceEvents = events.map(asSlice);
  const anchor = anchorMs(sliceEvents);
  const slices: RiftboundSnapshotBody["slices"] = {};
  const weekly: RiftboundSnapshotBody["weekly"] = {};
  const eraChoices: (EraDef | null)[] = [null, ...extras.eras];
  if (anchor != null) {
    for (const source of RIFTBOUND_SOURCES) {
      for (const era of eraChoices) {
        const eraId = era?.id ?? ALL_ERA;
        const scope = scopeFor(source, era);
        for (const windowDays of WINDOW_CHOICES) {
          slices[sliceKey(windowDays, source, eraId)] = computeSlice(sliceEvents, anchor, windowDays, "all", scope);
        }
        const year = slices[sliceKey(365, source, eraId)];
        weekly[weeklyKey(source, eraId)] = {
          top10: (year?.rows ?? []).slice(0, 10).map((row) => row.archetype),
          weeks: computeWeekly(sliceEvents, anchor, "all", scope),
        };
      }
    }
  }

  const lists: RiftboundSnapshotBody["lists"] = {};
  const sources = new Set<string>(["all", ...events.map((event) => event.source)]);
  for (const source of sources) {
    for (const era of eraChoices) {
      const grouped = new Map<string, DeckRef[]>();
      for (const ref of refsFor(events, source, era)) {
        const list = grouped.get(ref.archetype);
        if (list) list.push(ref);
        else grouped.set(ref.archetype, [ref]);
      }
      const key = listKey(source, era?.id ?? ALL_ERA);
      for (const [archetype, group] of grouped) {
        group.sort(byRecency);
        const decks: RiftboundList[] = [];
        const seen = new Set<string>();
        for (const ref of group) {
          if (decks.length >= LISTS_PER_ARCHETYPE) break;
          const id = `${ref.event.id}:${ref.player}`;
          if (seen.has(id)) continue;
          const board = boards.get(ref.event.id)?.[ref.player];
          if (!boardUseful(board)) continue;
          seen.add(id);
          decks.push(toList(ref, board));
        }
        if (!decks.length) continue;
        if (!lists[key]) lists[key] = {};
        lists[key][archetype] = decks;
      }
    }
  }

  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const event of events) {
    if (event.decks.length === 0) continue;
    const time = Date.parse(event.date);
    if (time > latestMs) {
      latestMs = time;
      latest = event.date;
    }
  }

  return {
    schemaVersion: 1,
    status: "ok",
    game: "riftbound",
    eventCount: events.length,
    anchor: anchor == null ? null : new Date(anchor).toISOString(),
    latest,
    slices,
    weekly,
    lists,
    cards: extras.cards,
    videos: extras.videos,
    banEvents: extras.banEvents,
    eras: extras.eras,
  };
}

export function namesInLists(lists: RiftboundSnapshotBody["lists"]): string[] {
  const names = new Set<string>();
  for (const group of Object.values(lists)) {
    for (const decks of Object.values(group)) {
      for (const deck of decks) {
        for (const zone of [deck.legend, deck.champion, deck.battlefield, deck.main, deck.runePool, deck.sideboard]) {
          for (const card of zone) names.add(card.name);
        }
      }
    }
  }
  return [...names];
}
