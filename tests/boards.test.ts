import assert from "node:assert/strict";
import test from "node:test";
import { fillKeptBoards, mergeStoredLists, preserveArchetypes } from "../src/lib/facts/boards";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import type { NormalizedEvent } from "../src/lib/facts/normalize";

const today = "2026-11-07";

function event(id: string, players: { player: string; archetype: string }[]): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "v",
    id,
    source: "mtgo.com",
    name: id,
    date: "2026-11-07T00:00:00.000Z",
    format: "Modern",
    uri: null,
    sourcePath: "Tournaments/MTGO/2026/11/07/modern-league.json",
    deckCount: players.length,
    decks: players.map((row) => ({ player: row.player, archetype: row.archetype, colorName: "Red", rank: null })),
    matches: [],
  };
}

function list(name: string): PlayerBoard {
  return { result: null, anchorUri: null, mainboard: [{ name, count: 4 }], sideboard: [] };
}

test("a stored file that lacks a selected player is fetched once and does not replace the good list", async () => {
  const ev = event("mtgo.com:league", [
    { player: "Ada", archetype: "Domain" },
    { player: "Bea", archetype: "Energy" },
  ]);
  const stored = { Ada: list("Lightning Bolt") };
  let calls = 0;
  const first = await fillKeptBoards({
    wanted: [
      { event: ev, player: "Ada" },
      { event: ev, player: "Bea" },
    ],
    readBoards: () => stored,
    fetchEvent: async () => {
      calls++;
      return {
        ok: true,
        normalized: {
          event: ev,
          boards: { Ada: list("Different Card"), Bea: list("Haywire Mite") },
        },
      };
    },
    emptyOn: {},
    today,
  });
  assert.equal(calls, 1);
  assert.equal(first.boards.get(ev.id)?.Ada.mainboard[0]?.name, "Lightning Bolt");
  assert.equal(first.boards.get(ev.id)?.Bea.mainboard[0]?.name, "Haywire Mite");
  assert.equal(first.stats.recovered, 1);
  assert.equal(first.stats.alreadyStored, 1);
  assert.equal(first.archetypeUpdates.length, 1);
  assert.equal(first.archetypeUpdates[0]?.player, "Bea");

  const second = await fillKeptBoards({
    wanted: [{ event: ev, player: "Bea" }],
    readBoards: () => first.boards.get(ev.id) ?? {},
    fetchEvent: async () => {
      calls++;
      return { ok: false, reason: "network" };
    },
    emptyOn: first.emptyOn,
    today,
  });
  assert.equal(calls, 1);
  assert.equal(second.stats.alreadyStored, 1);
  assert.equal(second.stats.networkFailed, 0);
});

test("confirmed-empty upstream is not fetched again the same week, and a network failure is", async () => {
  const ev = event("mtgo.com:league", [{ player: "Ada", archetype: "Domain" }]);
  let calls = 0;
  const empty = await fillKeptBoards({
    wanted: [{ event: ev, player: "Ada" }],
    readBoards: () => ({}),
    fetchEvent: async () => {
      calls++;
      return { ok: true, normalized: { event: ev, boards: { Ada: { result: null, anchorUri: null, mainboard: [], sideboard: [] } } } };
    },
    emptyOn: {},
    today,
  });
  assert.equal(empty.stats.sourceEmpty, 1);
  assert.equal(empty.archetypeUpdates.length, 0);
  const skipped = await fillKeptBoards({
    wanted: [{ event: ev, player: "Ada" }],
    readBoards: () => ({}),
    fetchEvent: async () => {
      calls++;
      return { ok: false, reason: "network" };
    },
    emptyOn: empty.emptyOn,
    today,
  });
  assert.equal(calls, 1);
  assert.equal(skipped.stats.negativeSkipped, 1);

  const flaky = event("mtgo.com:other", [{ player: "Cam", archetype: "Domain" }]);
  const failed = await fillKeptBoards({
    wanted: [{ event: flaky, player: "Cam" }],
    readBoards: () => ({}),
    fetchEvent: async () => {
      calls++;
      return { ok: false, reason: "network" };
    },
    emptyOn: {},
    today,
  });
  assert.equal(failed.stats.networkFailed, 1);
  assert.deepEqual(failed.emptyOn, {});
  await fillKeptBoards({
    wanted: [{ event: flaky, player: "Cam" }],
    readBoards: () => ({}),
    fetchEvent: async () => {
      calls++;
      return { ok: false, reason: "network" };
    },
    emptyOn: failed.emptyOn,
    today,
  });
  assert.equal(calls, 3);
});

test("an empty new list does not replace a known archetype, and ids stay put", () => {
  const existing = event("mtgo.com:league", [{ player: "Ada", archetype: "Domain" }]);
  const incoming: NormalizedEvent = {
    event: {
      ...existing,
      decks: [{ player: "Ada", archetype: "Colorless Unknown", colorName: "Colorless", rank: null }],
    },
    boards: { Ada: { result: null, anchorUri: null, mainboard: [], sideboard: [] } },
  };
  const kept = preserveArchetypes(existing, incoming);
  assert.equal(kept.event.id, existing.id);
  assert.equal(kept.event.decks[0]?.archetype, "Domain");
  const merged = mergeStoredLists(
    { Ada: { result: null, anchorUri: null, mainboard: [{ name: "Bolt", count: 4 }], sideboard: [] } },
    { Ada: { result: null, anchorUri: null, mainboard: [], sideboard: [] }, Bea: { result: null, anchorUri: null, mainboard: [{ name: "Mite", count: 2 }], sideboard: [] } },
  );
  assert.equal(merged.Ada.mainboard[0]?.name, "Bolt");
  assert.equal(merged.Bea.mainboard[0]?.name, "Mite");
});
