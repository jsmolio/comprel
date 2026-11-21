import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeckList } from "../src/components/DeckList";
import { buildSnapshotBody } from "../src/lib/facts/compute";
import { normalizeCacheItem } from "../src/lib/facts/normalize";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import { formatArena, formatMtgo, formatPlain, type TypeLines } from "../src/lib/deck-export";
import { magicTournamentParts } from "../src/lib/tournaments/magic";
import { FORMATS, type BoardCard } from "../src/lib/types";

const types: TypeLines = {
  "Wear // Tear": "Instant // Instant",
  "Delver of Secrets // Insectile Aberration": "Creature — Human Wizard // Creature — Insect",
  "Delver of Secrets": "Creature — Human Wizard",
};

function card(count: number, name: string): BoardCard {
  return { count, name };
}

const split = {
  mainboard: [
    card(2, "Solitude"),
    card(2, " Solitude"),
    card(1, "Delver of Secrets // Insectile Aberration"),
    card(1, "Delver of Secrets"),
    card(1, "Wear/Tear"),
    card(1, "Wear // Tear"),
    card(1, "Supreme Verdict"),
  ],
  sideboard: [card(1, "Supreme Verdict"), card(2, "Sanctifier en-Vec"), card(1, "Sanctifier en-Vec")],
};

test("exporters sum split printings after name rewriting and keep main and side apart", () => {
  const arena = formatArena(split, types);
  assert.equal(
    arena,
    [
      "Deck",
      "4 Solitude",
      "2 Delver of Secrets",
      "2 Wear // Tear",
      "1 Supreme Verdict",
      "",
      "Sideboard",
      "1 Supreme Verdict",
      "3 Sanctifier en-Vec",
      "",
    ].join("\n"),
  );
  assert.equal(
    formatMtgo(split, types),
    ["4 Solitude", "2 Delver of Secrets", "2 Wear // Tear", "1 Supreme Verdict", "", "1 Supreme Verdict", "3 Sanctifier en-Vec", ""].join(
      "\n",
    ),
  );
  assert.equal(
    formatPlain(split, types),
    [
      "4 Solitude",
      "2 Delver of Secrets",
      "2 Wear // Tear",
      "1 Supreme Verdict",
      "",
      "Sideboard",
      "1 Supreme Verdict",
      "3 Sanctifier en-Vec",
      "",
    ].join("\n"),
  );
});

test("deck lists merge one board's rows, keep category and price totals, and use one row per name", () => {
  const cardMap = new Map([
    ["Solitude", { imageUrl: null, typeLine: "Creature — Elemental", manaCost: "{3}{W}{W}", priceUsd: "10.00" }],
    ["Supreme Verdict", { imageUrl: null, typeLine: "Sorcery", manaCost: "{1}{W}{W}{U}", priceUsd: "1.00" }],
    ["Plains", { imageUrl: null, typeLine: "Basic Land — Plains", manaCost: null, priceUsd: null }],
  ]);
  const html = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [card(2, "Solitude"), card(2, " Solitude "), card(1, "Supreme Verdict"), card(1, "Plains"), card(1, "Plains")],
      sideboard: [card(1, "Supreme Verdict")],
      cardMap,
    }),
  );
  assert.equal(html.split("Solitude").length - 1, 1);
  assert.equal(html.split("Supreme Verdict").length - 1, 2);
  assert.match(html, /7 mainboard/);
  assert.match(html, /1 sideboard/);
  assert.match(html, /≈ \$42/);
  assert.match(html, /Creatures \(4\)/);
  assert.match(html, /Spells \(1\)/);
  assert.match(html, /Lands \(2\)/);
  assert.match(html, /Sideboard \(1\)/);
  assert.match(html, />4<\/span><span class="text-neutral-200">Solitude<\/span>/);
  assert.match(html, />2<\/span><span class="text-neutral-200">Plains<\/span>/);

  const zoned = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [],
      sideboard: [],
      cardMap,
      sections: [
        { key: "main", label: "Main deck", categorize: true, cards: [card(2, "Solitude"), card(2, "Solitude")] },
        { key: "sideboard", label: "Sideboard", cards: [card(1, "Solitude"), card(1, "Solitude")] },
      ],
    }),
  );
  assert.match(zoned, /4 main deck · 2 sideboard/);
  assert.match(zoned, /≈ \$60/);
  assert.match(zoned, /Creatures \(4\)/);
  assert.match(zoned, /Sideboard \(2\)/);
  assert.equal(zoned.split("Solitude").length - 1, 2);
  assert.match(zoned, />4<\/span><span class="text-neutral-200">Solitude<\/span>/);
  assert.match(zoned, />2<\/span><span class="text-neutral-200">Solitude<\/span>/);
});

test("toBoard merges catalog rows inside a board and publish keeps that merge", () => {
  const normalized = normalizeCacheItem(
    "mtgo.com",
    "modern-challenge-16-2026-11-2112858934",
    {
      Tournament: { Name: "Modern Challenge 16", Date: "2026-11-21T07:00:00.000Z", Formats: "Modern" },
      Decks: [
        {
          Player: "alessandro81",
          Result: "3-2",
          Mainboard: [
            { Count: 2, CardName: "Solitude" },
            { Count: 2, CardName: " Solitude" },
            { Count: 1, CardName: "Supreme Verdict" },
            { Count: 55, CardName: "Island" },
          ],
          Sideboard: [
            { Count: 1, CardName: "Supreme Verdict" },
            { Count: 2, CardName: "Sanctifier en-Vec" },
            { Count: 1, CardName: "Sanctifier en-Vec" },
          ],
        },
      ],
    },
    new Set(FORMATS),
    "test",
    null,
  );
  assert.deepEqual(normalized?.boards.alessandro81?.mainboard, [
    { name: "Solitude", count: 4 },
    { name: "Supreme Verdict", count: 1 },
    { name: "Island", count: 55 },
  ]);
  assert.deepEqual(normalized?.boards.alessandro81?.sideboard, [
    { name: "Supreme Verdict", count: 1 },
    { name: "Sanctifier en-Vec", count: 3 },
  ]);
  assert.equal(
    normalized?.boards.alessandro81?.mainboard.reduce((sum, row) => sum + row.count, 0),
    60,
  );

  const event: FactEvent = {
    schemaVersion: 1,
    classifierVersion: "v",
    id: "mtgo.com:modern-challenge-16-2026-11-2112858934",
    source: "mtgo.com",
    name: "Modern Challenge 16",
    date: "2026-11-21T07:00:00.000Z",
    format: "Modern",
    uri: null,
    sourcePath: null,
    deckCount: 1,
    decks: [{ player: "alessandro81", archetype: "Azorius Control", colorName: "Azorius", rank: 18 }],
    matches: [],
  };
  const stored: PlayerBoard = {
    result: "3-2",
    anchorUri: null,
    mainboard: [
      { name: "Solitude", count: 2 },
      { name: "Solitude", count: 2 },
      { name: "Supreme Verdict", count: 1 },
    ],
    sideboard: [{ name: "Supreme Verdict", count: 1 }],
  };
  const body = buildSnapshotBody([event], new Map([[event.id, { alessandro81: stored }]]), { videos: [], banEvents: [], cards: {} }, "v");
  const lists = body.formats.find((format) => format.format === "Modern")?.lists.all["Azorius Control"];
  assert.deepEqual(lists?.[0]?.mainboard, [
    { name: "Solitude", count: 4 },
    { name: "Supreme Verdict", count: 1 },
  ]);
  assert.deepEqual(lists?.[0]?.sideboard, [{ name: "Supreme Verdict", count: 1 }]);

  const parts = magicTournamentParts([event], () => ({ alessandro81: stored }));
  const detail = parts.find((part) => part.rel.endsWith(".json") && !part.rel.endsWith("/index.json"));
  const finishes = (detail?.doc as { finishes?: { player: string; mainboard?: BoardCard[]; sideboard?: BoardCard[] }[] }).finishes;
  const row = finishes?.find((finish) => finish.player === "alessandro81");
  assert.deepEqual(row?.mainboard, [
    { name: "Solitude", count: 4 },
    { name: "Supreme Verdict", count: 1 },
  ]);
  assert.deepEqual(row?.sideboard, [{ name: "Supreme Verdict", count: 1 }]);
});
