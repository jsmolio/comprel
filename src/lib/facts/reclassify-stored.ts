import { classify } from "../archetype/classify";
import { hasFormatData } from "../formatdata";
import { boardUseful } from "./boards";
import { classifierVersion } from "./classifier-version";
import { FactStore } from "./store";
import type { FactDeck, FactEvent } from "./types";

export interface ArchetypeDelta {
  archetype: string;
  before: number;
  after: number;
}

export interface ReclassifyStoredResult {
  /** Decks whose stored list was classified again. */
  decksReclassified: number;
  /** Decks whose archetype or color name changed. */
  decksChanged: number;
  /** Decks left alone because no list is stored. */
  decksSkipped: number;
  eventsUpdated: number;
  deltas: ArchetypeDelta[];
}

/**
 * Reclassify decks that still have a stored list. Decks without a list keep
 * their archetype so an empty board cannot become Unknown. An event is stamped
 * with the current classifier version only when every deck had a list; a
 * partial update stays stale so `pnpm reclassify-facts` will still refetch it.
 * Does not fetch and does not open a database.
 */
export function reclassifyStoredDecks(store: FactStore, version = classifierVersion(store.root)): ReclassifyStoredResult {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  let decksReclassified = 0;
  let decksChanged = 0;
  let decksSkipped = 0;
  let eventsUpdated = 0;

  for (const event of store.allEvents()) {
    if (event.classifierVersion === version) continue;
    if (!hasFormatData(event.format, store.root)) {
      decksSkipped += event.decks.length;
      continue;
    }
    const boards = store.readBoards(event.id);
    let covered = 0;
    let changed = false;
    const decks: FactDeck[] = event.decks.map((deck) => {
      const board = boards?.[deck.player];
      if (!board || !boardUseful(board)) {
        decksSkipped++;
        return deck;
      }
      covered++;
      const cls = classify(event.format, board.mainboard, board.sideboard, store.root);
      decksReclassified++;
      before.set(deck.archetype, (before.get(deck.archetype) ?? 0) + 1);
      after.set(cls.archetype, (after.get(cls.archetype) ?? 0) + 1);
      if (cls.archetype !== deck.archetype || cls.colorName !== deck.colorName) {
        decksChanged++;
        changed = true;
        return { ...deck, archetype: cls.archetype, colorName: cls.colorName };
      }
      return deck;
    });
    const complete = event.decks.length > 0 && covered === event.decks.length;
    if (!changed && !complete) continue;
    const next: FactEvent = {
      ...event,
      decks,
      classifierVersion: complete ? version : event.classifierVersion,
    };
    store.putEvent(next);
    if (changed) eventsUpdated++;
  }

  const names = new Set([...before.keys(), ...after.keys()]);
  const deltas = [...names]
    .map((archetype) => ({
      archetype,
      before: before.get(archetype) ?? 0,
      after: after.get(archetype) ?? 0,
    }))
    .filter((row) => row.before !== row.after)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.archetype.localeCompare(b.archetype));

  return { decksReclassified, decksChanged, decksSkipped, eventsUpdated, deltas };
}
