import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeckList } from "../src/components/DeckList";
import {
  deckExportFilename,
  exportCardName,
  formatArena,
  formatMtgo,
  formatPlain,
  type TypeLines,
} from "../src/lib/deck-export";
import type { BoardCard } from "../src/lib/types";

const types: TypeLines = {
  "Fire // Ice": "Instant // Instant",
  "Wear // Tear": "Instant // Instant",
  "Bottomless Pool // Locker Room": "Enchantment — Room // Enchantment — Room",
  "Bonecrusher Giant // Stomp": "Creature — Giant // Adventure",
  "Marang River Regent // Coil and Catch": "Creature — Dragon // Instant — Omen",
  "Delver of Secrets // Insectile Aberration": "Creature — Human Wizard // Creature — Insect",
  "Delver of Secrets": "Creature — Human Wizard",
  "Valakut Awakening // Valakut Stoneforge": "Instant // Land",
  "Valakut Awakening": "Instant",
  "Boggart Trawler": "Creature — Goblin",
  "SP//dr, Piloted by Peni": "Legendary Artifact Creature — Spider Hero",
  "Summon: Choco/Mog": "Enchantment Creature — Saga Bird Moogle",
  "Jadzi, Steward of Fate // Oracle's Gift": "Legendary Creature — Human Wizard // Sorcery",
};

const deck = {
  mainboard: [
    card(4, "Lightning Bolt"),
    card(1, "Fire // Ice"),
    card(1, "Wear/Tear"),
    card(1, "Delver of Secrets // Insectile Aberration"),
    card(1, "Valakut Awakening // Valakut Stoneforge"),
    card(1, "Scavenger Regent // Exude Toxin // Scavenger Regent"),
    card(1, "Bottomless Pool // Locker Room"),
    card(1, "Bonecrusher Giant // Stomp"),
    card(1, "SP//dr, Piloted by Peni"),
    card(1, "Summon: Choco/Mog"),
    card(18, "Mountain"),
    card(2, "Snow-Covered Island"),
    card(1, "Wastes"),
    card(1, "Plains"),
  ],
  sideboard: [
    card(3, "Smash to Smithereens"),
    card(1, "Boggart Trawler // Boggart Bog"),
    card(4, "Island"),
  ],
};

test("arena names keep splits and use the front face of double-faced cards", () => {
  assert.equal(exportCardName("Fire // Ice", types), "Fire // Ice");
  assert.equal(exportCardName("Wear/Tear", types), "Wear // Tear");
  assert.equal(exportCardName("Bottomless Pool // Locker Room", types), "Bottomless Pool // Locker Room");
  assert.equal(exportCardName("Bonecrusher Giant // Stomp", types), "Bonecrusher Giant // Stomp");
  assert.equal(
    exportCardName("Scavenger Regent // Exude Toxin // Scavenger Regent", types),
    "Scavenger Regent // Exude Toxin",
  );
  assert.equal(exportCardName("Jadzi, Steward of Fate // Oracle's Gift", types), "Jadzi, Steward of Fate // Oracle's Gift");
  assert.equal(exportCardName("Delver of Secrets // Insectile Aberration", types), "Delver of Secrets");
  assert.equal(exportCardName("Valakut Awakening // Valakut Stoneforge", types), "Valakut Awakening");
  assert.equal(exportCardName("Boggart Trawler // Boggart Bog", types), "Boggart Trawler");
  assert.equal(exportCardName("Delver of Secrets", types), "Delver of Secrets");
  assert.equal(exportCardName("SP//dr, Piloted by Peni", types), "SP//dr, Piloted by Peni");
  assert.equal(exportCardName("Summon: Choco/Mog", types), "Summon: Choco/Mog");
  assert.equal(exportCardName("Snow-Covered Island", types), "Snow-Covered Island");
  assert.equal(exportCardName("Wastes", types), "Wastes");
  assert.equal(exportCardName("Plains"), "Plains");
});

test("arena export uses Deck and Sideboard sections and name-only lines", () => {
  const text = formatArena(deck, types);
  assert.equal(
    text,
    [
      "Deck",
      "4 Lightning Bolt",
      "1 Fire // Ice",
      "1 Wear // Tear",
      "1 Delver of Secrets",
      "1 Valakut Awakening",
      "1 Scavenger Regent // Exude Toxin",
      "1 Bottomless Pool // Locker Room",
      "1 Bonecrusher Giant // Stomp",
      "1 SP//dr, Piloted by Peni",
      "1 Summon: Choco/Mog",
      "18 Mountain",
      "2 Snow-Covered Island",
      "1 Wastes",
      "1 Plains",
      "",
      "Sideboard",
      "3 Smash to Smithereens",
      "1 Boggart Trawler",
      "4 Island",
      "",
    ].join("\n"),
  );
  assert.equal(text.includes("(SET)"), false);
  assert.equal(formatArena({ mainboard: [card(4, "Lightning Bolt")], sideboard: [] }, types), "Deck\n4 Lightning Bolt\n");
});

test("mtgo text separates the sideboard with a blank line and no heading", () => {
  const text = formatMtgo(deck, types);
  const [main, side] = text.trimEnd().split("\n\n");
  assert.equal(main.split("\n")[0], "4 Lightning Bolt");
  assert.equal(main.includes("Sideboard"), false);
  assert.equal(main.includes("18 Mountain"), true);
  assert.equal(main.includes("2 Snow-Covered Island"), true);
  assert.equal(main.includes("1 Wastes"), true);
  assert.equal(side, "3 Smash to Smithereens\n1 Boggart Trawler\n4 Island");
  assert.equal(formatMtgo({ mainboard: [card(1, "Island")], sideboard: [] }), "1 Island\n");
  assert.equal(formatMtgo({ mainboard: [], sideboard: [card(2, "Plains")] }), "\n2 Plains\n");
  assert.equal(formatMtgo({ mainboard: [], sideboard: [] }), "");
});

test("plain text is count and name, with a Sideboard section", () => {
  const text = formatPlain(
    {
      mainboard: [card(4, "Lightning Bolt"), card(1, "Fire // Ice"), card(3, "Plains")],
      sideboard: [card(2, "Delver of Secrets // Insectile Aberration")],
    },
    types,
  );
  assert.equal(text, "4 Lightning Bolt\n1 Fire // Ice\n3 Plains\n\nSideboard\n2 Delver of Secrets\n");
  assert.equal(formatPlain({ mainboard: [card(1, "Mountain")], sideboard: [] }), "1 Mountain\n");
});

test("filename carries the format, archetype, player, and event", () => {
  assert.equal(
    deckExportFilename({
      format: "Modern",
      archetype: "Izzet Prowess",
      player: "Alice/Bob",
      event: "Challenge: 32",
      date: "2026-03-01",
    }),
    "Modern - Izzet Prowess - Alice Bob - Challenge 32 - 2026-03-01.txt",
  );
  assert.equal(deckExportFilename({}), "deck.txt");
});

test("magic lists render export buttons and zoned lists do not", () => {
  const cardMap = new Map([["Lightning Bolt", { imageUrl: null, typeLine: "Instant", manaCost: "{R}", priceUsd: null }]]);
  const withExport = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [card(4, "Lightning Bolt")],
      sideboard: [card(2, "Plains")],
      cardMap,
      exportMeta: { format: "Modern", archetype: "Burn", player: "Alice", event: "Challenge", date: "2026-03-01" },
    }),
  );
  assert.match(withExport, /Copy for Arena/);
  assert.match(withExport, /Download for MTGO/);
  assert.match(withExport, /Copy text/);
  const bare = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [card(4, "Lightning Bolt")],
      sideboard: [],
      cardMap,
    }),
  );
  assert.equal(bare.includes("Copy for Arena"), false);
  const zoned = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [],
      sideboard: [],
      cardMap,
      sections: [{ key: "main", label: "Main deck", cards: [card(3, "Lightning Bolt")] }],
      exportMeta: { player: "Alice" },
    }),
  );
  assert.equal(zoned.includes("Copy for Arena"), false);
});

function card(count: number, name: string): BoardCard {
  return { count, name };
}
