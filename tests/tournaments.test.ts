import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore } from "../src/lib/facts/store";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import { partitionMetaRows } from "../src/lib/meta-rows";
import { magicTournamentParts } from "../src/lib/tournaments/magic";
import { presentTournaments } from "../src/lib/tournaments/present";
import {
  eventInWindow,
  recordFromResult,
  selectPerSource,
  topFinishes,
  tournamentSizeLabel,
  TOURNAMENT_PREVIEW,
  type FinishInput,
} from "../src/lib/tournaments/select";
import type { BoardCard } from "../src/lib/types";

const DAY = 86_400_000;

function finish(partial: Partial<FinishInput> & Pick<FinishInput, "player">): FinishInput {
  return { archetype: "Domain", rank: null, result: null, hasList: false, ...partial };
}

function event(partial: Partial<FactEvent> & Pick<FactEvent, "id" | "date">): FactEvent {
  const decks = partial.decks ?? [{ player: "Ada", archetype: "Domain", colorName: null, rank: 1 }];
  return {
    schemaVersion: 1,
    classifierVersion: "v",
    source: "melee.gg",
    name: partial.id,
    format: "Modern",
    uri: "https://melee.gg/event/1",
    sourcePath: null,
    deckCount: decks.length,
    decks,
    matches: [],
    ...partial,
  };
}

function board(result: string | null, cards: BoardCard[] = [{ name: "Island", count: 1 }]): PlayerBoard {
  return { result, anchorUri: "https://example.test/list", mainboard: cards, sideboard: [] };
}

test("records come from win-loss text, not placements", () => {
  assert.equal(recordFromResult("5-0"), "5-0");
  assert.equal(recordFromResult("5-2-1"), "5-2-1");
  assert.equal(recordFromResult("1st Place"), null);
  assert.equal(recordFromResult("5th Place"), null);
  assert.equal(recordFromResult("Top 8"), null);
  assert.equal(recordFromResult(null), null);
});

test("ranked events keep placement order and leagues keep recorded results", () => {
  const ranked = topFinishes(
    [
      finish({ player: "c", rank: 3 }),
      finish({ player: "a", rank: 1, result: "1st Place" }),
      finish({ player: "b", rank: 2 }),
    ],
    2,
  );
  assert.deepEqual(ranked.map((row) => row.player), ["a", "b"]);

  const league = topFinishes([
    finish({ player: "zero", result: null, hasList: true }),
    finish({ player: "four", result: "4-1" }),
    finish({ player: "five", result: "5-0" }),
  ]);
  assert.deepEqual(league.map((row) => row.player), ["five", "four"]);
});

test("each source keeps its own newest events", () => {
  const rows = [
    { id: "m1", date: "2026-11-03", source: "mtgo.com" },
    { id: "m2", date: "2026-11-02", source: "mtgo.com" },
    { id: "m3", date: "2026-11-01", source: "mtgo.com" },
    { id: "p1", date: "2026-10-01", source: "melee.gg" },
    { id: "p2", date: "2026-09-01", source: "melee.gg" },
  ];
  const groups = [
    { match: (source: string) => source === "mtgo.com" },
    { match: (source: string) => source === "melee.gg" },
  ];
  const selected = selectPerSource(rows, groups, 2);
  assert.deepEqual(selected.map((row) => row.id), ["m1", "m2", "p1", "p2"]);
});

test("the metagame window includes the anchor day and drops the day before the cutoff", () => {
  const anchor = "2026-11-14T00:00:00.000Z";
  assert.equal(eventInWindow("2026-11-14T00:00:00.000Z", anchor, 7), true);
  assert.equal(eventInWindow(new Date(Date.parse(anchor) - 7 * DAY).toISOString(), anchor, 7), true);
  assert.equal(eventInWindow(new Date(Date.parse(anchor) - 7 * DAY - 1).toISOString(), anchor, 7), false);
  assert.equal(TOURNAMENT_PREVIEW, 10);
});

test("tournament indexes omit card lists and event files keep them", () => {
  const listed = event({
    id: "melee.gg:open",
    date: "2026-11-14T00:00:00.000Z",
    decks: [
      { player: "Ada", archetype: "Domain", colorName: null, rank: 1 },
      { player: "Bea", archetype: "Tron", colorName: null, rank: 2 },
    ],
  });
  const boards = new Map<string, Record<string, PlayerBoard>>([[listed.id, { Ada: board("6-1"), Bea: board(null) }]]);
  const parts = magicTournamentParts([listed], (id) => boards.get(id) ?? null);
  const index = parts.find((part) => part.rel.endsWith("/tournaments/index.json"));
  const detail = parts.find((part) => part.rel.endsWith("/open.json") || part.rel.includes("melee-gg-open"));
  assert.ok(index);
  assert.ok(detail);
  const indexText = JSON.stringify(index.doc);
  assert.equal(indexText.includes("mainboard"), false);
  const detailText = JSON.stringify(detail.doc);
  assert.match(detailText, /Island/);
  assert.match(detailText, /6-1/);
  const presented = presentTournaments(
    [
      {
        id: listed.id,
        slug: "melee-gg-open",
        name: "Open",
        date: listed.date,
        source: "melee.gg",
        uri: "https://www.mtgo.com/challenges",
        deckCount: 2,
        finishes: [
          { player: "Ada", archetype: "Domain", rank: 1, record: "6-1", hasList: true },
          { player: "Bea", archetype: "Tron", rank: 2, record: null, hasList: false },
        ],
      },
    ],
    {
      eventHref: () => "/magic/modern/tournaments/melee-gg-open?window=30&source=all",
      archetypeHref: (name) => `/magic/modern/${name}`,
      formatLabel: "Modern",
    },
  );
  assert.equal(presented[0].externalHref, null);
  assert.equal(presented[0].sizeLabel, "2 decks");
  assert.equal(presented[0].finishes[0].listHref, "/magic/modern/tournaments/melee-gg-open?window=30&source=all#deck-1");
  assert.equal(presented[0].finishes[1].listHref, null);
  assert.equal(tournamentSizeLabel({ playerCount: 105, deckCount: 103 }), "105 players");
});

test("the metagame preview keeps the first ten named rows and the tail", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    archetype: `Deck${String(i).padStart(2, "0")}`,
    metaShare: 0.05,
  }));
  rows.push({ archetype: "Colorless Unknown", metaShare: 0.2 });
  rows.push({ archetype: "Tiny", metaShare: 0.001 });
  const split = partitionMetaRows(rows, 10);
  assert.equal(split.preview.length, 10);
  assert.equal(split.rest.length, 2);
  assert.equal(split.tail.length, 2);
  assert.equal(split.preview[0].archetype, "Deck00");
});

test("committed tournament indexes stay newest-first and leave card lists on the event file", () => {
  const files = [
    "data/published/magic/modern/tournaments/index.json",
    "data/published/riftbound/tournaments/index.json",
  ];
  for (const file of files) {
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")) as {
      schemaVersion: number;
      status: string;
      events: { date: string; finishes: unknown[] }[];
    };
    assert.equal(index.schemaVersion, 1);
    assert.equal(index.status, "ok");
    assert.ok(index.events.length > 0);
    const dates = index.events.map((event) => event.date);
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    assert.deepEqual(dates, sorted);
    assert.equal(JSON.stringify(index).includes("mainboard"), false);
    assert.equal(JSON.stringify(index).includes("\"legend\""), false);
    for (const event of index.events) assert.ok(event.finishes.length <= 8);
  }
});

test("publishing an unchanged snapshot adds tournaments without moving publishedAt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-tournaments-"));
  const store = new FactStore(root);
  store.putEvent(
    event({
      id: "melee.gg:open",
      date: "2026-11-01T00:00:00.000Z",
      decks: [{ player: "Ada", archetype: "Domain", colorName: null, rank: 1 }],
    }),
  );
  store.writeBoards("melee.gg:open", { Ada: board("5-0") });
  const first = await publishSnapshot(store, { classifierVersion: "v1", now: new Date("2026-11-02T00:00:00.000Z") });
  assert.equal(first.changed, true);
  const indexPath = path.join(root, "data", "published", "magic", "modern", "tournaments", "index.json");
  assert.equal(fs.existsSync(indexPath), true);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as { events: { name: string; finishes: { hasList: boolean }[] }[] };
  assert.equal(index.events[0].name, "melee.gg:open");
  assert.equal(index.events[0].finishes[0].hasList, true);
  const publishedAt = store.readSnapshot()?.publishedAt;
  const second = await publishSnapshot(store, { classifierVersion: "v1", now: new Date("2026-12-01T00:00:00.000Z") });
  assert.equal(second.changed, false);
  assert.equal(store.readSnapshot()?.publishedAt, publishedAt);
});
