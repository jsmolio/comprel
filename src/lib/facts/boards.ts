import { classifyFetched } from "./classify-guard";
import type { FactEvent, PlayerBoard } from "./types";
import type { NormalizedEvent } from "./normalize";

/** Do not ask upstream again for this many days after it confirmed a player has no list. */
export const BOARD_EMPTY_RETRY_DAYS = 7;

export interface BoardFillStats {
  recovered: number;
  alreadyStored: number;
  sourceEmpty: number;
  networkFailed: number;
  negativeSkipped: number;
}

/** Keep a previously classified deck when the new payload has no list to classify. */
export function preserveArchetypes(existing: FactEvent | null, incoming: NormalizedEvent): NormalizedEvent {
  if (!existing) return incoming;
  const decks = incoming.event.decks.map((deck) => {
    const prev = existing.decks.find((row) => row.player === deck.player);
    const board = incoming.boards[deck.player];
    if (prev?.archetype && !prev.archetype.endsWith("Unknown") && !boardUseful(board)) {
      return { ...deck, archetype: prev.archetype, colorName: prev.colorName };
    }
    return deck;
  });
  return { event: { ...incoming.event, decks }, boards: incoming.boards };
}

export function mergeStoredLists(
  stored: Record<string, PlayerBoard> | null,
  incoming: Record<string, PlayerBoard>,
): Record<string, PlayerBoard> {
  const merged: Record<string, PlayerBoard> = {};
  for (const [player, board] of Object.entries(stored ?? {})) if (boardUseful(board)) merged[player] = board;
  for (const [player, board] of Object.entries(incoming)) {
    if (boardUseful(board) && !boardUseful(merged[player])) merged[player] = board;
  }
  return merged;
}

export function boardUseful(board: PlayerBoard | undefined): boolean {
  return Boolean(board && (board.mainboard.length > 0 || board.sideboard.length > 0));
}

/** True when `emptyOn` is today or within the retry window, so this run should not fetch. */
export function negativeFresh(emptyOn: string | undefined, today: string, days = BOARD_EMPTY_RETRY_DAYS): boolean {
  if (!emptyOn) return false;
  const age = Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${emptyOn}T00:00:00.000Z`);
  return age >= 0 && age < days * 86_400_000;
}

export type BoardFetch =
  | { ok: true; normalized: NormalizedEvent }
  | { ok: false; reason: "empty" | "network" };

export interface ArchetypeUpdate {
  eventId: string;
  player: string;
  archetype: string;
  colorName: string;
  colorId: string;
}

/**
 * Fill selected players from one upstream fetch per event.
 * A stored non-empty list is kept. An empty upstream list is remembered so the
 * next runs skip it. A network failure is not remembered and does not erase lists.
 * Archetype labels change only from a non-empty recovered list.
 */
export async function fillKeptBoards(args: {
  wanted: { event: FactEvent; player: string }[];
  readBoards: (id: string) => Record<string, PlayerBoard> | null;
  fetchEvent: (sourcePath: string) => Promise<BoardFetch>;
  emptyOn: Record<string, Record<string, string>>;
  today: string;
}): Promise<{
  boards: Map<string, Record<string, PlayerBoard>>;
  emptyOn: Record<string, Record<string, string>>;
  stats: BoardFillStats;
  archetypeUpdates: ArchetypeUpdate[];
  writes: Map<string, Record<string, PlayerBoard>>;
  fetchedEventIds: Set<string>;
}> {
  const byEvent = new Map<string, { event: FactEvent; players: Set<string> }>();
  for (const row of args.wanted) {
    const cur = byEvent.get(row.event.id);
    if (cur) cur.players.add(row.player);
    else byEvent.set(row.event.id, { event: row.event, players: new Set([row.player]) });
  }

  const boards = new Map<string, Record<string, PlayerBoard>>();
  const writes = new Map<string, Record<string, PlayerBoard>>();
  const emptyOn: Record<string, Record<string, string>> = {};
  for (const [id, players] of Object.entries(args.emptyOn)) emptyOn[id] = { ...players };
  const stats: BoardFillStats = { recovered: 0, alreadyStored: 0, sourceEmpty: 0, networkFailed: 0, negativeSkipped: 0 };
  const archetypeUpdates: ArchetypeUpdate[] = [];
  const fetched = new Set<string>();

  for (const [id, group] of byEvent) {
    const stored = args.readBoards(id) ?? {};
    const needFetch: string[] = [];
    for (const player of group.players) {
      if (boardUseful(stored[player])) continue;
      if (negativeFresh(emptyOn[id]?.[player], args.today)) continue;
      needFetch.push(player);
    }

    let incoming: Record<string, PlayerBoard> | null = null;
    let failed = false;
    if (needFetch.length > 0) {
      if (!group.event.sourcePath) {
        failed = false;
        incoming = {};
      } else {
        fetched.add(id);
        const result = await args.fetchEvent(group.event.sourcePath);
        if (!result.ok) {
          failed = result.reason === "network";
          incoming = result.reason === "empty" ? {} : null;
        } else incoming = result.normalized.boards;
      }
    }

    const merged: Record<string, PlayerBoard> = {};
    for (const [player, board] of Object.entries(stored)) {
      if (boardUseful(board)) merged[player] = board;
    }
    if (!emptyOn[id]) emptyOn[id] = {};

    for (const player of group.players) {
      const kept = stored[player];
      if (boardUseful(kept)) {
        stats.alreadyStored++;
        continue;
      }
      if (!needFetch.includes(player)) {
        stats.negativeSkipped++;
        continue;
      }
      if (failed || incoming === null) {
        stats.networkFailed++;
        continue;
      }
      const got = incoming[player];
      if (boardUseful(got)) {
        merged[player] = got;
        stats.recovered++;
        const cls = classifyFetched(group.event.format, got.mainboard, got.sideboard, true);
        if (cls) {
          archetypeUpdates.push({
            eventId: id,
            player,
            archetype: cls.archetype,
            colorName: cls.colorName,
            colorId: cls.colorId,
          });
        }
        delete emptyOn[id][player];
        continue;
      }
      stats.sourceEmpty++;
      emptyOn[id][player] = args.today;
    }
    if (Object.keys(emptyOn[id]).length === 0) delete emptyOn[id];

    const storedUseful: Record<string, PlayerBoard> = {};
    for (const [player, board] of Object.entries(stored)) if (boardUseful(board)) storedUseful[player] = board;
    if (Object.keys(merged).length) boards.set(id, merged);
    if (JSON.stringify(merged) !== JSON.stringify(storedUseful)) writes.set(id, merged);
  }

  return { boards, emptyOn, stats, archetypeUpdates, writes, fetchedEventIds: fetched };
}

export type BoardFillResult = Awaited<ReturnType<typeof fillKeptBoards>>;
