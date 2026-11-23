import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classify, conditionMatches, knownConditionType, unknownConditionTypes } from "../src/lib/archetype/classify";
import { parseLenientJson } from "../src/lib/formatdata";
import type { BoardCard } from "../src/lib/types";

function cards(names: Record<string, number>): BoardCard[] {
  return Object.entries(names).map(([name, count]) => ({ name, count }));
}

function ruleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files.push(...ruleFiles(full));
    else if (name.endsWith(".json") && name !== "card_colors.json" && name !== "metas.json" && !name.startsWith("color_")) {
      files.push(full);
    }
  }
  return files;
}

test("condition types match case-insensitively and every rule file uses a known type", () => {
  assert.equal(knownConditionType("OneOrMoreInMainboard"), true);
  assert.equal(knownConditionType("OneorMoreInMainboard"), true);
  assert.equal(knownConditionType("ExactlyThreeInMainboard"), false);
  assert.equal(
    conditionMatches("OneorMoreInMainboard", ["Haliya, Guided by Light", "Abandoned Air Temple"], ["Abandoned Air Temple"]),
    true,
  );
  assert.equal(conditionMatches("OneorMoreInMainboard", ["Haliya, Guided by Light"], []), false);

  const unknown: string[] = [];
  for (const file of [
    ...ruleFiles(path.join("data", "mtgoformatdata", "Formats")),
    ...ruleFiles(path.join("data", "rule-overrides")),
  ]) {
    const parsed = parseLenientJson(fs.readFileSync(file, "utf8"));
    for (const type of unknownConditionTypes(parsed)) unknown.push(`${file}: ${type}`);
  }
  assert.deepEqual(unknown, []);
});

test("Standard rules name Worlds constructed decks and the Momo shells", () => {
  const mission = classify(
    "Standard",
    cards({
      "Steam Vents": 4,
      Island: 8,
      "Anthropological Mission": 4,
      "Ral, Crackling Wit": 4,
      "Sleight of Hand": 4,
      Opt: 4,
      "Spirebluff Canal": 4,
      "Into the Flood Maw": 4,
      "Torch the Tower": 4,
      "Spell Pierce": 4,
      "Spell Snare": 4,
      "Burst Lightning": 4,
      "Riverpyre Verge": 4,
      "Stormcarved Coast": 4,
    }),
    [],
  );
  assert.equal(mission.archetype, "Izzet Mission");

  const pixie = classify(
    "Standard",
    cards({
      "Sacred Foundry": 4,
      Plains: 4,
      Mountain: 4,
      "Nurturing Pixie": 4,
      "The Naked Time": 4,
      "Momo, Friendly Flier": 4,
      "Sage of the Skies": 4,
      "Starfield Shepherd": 4,
      "Abandoned Air Temple": 2,
      "Torch the Tower": 4,
      "Seam Rip": 4,
      "Inspiring Vantage": 4,
      "Sunbillow Verge": 4,
      "Starting Town": 4,
      "Guiding Hydra": 2,
      "Nova Hellkite": 4,
    }),
    [],
  );
  assert.equal(pixie.archetype, "Boros Pixie");

  const momo = classify(
    "Standard",
    cards({
      "Hallowed Fountain": 4,
      Plains: 8,
      Island: 8,
      "Momo, Friendly Flier": 4,
      "Haliya, Guided by Light": 4,
      "Floodfarm Verge": 4,
      "Seam Rip": 4,
      "No More Lies": 4,
      "Get Lost": 4,
      "Rest in Peace": 4,
      "Day of Judgment": 4,
      "Consult the Star Charts": 4,
      "Three Steps Ahead": 4,
    }),
    [],
  );
  assert.equal(momo.archetype, "Azorius Momo");

  // The common shell has no Haliya and no Abandoned Air Temple.
  const shell = classify(
    "Standard",
    cards({
      "Hallowed Fountain": 4,
      Plains: 6,
      Island: 6,
      "Momo, Friendly Flier": 4,
      "Starfield Shepherd": 4,
      "Sage of the Skies": 4,
      "Quantum Riddler": 4,
      Daydream: 4,
      "Seam Rip": 4,
      "No More Lies": 4,
      "Get Lost": 2,
    }),
    [],
  );
  assert.equal(shell.archetype, "Azorius Momo");

  const riddlerOnly = classify(
    "Standard",
    cards({
      "Hallowed Fountain": 4,
      Plains: 8,
      Island: 8,
      "Momo, Friendly Flier": 4,
      "Quantum Riddler": 4,
      "No More Lies": 4,
    }),
    [],
  );
  assert.equal(riddlerOnly.archetype, "Azorius Momo");

  const control = classify(
    "Standard",
    cards({
      "Hallowed Fountain": 4,
      Plains: 6,
      Island: 8,
      "Get Lost": 4,
      "Day of Judgment": 4,
      "Consult the Star Charts": 4,
      "No More Lies": 4,
      "Three Steps Ahead": 4,
      "Stock Up": 4,
      "Beza, the Bounding Spring": 3,
    }),
    [],
  );
  assert.equal(control.archetype, "Azorius Control");

  const borosMomo = classify(
    "Standard",
    cards({
      "Sacred Foundry": 4,
      Plains: 6,
      Mountain: 6,
      "Momo, Friendly Flier": 4,
      "Sage of the Skies": 4,
      "Starfield Shepherd": 4,
      "Torch the Tower": 4,
      "Seam Rip": 4,
    }),
    [],
  );
  assert.equal(borosMomo.archetype, "Boros Momo");

  const michelangelo = classify(
    "Standard",
    cards({
      "Temple Garden": 4,
      Forest: 10,
      Plains: 4,
      "Michelangelo, Weirdness to 11": 4,
      Ouroboroid: 4,
      "Llanowar Elves": 4,
      "Gene Pollinator": 4,
      "Bejeweled Warg": 4,
      "Brightglass Gearhulk": 4,
      "Guiding Hydra": 4,
      "Surrak, Elusive Hunter": 4,
      "Pawpatch Recruit": 4,
      "Practiced Offense": 4,
      "Hushwood Verge": 2,
    }),
    [],
  );
  assert.equal(michelangelo.archetype, "Selesnya Michelangelo");

  const sacrifice = classify(
    "Standard",
    cards({
      "Blood Crypt": 4,
      "Stomping Ground": 4,
      "Overgrown Tomb": 4,
      "Obsessive Pursuit": 4,
      "Umbral Collar Zealot": 4,
      "Greedy Freebooter": 4,
      "Lively Dirge": 4,
      "Torch the Tower": 4,
      "Blooming Marsh": 4,
      "Starting Town": 4,
      "Gene Pollinator": 4,
      "The Sackville-Bagginses": 4,
      "Biotech Specialist": 4,
      Forest: 4,
      Swamp: 2,
      Mountain: 2,
    }),
    [],
  );
  assert.equal(sacrifice.archetype, "Jund Sacrifice");
});

const SHELL = ["Seasoned Cryomancer", "Superior Spider-Man", "Overlord of the Balemurk", "Uldaros Theorix"];
const SHOWCASE = path.join(
  "data",
  "published",
  "magic",
  "standard",
  "tournaments",
  "mtgo-com-standard-showcase-challenge-2026-11-2112858912.json",
);
const LEAGUE = path.join(
  "data",
  "published",
  "magic",
  "standard",
  "tournaments",
  "mtgo-com-standard-league-2026-11-2111361.json",
);

interface StoredList {
  player: string;
  rank: number | null;
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  where: string;
}

function cardNames(board: BoardCard[]): Set<string> {
  return new Set(board.map((card) => card.name));
}

function copies(board: BoardCard[], name: string): number {
  return board.filter((card) => card.name === name).reduce((sum, card) => sum + card.count, 0);
}

function shellCount(board: BoardCard[]): number {
  const names = cardNames(board);
  return SHELL.filter((name) => names.has(name)).length;
}

function readTournament(file: string): { date: string; finishes: StoredList[] } {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    date: string;
    finishes: { player: string; rank: number | null; mainboard?: BoardCard[]; sideboard?: BoardCard[] }[];
  };
  return {
    date: data.date,
    finishes: (data.finishes ?? []).map((finish) => ({
      player: finish.player,
      rank: finish.rank,
      mainboard: finish.mainboard ?? [],
      sideboard: finish.sideboard ?? [],
      where: file,
    })),
  };
}

function readMtgoSamples(): StoredList[] {
  const data = JSON.parse(fs.readFileSync(path.join("data", "published", "magic", "standard", "lists", "mtgo.json"), "utf8")) as {
    lists: Record<string, { player: string; rank: number | null; mainboard?: BoardCard[]; sideboard?: BoardCard[]; anchorUri?: string }[]>;
  };
  const lists: StoredList[] = [];
  for (const [archetype, rows] of Object.entries(data.lists)) {
    for (const row of rows) {
      lists.push({
        player: row.player,
        rank: row.rank,
        mainboard: row.mainboard ?? [],
        sideboard: row.sideboard ?? [],
        where: `${archetype} ${row.anchorUri ?? ""}`.trim(),
      });
    }
  }
  return lists;
}

function requireList(lists: StoredList[], player: string): StoredList {
  const deck = lists.find((row) => row.player === player && row.mainboard.length > 0);
  assert.ok(deck, `stored list for ${player}`);
  return deck;
}

test("Arianne's 11/21 Standard Showcase top 8 list is Dimir Reanimator", () => {
  const event = readTournament(SHOWCASE);
  assert.match(event.date, /^2026-11-21/);
  const deck = requireList(event.finishes, "Arianne");
  assert.ok(deck.rank != null && deck.rank <= 8);
  assert.equal(cardNames(deck.mainboard).has("Deceit"), true);
  assert.ok(shellCount(deck.mainboard) >= 2);
  assert.equal(copies(deck.mainboard, "Doomsday Excruciator"), 0);
  assert.equal(classify("Standard", deck.mainboard, deck.sideboard).archetype, "Dimir Reanimator");
});

test("Sordyrrum's 11/21 Standard league list with Excruciator in the side is Dimir Reanimator", () => {
  const event = readTournament(LEAGUE);
  assert.match(event.date, /^2026-11-21/);
  const deck = requireList(event.finishes, "Sordyrrum");
  assert.equal(copies(deck.sideboard, "Doomsday Excruciator"), 2);
  assert.equal(copies(deck.mainboard, "Doomsday Excruciator"), 0);
  assert.equal(cardNames(deck.mainboard).has("Deceit"), true);
  assert.ok(shellCount(deck.mainboard) >= 2);
  assert.equal(classify("Standard", deck.mainboard, deck.sideboard).archetype, "Dimir Reanimator");
});

test("Kritik's 11/21 Standard league list is Grixis Reanimator", () => {
  const event = readTournament(LEAGUE);
  assert.match(event.date, /^2026-11-21/);
  const deck = requireList(event.finishes, "Kritik");
  assert.equal(cardNames(deck.mainboard).has("Deceit"), true);
  assert.ok(shellCount(deck.mainboard) >= 2);
  assert.equal(classify("Standard", deck.mainboard, deck.sideboard).archetype, "Grixis Reanimator");
});

test("a stored Dimir Deceit list with Doomsday Excruciator in the main stays Dimir Excruciator", () => {
  const decks = readMtgoSamples().filter((row) => copies(row.mainboard, "Doomsday Excruciator") > 0 && cardNames(row.mainboard).has("Deceit"));
  const dimir = decks.filter((row) => classify("Standard", row.mainboard, row.sideboard).colorName === "Dimir");
  assert.ok(dimir.length > 0);
  for (const deck of dimir) {
    assert.equal(classify("Standard", deck.mainboard, deck.sideboard).archetype, "Dimir Excruciator", deck.where);
  }
});

test("stored Dimir control with Consult, Countersculpt, and Three Steps Ahead stays Dimir Control", () => {
  const wanted = ["Consult the Star Charts", "Countersculpt", "Three Steps Ahead"];
  const dir = path.join("data", "published", "magic", "standard", "tournaments");
  const decks: StoredList[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("mtgo-") || !name.endsWith(".json")) continue;
    for (const finish of readTournament(path.join(dir, name)).finishes) {
      const names = cardNames(finish.mainboard);
      if (wanted.every((card) => names.has(card)) && !names.has("Deceit")) decks.push(finish);
    }
  }
  const dimir = decks.filter((row) => classify("Standard", row.mainboard, row.sideboard).colorName === "Dimir");
  assert.ok(dimir.length > 0);
  for (const deck of dimir) {
    assert.equal(classify("Standard", deck.mainboard, deck.sideboard).archetype, "Dimir Control", `${deck.player} ${deck.where}`);
  }
});

test("Deceit without the reanimator shell is not Reanimator", () => {
  const deck = readMtgoSamples().find(
    (row) => row.player === "-yursus-" && cardNames(row.mainboard).has("Deceit") && shellCount(row.mainboard) < 2,
  );
  assert.ok(deck, "stored -yursus- Deceit list");
  const archetype = classify("Standard", deck.mainboard, deck.sideboard).archetype;
  assert.equal(archetype === "Reanimator" || archetype.endsWith(" Reanimator"), false, archetype);
});
