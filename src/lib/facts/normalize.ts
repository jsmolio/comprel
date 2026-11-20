import { detectFormat } from "../format";
import { isByePlayer, parseDeckResult, parseMatchResult } from "../result";
import { selectConstructedCache } from "../sources/premier-parse";
import type { BoardCard, Format, RawCacheItem, RawDeck, RawStanding } from "../types";
import { classifyFetched } from "./classify-guard";
import type { FactEvent, FactMatch, PlayerBoard } from "./types";

export interface NormalizedEvent {
  event: FactEvent;
  boards: Record<string, PlayerBoard>;
  /**
   * Constructed lists dropped because the main deck had fewer than 60 cards.
   * `normalizeCacheItem` always sets this. Hand-built events can omit it.
   */
  droppedLists?: number;
}

function toBoard(items: { Count: number; CardName: string }[] | null | undefined): BoardCard[] {
  return (items ?? []).map((i) => ({ name: i.CardName, count: i.Count }));
}

function rankFor(deck: RawDeck, standings: Map<string, RawStanding>): number | null {
  const standing = standings.get(deck.Player);
  if (standing) return standing.Rank;
  return parseDeckResult(deck.Result).rank;
}

/**
 * Turn one fetched cache file into a compact event plus the boards we may
 * display. Classification runs only because `fetched` is the caller's proof
 * that these boards came from the source, not from a pruned store.
 */
export function normalizeCacheItem(
  source: string,
  stableId: string,
  item: RawCacheItem,
  allow: Set<Format>,
  classifierVersion: string,
  sourcePath: string | null,
  formatHint?: Format,
  draftNumbers?: ReadonlySet<number> | null,
): NormalizedEvent | null {
  const format = formatHint ?? detectFormat(item.Tournament?.Formats, item.Tournament?.Name, stableId);
  if (!format || !allow.has(format)) return null;
  const date = new Date(item.Tournament.Date);
  if (Number.isNaN(date.getTime())) return null;

  // Safety net for every constructed format: a main deck under 60 cards is not
  // a constructed list, and a numbered round is draft only when this event's
  // schedule (or a format label) says so. Pass null when there is no schedule.
  const selected = selectConstructedCache(item, draftNumbers);
  const standings = new Map((item.Standings ?? []).map((s) => [s.Player, s]));
  const boards: Record<string, PlayerBoard> = {};
  const decks = selected.decks.map((deck) => {
    const mainboard = toBoard(deck.Mainboard);
    const sideboard = toBoard(deck.Sideboard);
    const cls = classifyFetched(format, mainboard, sideboard, true);
    if (!cls) throw new Error("classifyFetched refused a fetched payload");
    boards[deck.Player] = {
      result: deck.Result ?? null,
      anchorUri: deck.AnchorUri ?? null,
      mainboard,
      sideboard,
    };
    return {
      player: deck.Player,
      archetype: deck.Archetype?.trim() || cls.archetype,
      colorName: cls.colorName,
      rank: rankFor(deck, standings),
    };
  });

  const matches: FactMatch[] = [];
  for (const round of selected.rounds) {
    for (const match of round.Matches ?? []) {
      if (isByePlayer(match.Player1) || isByePlayer(match.Player2)) continue;
      const outcome = parseMatchResult(match.Result);
      if (!outcome) continue;
      matches.push({ player1: match.Player1, player2: match.Player2, winner: outcome.winner });
    }
  }

  return {
    event: {
      schemaVersion: 1,
      classifierVersion,
      id: `${source}:${stableId}`,
      source,
      name: item.Tournament.Name,
      date: date.toISOString(),
      format,
      uri: item.Tournament.Uri ?? null,
      sourcePath,
      deckCount: decks.length,
      decks,
      matches,
    },
    boards,
    droppedLists: selected.droppedLists,
  };
}
