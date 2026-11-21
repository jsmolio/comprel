import { mergeBoard } from "../board";
import { boardUseful } from "../facts/boards";
import type { KeptDeck } from "../facts/compute";
import { inSource } from "../facts/compute";
import type { FactEvent, PlayerBoard } from "../facts/types";
import { publishedPart, publishedSegment, type PublishedPart } from "../published/doc";
import { FORMATS, type Format, type SourceFilter } from "../types";
import { assignSlugs, filterTournamentEvents, recordFromResult, selectPerSource, topFinishes, type FinishInput } from "./select";
import type { MagicFinish, TournamentEvent, TournamentFinish } from "./types";

const SOURCE_GROUPS = [
  { match: (source: string) => inSource(source, "paper") },
  { match: (source: string) => inSource(source, "mtgo") },
];

interface BuiltFinish extends TournamentFinish {
  anchorUri: string | null;
  mainboard: PlayerBoard["mainboard"];
  sideboard: PlayerBoard["sideboard"];
}

function finishesFor(event: FactEvent, boards: Record<string, PlayerBoard> | null): BuiltFinish[] {
  const inputs: FinishInput[] = event.decks.map((deck) => {
    const board = boards?.[deck.player];
    return {
      player: deck.player,
      archetype: deck.archetype || "Unknown",
      rank: deck.rank,
      result: board?.result ?? null,
      hasList: boardUseful(board),
    };
  });
  return topFinishes(inputs).map((row) => {
    const board = boards?.[row.player];
    const hasList = boardUseful(board);
    return {
      player: row.player,
      archetype: row.archetype,
      rank: row.rank,
      record: recordFromResult(row.result),
      hasList,
      anchorUri: hasList ? (board?.anchorUri ?? null) : null,
      mainboard: hasList ? mergeBoard(board?.mainboard ?? []) : [],
      sideboard: hasList ? mergeBoard(board?.sideboard ?? []) : [],
    };
  });
}

export function selectMagicEvents(events: readonly FactEvent[]): FactEvent[] {
  return selectPerSource(
    events.filter((event) => event.decks.length > 0),
    SOURCE_GROUPS,
  );
}

/** Players whose lists must survive board pruning so the tournament pages can render them. */
export function magicTournamentKeeps(
  events: readonly FactEvent[],
  readBoards: (id: string) => Record<string, PlayerBoard> | null,
): KeptDeck[] {
  const keeps: KeptDeck[] = [];
  for (const format of FORMATS) {
    const selected = selectMagicEvents(events.filter((event) => event.format === format));
    for (const event of selected) {
      for (const finish of finishesFor(event, readBoards(event.id))) {
        keeps.push({ event, player: finish.player, archetype: finish.archetype });
      }
    }
  }
  return keeps;
}

function indexFinish(finish: BuiltFinish): TournamentFinish {
  return {
    player: finish.player,
    archetype: finish.archetype,
    rank: finish.rank,
    record: finish.record,
    hasList: finish.hasList,
  };
}

function eventFinish(finish: BuiltFinish): MagicFinish {
  const base = indexFinish(finish);
  if (!finish.hasList) return base;
  return {
    ...base,
    anchorUri: finish.anchorUri,
    mainboard: finish.mainboard,
    sideboard: finish.sideboard,
  };
}

export function magicTournamentParts(
  events: readonly FactEvent[],
  readBoards: (id: string) => Record<string, PlayerBoard> | null,
): PublishedPart[] {
  const parts: PublishedPart[] = [];
  for (const format of FORMATS) {
    parts.push(...magicFormatParts(format, events.filter((event) => event.format === format), readBoards));
  }
  return parts;
}

function magicFormatParts(
  format: Format,
  events: readonly FactEvent[],
  readBoards: (id: string) => Record<string, PlayerBoard> | null,
): PublishedPart[] {
  const selected = assignSlugs(selectMagicEvents(events));
  const slug = publishedSegment(format.toLowerCase());
  const summaries: TournamentEvent[] = [];
  const parts: PublishedPart[] = [];
  for (const event of selected) {
    const finishes = finishesFor(event, readBoards(event.id));
    const summary: TournamentEvent = {
      id: event.id,
      slug: event.slug,
      name: event.name,
      date: event.date,
      source: event.listSource ?? event.source,
      uri: event.uri,
      deckCount: event.decks.length,
      finishes: finishes.map(indexFinish),
    };
    summaries.push(summary);
    parts.push(
      publishedPart(`${slug}/tournaments/${publishedSegment(event.slug)}.json`, {
        schemaVersion: 1 as const,
        status: "ok" as const,
        format,
        ...summary,
        finishes: finishes.map(eventFinish),
      }),
    );
  }
  parts.unshift(
    publishedPart(`${slug}/tournaments/index.json`, {
      schemaVersion: 1 as const,
      status: "ok" as const,
      format,
      events: summaries,
    }),
  );
  return parts;
}

export function filterMagicTournaments<T extends { date: string; source: string }>(
  events: readonly T[],
  source: SourceFilter,
  anchor: string | null,
  windowDays: number,
): T[] {
  return filterTournamentEvents(events, {
    sourceMatch: (value) => inSource(value, source),
    anchor,
    windowDays,
  });
}
