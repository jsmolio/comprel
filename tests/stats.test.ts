import assert from "node:assert/strict";
import test from "node:test";
import { anchorMs, computeSlice } from "../src/lib/facts/compute";
import { DAY_MS, TREND_HISTORY_DAYS } from "../src/lib/facts/horizon";
import type { FactEvent, FactMatch } from "../src/lib/facts/types";

const ANCHOR = Date.parse("2026-11-01T00:00:00.000Z");

function event(partial: Partial<FactEvent> & Pick<FactEvent, "id" | "date" | "decks">): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "test",
    source: "melee.gg",
    name: partial.id,
    format: "Modern",
    uri: null,
    sourcePath: null,
    deckCount: partial.decks.length,
    matches: [],
    ...partial,
  };
}

function deck(player: string, archetype: string, rank: number | null = null) {
  return { player, archetype, colorName: "Colorless", rank };
}

function padAnchor(extra: FactEvent[] = []): FactEvent[] {
  const anchorDecks = Array.from({ length: 25 }, (_, i) => deck(`anchor-${i}`, i < 3 ? "Amulet" : "Energy"));
  return [
    event({ id: "melee.gg:anchor", date: new Date(ANCHOR).toISOString(), decks: anchorDecks, deckCount: 25 }),
    ...extra,
  ];
}

test("365-day trend reads the previous 365 days, which 365-day retention dropped", () => {
  assert.equal(TREND_HISTORY_DAYS, 730);
  const atEdge = ANCHOR - 730 * DAY_MS;
  const justOutside = atEdge - 1;
  const inPrev = ANCHOR - 400 * DAY_MS;
  const events = padAnchor([
    event({
      id: "melee.gg:edge",
      date: new Date(atEdge).toISOString(),
      decks: [deck("edge", "Domain")],
    }),
    event({
      id: "melee.gg:outside",
      date: new Date(justOutside).toISOString(),
      decks: [deck("out", "Domain")],
    }),
    event({
      id: "melee.gg:prev",
      date: new Date(inPrev).toISOString(),
      decks: [deck("prev", "Tron")],
    }),
    event({
      id: "melee.gg:current",
      date: new Date(ANCHOR - 10 * DAY_MS).toISOString(),
      decks: [deck("cur", "Domain")],
    }),
  ]);
  assert.equal(anchorMs(events.filter((e) => e.format === "Modern")), ANCHOR);
  const slice = computeSlice(events, ANCHOR, 365, "all");
  const domain = slice.rows.find((row) => row.archetype === "Domain");
  const tron = slice.rows.find((row) => row.archetype === "Tron");
  assert.ok(domain);
  assert.equal(tron, undefined);
  // Previous window decks: edge Domain + prev Tron. Domain's previous share is 1/2.
  // Current Domain decks: the current-window one only (anchor decks are Amulet/Energy).
  assert.equal(domain.prevShare, 0.5);
  assert.equal(domain.deckCount, 1);
  const amulet = slice.rows.find((row) => row.archetype === "Amulet");
  assert.equal(amulet?.prevShare, undefined);
});

test("pairing win rate ignores mirrors and keeps draws out of the denominator", () => {
  const decks = [
    deck("A1", "Amulet"),
    deck("A2", "Amulet"),
    deck("A3", "Amulet"),
    deck("E1", "Energy"),
    deck("E2", "Energy"),
    deck("E3", "Energy"),
  ];
  const matches: FactMatch[] = [
    { player1: "A1", player2: "A2", winner: 1 },
    { player1: "A1", player2: "E1", winner: 1 },
    { player1: "A2", player2: "E2", winner: 2 },
    { player1: "A3", player2: "E3", winner: 0 },
  ];
  const events = padAnchor([
    event({ id: "melee.gg:pair", date: new Date(ANCHOR - DAY_MS).toISOString(), decks, matches, deckCount: 6 }),
  ]);
  const slice = computeSlice(events, ANCHOR, 30, "all");
  const amulet = slice.rows.find((row) => row.archetype === "Amulet");
  const energy = slice.rows.find((row) => row.archetype === "Energy");
  assert.equal(amulet?.matchWins, 1);
  assert.equal(amulet?.matchLosses, 1);
  assert.equal(amulet?.matchDraws, 1);
  assert.equal(amulet?.winRate, 0.5);
  assert.equal(energy?.winRate, 0.5);
  const cell = slice.matchups.find((m) => m.archetypeA === "Amulet" && m.archetypeB === "Energy");
  assert.ok(cell);
  assert.equal(cell.winsA, 1);
  assert.equal(cell.winsB, 1);
  assert.equal(cell.draws, 1);
  assert.equal(cell.matches, 3);
  assert.equal(cell.winRateA, 0.5);
  // Independent Wilson(1, 2): z=1.96, successes=1, n=2.
  const z = 1.96;
  const n = 2;
  const p = 0.5;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const low = Math.max(0, (center - margin) / denom);
  const high = Math.min(1, (center + margin) / denom);
  assert.ok(Math.abs(cell.ciLow - low) < 1e-12);
  assert.ok(Math.abs(cell.ciHigh - high) < 1e-12);
});

test("source filters do not mix paper and MTGO decks", () => {
  const events = padAnchor([
    event({
      id: "mtgo.com:league",
      source: "mtgo.com",
      date: new Date(ANCHOR - 2 * DAY_MS).toISOString(),
      decks: [deck("m1", "Domain"), deck("m2", "Domain"), deck("m3", "Domain")],
    }),
  ]);
  const paper = computeSlice(events, ANCHOR, 30, "paper");
  const mtgo = computeSlice(events, ANCHOR, 30, "mtgo");
  assert.equal(paper.rows.find((row) => row.archetype === "Domain"), undefined);
  assert.equal(mtgo.rows.find((row) => row.archetype === "Domain")?.deckCount, 3);
  assert.equal(mtgo.totalDecks, 3);
});

test("conversion counts only ranked decks in large enough events", () => {
  const events = padAnchor([
    event({
      id: "melee.gg:big",
      date: new Date(ANCHOR - DAY_MS).toISOString(),
      deckCount: 64,
      decks: [
        deck("p1", "Domain", 1),
        deck("p2", "Domain", 40),
        deck("p3", "Domain", null),
      ],
    }),
    event({
      id: "melee.gg:small",
      date: new Date(ANCHOR - 2 * DAY_MS).toISOString(),
      deckCount: 10,
      decks: [deck("p4", "Domain", 1)],
    }),
  ]);
  const row = computeSlice(events, ANCHOR, 30, "all").rows.find((r) => r.archetype === "Domain");
  assert.equal(row?.conversion.elig8, 2);
  assert.equal(row?.conversion.top8, 1);
  assert.equal(row?.conversion.elig32, 2);
  assert.equal(row?.conversion.top32, 1);
});
