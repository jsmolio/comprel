import fs from "node:fs";
import { fillKeptBoards, type BoardFetch } from "./boards";
import { selectKeptDecks, buildSnapshotBody } from "./compute";
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
  /** One fetch per event that still needs at least one selected list. */
  fetchNormalized?: (sourcePath: string) => Promise<BoardFetch>;
  beforeRename?: () => void;
  log?: (message: string) => void;
  coverage?: SnapshotBody["coverage"];
  videosState?: SnapshotBody["videosState"];
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
  const extras = store.readExtras();
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const readBoards = (id: string) => memory.get(id) ?? store.readBoards(id);
  const filled = await fillKeptBoards({
    wanted: wanted.map((deck) => ({ event: deck.event, player: deck.player })),
    readBoards,
    fetchEvent: async (sourcePath) => {
      if (!opts.fetchNormalized) return { ok: false, reason: "network" };
      return opts.fetchNormalized(sourcePath);
    },
    emptyOn: extras.boardEmptyOn ?? {},
    today,
  });
  for (const [id, boards] of filled.writes) {
    if (Object.keys(boards).length) store.writeBoards(id, boards);
  }
  if (JSON.stringify(filled.emptyOn) !== JSON.stringify(extras.boardEmptyOn ?? {})) {
    store.writeExtras({ ...extras, boardEmptyOn: filled.emptyOn });
  }
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const update of filled.archetypeUpdates) {
    const event = byId.get(update.eventId);
    const deck = event?.decks.find((row) => row.player === update.player);
    if (!event || !deck || deck.archetype === update.archetype) continue;
    deck.archetype = update.archetype;
    deck.colorName = update.colorName;
    store.putEvent(event);
  }
  store.pruneBoards(new Set(filled.boards.keys()));
  const stats = filled.stats;
  log(
    `  lists: recovered ${stats.recovered}, already stored ${stats.alreadyStored}, source empty ${stats.sourceEmpty}, network failed ${stats.networkFailed}, negative-cache skips ${stats.negativeSkipped}`,
  );

  const extrasAfter = store.readExtras();
  const snapshotExists = fs.existsSync(store.snapshotFile);
  const previous = store.readSnapshot();
  if (snapshotExists && !previous) {
    log("  ! previous snapshot.json is not valid JSON; replacing it. Event facts are left in place.");
  }
  let cards = opts.cards ?? previous?.cards ?? {};
  if (opts.prepareCards) cards = await opts.prepareCards(filled.boards, cards);
  const body: SnapshotBody = buildSnapshotBody(
    events,
    filled.boards,
    { videos: extrasAfter.videos, banEvents: extrasAfter.banEvents, cards },
    opts.classifierVersion,
  );
  if (opts.videosState) body.videosState = opts.videosState;
  if (opts.coverage) body.coverage = opts.coverage;
  const publishedAt = (opts.now ?? new Date()).toISOString();
  const written = store.writeSnapshot(body, publishedAt, { beforeRename: opts.beforeRename });
  return { changed: written.changed, keptLists: wanted.length };
}
