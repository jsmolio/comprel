import { selectKeptDecks } from "./compute";
import { buildSnapshotBody } from "./compute";
import type { NormalizedEvent } from "./normalize";
import { FactStore } from "./store";
import type { CardSnap, PlayerBoard, SnapshotBody } from "./types";

export interface PublishOptions {
  classifierVersion: string;
  now?: Date;
  memoryBoards?: Map<string, Record<string, PlayerBoard>>;
  cards?: Record<string, CardSnap>;
  /** Called with the kept boards. Return the card map to embed. Failure should return the previous map. */
  prepareCards?: (
    boards: Map<string, Record<string, PlayerBoard>>,
    previous: Record<string, CardSnap>,
  ) => Promise<Record<string, CardSnap>>;
  /** Refetch used only when a kept list's boards are not already on disk or in memory. */
  fetchNormalized?: (sourcePath: string) => Promise<NormalizedEvent | null>;
  beforeRename?: () => void;
  log?: (message: string) => void;
  coverage?: SnapshotBody["coverage"];
}

/**
 * Build the display snapshot from the fact log and rename it into place.
 * Throws before the rename leave the previous snapshot untouched.
 * Extras (videos, detected bans) are read, never deleted, when this runs.
 */
export async function publishSnapshot(store: FactStore, opts: PublishOptions): Promise<{ changed: boolean; keptLists: number }> {
  const log = opts.log ?? (() => {});
  const events = store.allEvents();
  const memory = opts.memoryBoards ?? new Map<string, Record<string, PlayerBoard>>();
  const wanted = selectKeptDecks(events);
  const byEvent = new Map<string, Set<string>>();
  for (const deck of wanted) {
    const set = byEvent.get(deck.event.id);
    if (set) set.add(deck.player);
    else byEvent.set(deck.event.id, new Set([deck.player]));
  }

  const boards = new Map<string, Record<string, PlayerBoard>>();
  let missing = 0;
  for (const [id, players] of byEvent) {
    const have = memory.get(id) ?? store.readBoards(id);
    let source = have;
    if (!source && opts.fetchNormalized) {
      const event = events.find((e) => e.id === id);
      if (event?.sourcePath) {
        const fetched = await opts.fetchNormalized(event.sourcePath);
        if (fetched) source = fetched.boards;
      }
    }
    if (!source) {
      missing += players.size;
      continue;
    }
    const picked: Record<string, PlayerBoard> = {};
    for (const player of players) {
      const board = source[player];
      if (!board || (board.mainboard.length === 0 && board.sideboard.length === 0)) {
        missing++;
        continue;
      }
      picked[player] = board;
    }
    if (Object.keys(picked).length) {
      boards.set(id, picked);
      store.writeBoards(id, picked);
    }
  }
  store.pruneBoards(new Set(boards.keys()));
  if (missing) log(`  lists: ${missing} kept deck(s) had no stored or fetched board`);

  const extras = store.readExtras();
  const previous = store.readSnapshot();
  let cards = opts.cards ?? previous?.cards ?? {};
  if (opts.prepareCards) cards = await opts.prepareCards(boards, cards);
  const body: SnapshotBody = buildSnapshotBody(
    events,
    boards,
    { videos: extras.videos, banEvents: extras.banEvents, cards },
    opts.classifierVersion,
  );
  if (opts.coverage) body.coverage = opts.coverage;
  const publishedAt = (opts.now ?? new Date()).toISOString();
  const written = store.writeSnapshot(body, publishedAt, { beforeRename: opts.beforeRename });
  return { changed: written.changed, keptLists: wanted.length };
}
