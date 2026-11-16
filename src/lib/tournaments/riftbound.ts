import { publishedPart, publishedSegment, type PublishedPart } from "../published/doc";
import { RIFTBOUND_SOURCES, sourceMatches } from "../riftbound/sources";
import type { RiftboundBoard, RiftboundFactEvent } from "../riftbound/types";
import { assignSlugs, filterTournamentEvents, selectPerSource, topFinishes, type FinishInput } from "./select";
import type { RiftboundFinish, TournamentEvent, TournamentFinish } from "./types";

const SOURCE_GROUPS = RIFTBOUND_SOURCES.filter((source) => source !== "all").map((source) => ({
  match: (value: string) => value === source,
}));

function listUseful(board: RiftboundBoard | undefined): board is RiftboundBoard {
  if (!board) return false;
  return (
    board.legend.length +
      board.champion.length +
      board.battlefield.length +
      board.main.length +
      board.runePool.length +
      board.sideboard.length >
    0
  );
}

interface BuiltFinish extends TournamentFinish {
  anchorUri: string | null;
  legend: RiftboundBoard["legend"];
  champion: RiftboundBoard["champion"];
  battlefield: RiftboundBoard["battlefield"];
  main: RiftboundBoard["main"];
  runePool: RiftboundBoard["runePool"];
  sideboard: RiftboundBoard["sideboard"];
}

function finishesFor(event: RiftboundFactEvent, boards: Record<string, RiftboundBoard> | null): BuiltFinish[] {
  const inputs: FinishInput[] = event.decks.map((deck) => {
    const board = boards?.[deck.player];
    return {
      player: deck.player,
      archetype: deck.archetype || "Unknown",
      rank: deck.rank,
      result: null,
      hasList: listUseful(board),
    };
  });
  return topFinishes(inputs).map((row) => {
    const deck = event.decks.find((item) => item.player === row.player);
    const board = boards?.[row.player];
    const hasList = listUseful(board);
    return {
      player: deck?.name || row.player,
      archetype: row.archetype,
      rank: row.rank,
      record: null,
      hasList,
      anchorUri: hasList ? (board?.anchorUri ?? null) : null,
      legend: hasList ? board.legend : [],
      champion: hasList ? board.champion : [],
      battlefield: hasList ? board.battlefield : [],
      main: hasList ? board.main : [],
      runePool: hasList ? board.runePool : [],
      sideboard: hasList ? board.sideboard : [],
    };
  });
}

export function selectRiftboundEvents(events: readonly RiftboundFactEvent[]): RiftboundFactEvent[] {
  return selectPerSource(
    events.filter((event) => event.decks.length > 0),
    SOURCE_GROUPS,
  );
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

function eventFinish(finish: BuiltFinish): RiftboundFinish {
  const base = indexFinish(finish);
  if (!finish.hasList) return base;
  return {
    ...base,
    anchorUri: finish.anchorUri,
    legend: finish.legend,
    champion: finish.champion,
    battlefield: finish.battlefield,
    main: finish.main,
    runePool: finish.runePool,
    sideboard: finish.sideboard,
  };
}

export function riftboundTournamentParts(
  events: readonly RiftboundFactEvent[],
  readBoards: (id: string) => Record<string, RiftboundBoard> | null,
): PublishedPart[] {
  const selected = assignSlugs(selectRiftboundEvents(events));
  const summaries: TournamentEvent[] = [];
  const parts: PublishedPart[] = [];
  for (const event of selected) {
    const finishes = finishesFor(event, readBoards(event.id));
    const summary: TournamentEvent = {
      id: event.id,
      slug: event.slug,
      name: event.name,
      date: event.date,
      source: event.source,
      uri: event.uri,
      deckCount: event.decks.length,
      finishes: finishes.map(indexFinish),
    };
    if (event.playerCount > 0) summary.playerCount = event.playerCount;
    summaries.push(summary);
    parts.push(
      publishedPart(`tournaments/${publishedSegment(event.slug)}.json`, {
        schemaVersion: 1 as const,
        status: "ok" as const,
        game: "riftbound" as const,
        format: event.format,
        ...summary,
        finishes: finishes.map(eventFinish),
      }),
    );
  }
  parts.unshift(
    publishedPart("tournaments/index.json", {
      schemaVersion: 1 as const,
      status: "ok" as const,
      game: "riftbound" as const,
      events: summaries,
    }),
  );
  return parts;
}

export function filterRiftboundTournaments<T extends { date: string; source: string }>(
  events: readonly T[],
  source: string,
  anchor: string | null,
  windowDays: number,
  era: { start: string; end: string } | null,
): T[] {
  return filterTournamentEvents(events, {
    sourceMatch: (value) => sourceMatches(value, source),
    anchor,
    windowDays,
    era,
  });
}
