import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fillKeptBoards } from "../src/lib/facts/boards";
import { FactStore } from "../src/lib/facts/store";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import { importPremierEvents, PREMIER_LOOKBACK_DAYS, type FetchInit } from "../src/lib/sources/premier";
import { matchOfficialName, mergeRosterLists, type RosterList } from "../src/lib/sources/premier-parse";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const WORLDS_ID = "melee.gg:world-championship-32-in-atlanta-usa-standard-471980-2026-11-13";

function pile(name: string, count: number): { name: string; count: number }[] {
  return [{ name, count }];
}

function row(partial: Partial<RosterList> & Pick<RosterList, "player" | "mainboard">): RosterList {
  return {
    archetype: partial.archetype ?? null,
    colorName: partial.colorName ?? null,
    rank: partial.rank ?? null,
    result: partial.result ?? null,
    anchorUri: partial.anchorUri ?? null,
    sideboard: partial.sideboard ?? [],
    ...partial,
  };
}

test("handles and casing map to one official name, and ambiguous handles do not", () => {
  const roster = ["Eduardo Sajgalik", "Kellen Pastore", "Stefan Schütz"];
  assert.equal(matchOfficialName("EduS", roster), "Eduardo Sajgalik");
  assert.equal(matchOfficialName("KELLEN PASTORE", roster), "Kellen Pastore");
  assert.equal(matchOfficialName("Stefan Schutz", roster), "Stefan Schütz");
  assert.equal(matchOfficialName("EduS", ["Eduardo Sajgalik", "Eduardo Smith"]), null);
  assert.equal(matchOfficialName("EduS", ["Eduardo Sajgalik", "Edmund Stone"]), "Eduardo Sajgalik");
});

test("a 60-card magic.gg list with a sideboard replaces a 40-card cached list", () => {
  const merged = mergeRosterLists(
    [
      row({ player: "EduS", archetype: "Gruul Unknown", mainboard: pile("Island", 40) }),
      row({ player: "KELLEN PASTORE", archetype: "Simic Unknown", mainboard: pile("Swamp", 40), sideboard: [] }),
      row({ player: "James Drake", archetype: "Selesnya Landfall", mainboard: pile("Forest", 60), sideboard: pile("Seam Rip", 15) }),
    ],
    [
      row({
        player: "Eduardo Sajgalik",
        archetype: "Izzet Mission",
        mainboard: pile("Island", 60),
        sideboard: pile("Spell Pierce", 15),
      }),
      row({
        player: "Kellen Pastore",
        archetype: "Dimir Control",
        mainboard: pile("Swamp", 60),
        sideboard: pile("Duress", 15),
      }),
    ],
  );
  const byName = new Map(merged.lists.map((list) => [list.player, list]));
  assert.equal(byName.get("Eduardo Sajgalik")?.archetype, "Izzet Mission");
  assert.equal(byName.get("Eduardo Sajgalik")?.mainboard[0]?.count, 60);
  assert.equal(byName.get("Eduardo Sajgalik")?.sideboard[0]?.count, 15);
  assert.equal(byName.get("Kellen Pastore")?.archetype, "Dimir Control");
  assert.equal(byName.get("Kellen Pastore")?.mainboard[0]?.count, 60);
  assert.equal(byName.has("EduS"), false);
  assert.equal(byName.has("KELLEN PASTORE"), false);
  assert.equal(byName.get("James Drake")?.archetype, "Selesnya Landfall");
  assert.deepEqual(merged.unmatched, ["James Drake"]);
  assert.equal(merged.aliases.get("EduS"), "Eduardo Sajgalik");
  assert.equal(merged.aliases.get("KELLEN PASTORE"), "Kellen Pastore");
});

function worldsEvent(decks: FactEvent["decks"], extra: Partial<FactEvent> = {}): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "cache",
    id: WORLDS_ID,
    source: "melee.gg",
    name: "World Championship 32 in Atlanta, USA",
    date: "2026-11-13T14:00:00.000Z",
    format: "Standard",
    uri: "https://melee.gg/Tournament/View/471980",
    sourcePath: "Tournaments/MTGmelee/2026/11/13/world-championship-32.json",
    deckCount: decks.length,
    decks,
    matches: [{ player1: "EduS", player2: "KELLEN PASTORE", winner: 1 }],
    ...extra,
  };
}

test("premier lists replace draft handles, and a later cache write cannot clobber them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-roster-"));
  const store = new FactStore(root);
  store.putEvent(
    worldsEvent([
      { player: "EduS", archetype: "Gruul Unknown", colorName: "Gruul", rank: 2 },
      { player: "KELLEN PASTORE", archetype: "Simic Unknown", colorName: "Simic", rank: 3 },
      { player: "Stefan Schütz", archetype: "Simic Unknown", colorName: "Simic", rank: 1 },
      { player: "NopeHandle", archetype: "Unknown", colorName: null, rank: 40 },
    ]),
  );
  const draft = (name: string): PlayerBoard => ({
    result: null,
    anchorUri: null,
    mainboard: pile(name, 40),
    sideboard: [],
  });
  store.writeBoards(WORLDS_ID, {
    EduS: draft("Forest"),
    "KELLEN PASTORE": draft("Swamp"),
    "Stefan Schütz": draft("Island"),
    NopeHandle: draft("Mountain"),
  });

  const sixty = (card: string) => Array.from({ length: 15 }, () => `4 ${card}`).join("\n");
  const fifteen = (card: string) => Array.from({ length: 15 }, () => `1 ${card}`).join("\n");
  const pages = new Map<string, string>([
    ["https://magic.gg/robots.txt", "User-agent: *\nDisallow:\n"],
    ["https://melee.gg/robots.txt", "User-agent: *\nCrawl-delay: 5\nDisallow: /Decklist/View/\n"],
    [
      "https://magic.gg/decklists",
      `<a href="/decklists/magic-world-championship-32-standard-decklists">Magic World Championship 32 Standard Decklists November 13, 2026</a>`,
    ],
    [
      "https://magic.gg/decklists/magic-world-championship-32-standard-decklists",
      `<deck-list deck-title="Eduardo Sajgalik" subtitle="Izzet Mission" format="Standard" event-date="November 13, 2026" event-name="World Championship 32">
        <main-deck>${sixty("Steam Vents")}</main-deck><side-board>${fifteen("Spell Pierce")}</side-board></deck-list>
       <deck-list deck-title="Kellen Pastore" subtitle="Dimir Control" format="Standard" event-date="November 13, 2026" event-name="World Championship 32">
        <main-deck>${sixty("Island")}</main-deck><side-board>${fifteen("Duress")}</side-board></deck-list>
       <deck-list deck-title="Stefan Schütz" subtitle="Azorius Control" format="Standard" event-date="November 13, 2026" event-name="World Championship 32">
        <main-deck>${sixty("Plains")}</main-deck><side-board>${fifteen("Get Lost")}</side-board></deck-list>`,
    ],
  ]);
  const result = await importPremierEvents({
    store,
    days: PREMIER_LOOKBACK_DAYS,
    now: () => NOW,
    sleep: async () => {},
    meleeDelayMs: 0,
    magicDelayMs: 0,
    fetch: async (url: string, _init: FetchInit) => {
      const text = pages.get(url);
      if (!text) return { status: 404, text: "" };
      return { status: 200, text };
    },
  });

  const saved = store.readEvent(WORLDS_ID);
  assert.ok(saved?.premierLists);
  assert.equal(saved?.listSource, "magic.gg");
  const names = new Map(saved?.decks.map((deck) => [deck.player, deck.archetype]));
  assert.equal(names.get("Eduardo Sajgalik"), "Izzet Mission");
  assert.equal(names.get("Kellen Pastore"), "Dimir Control");
  assert.equal(names.get("Stefan Schütz"), "Azorius Control");
  assert.equal(names.has("EduS"), false);
  assert.equal(names.has("KELLEN PASTORE"), false);
  const boards = store.readBoards(WORLDS_ID);
  assert.equal(boards?.["Eduardo Sajgalik"]?.mainboard.reduce((sum, card) => sum + card.count, 0), 60);
  assert.equal(boards?.["Eduardo Sajgalik"]?.sideboard.reduce((sum, card) => sum + card.count, 0), 15);
  assert.equal(boards?.["Kellen Pastore"]?.sideboard.reduce((sum, card) => sum + card.count, 0), 15);
  assert.ok(result.unmatchedNames.some((row) => row.name === "NopeHandle"));
  assert.equal(result.unmatchedNames.some((row) => row.name === "EduS"), false);

  const clobber = store.putEvent(
    worldsEvent([{ player: "EduS", archetype: "Gruul Unknown", colorName: "Gruul", rank: 2 }], { sourcePath: saved?.sourcePath }),
  );
  assert.equal(clobber.changed, false);
  assert.equal(store.readEvent(WORLDS_ID)?.decks.some((deck) => deck.player === "Eduardo Sajgalik"), true);

  let fetched = 0;
  const filled = await fillKeptBoards({
    wanted: [{ event: store.readEvent(WORLDS_ID)!, player: "Eduardo Sajgalik" }],
    readBoards: (id) => store.readBoards(id),
    fetchEvent: async () => {
      fetched++;
      return {
        ok: true,
        normalized: {
          event: worldsEvent([]),
          boards: { "Eduardo Sajgalik": draft("Forest") },
          droppedLists: 0,
        },
      };
    },
    emptyOn: {},
    today: "2026-11-19",
  });
  assert.equal(fetched, 0);
  const kept = filled.boards.get(WORLDS_ID)?.["Eduardo Sajgalik"]?.mainboard ?? [];
  assert.equal(kept.reduce((sum, card) => sum + card.count, 0), 60);
  assert.notEqual(kept[0]?.name, "Forest");
});

test("premier lookback is 14 days and an upgraded event is not fetched again", async () => {
  assert.equal(PREMIER_LOOKBACK_DAYS, 14);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-premier-window-"));
  const store = new FactStore(root);
  store.putEvent(worldsEvent([{ player: "Eduardo Sajgalik", archetype: "Izzet Mission", colorName: "Izzet", rank: 2 }], { premierLists: true, listSource: "magic.gg" }));
  const fetched: string[] = [];
  await importPremierEvents({
    store,
    now: () => NOW,
    sleep: async () => {},
    meleeDelayMs: 0,
    magicDelayMs: 0,
    fetch: async (url: string) => {
      fetched.push(url);
      if (url.endsWith("/robots.txt")) return { status: 200, text: "User-agent: *\nDisallow:\n" };
      if (url.endsWith("/decklists")) {
        return {
          status: 200,
          text: `<a href="/decklists/magic-world-championship-32-standard-decklists">Magic World Championship 32 November 13, 2026</a>
            <a href="/decklists/pro-tour-edge-of-eternities-decklists">Pro Tour Edge of Eternities November 10, 2026</a>`,
        };
      }
      if (url.includes("edge-of-eternities")) {
        return {
          status: 200,
          text: `<deck-list deck-title="Ada" subtitle="Domain" format="Modern" event-date="November 10, 2026" event-name="Pro Tour Edge of Eternities"><main-deck>${"4 Island\n".repeat(15)}</main-deck></deck-list>`,
        };
      }
      return { status: 404, text: "" };
    },
  });
  assert.equal(fetched.some((url) => url.includes("world-championship-32-standard-decklists")), false);
  assert.equal(fetched.some((url) => url.includes("edge-of-eternities")), true);

  const narrow: string[] = [];
  await importPremierEvents({
    days: 5,
    now: () => NOW,
    sleep: async () => {},
    meleeDelayMs: 0,
    magicDelayMs: 0,
    fetch: async (url: string) => {
      narrow.push(url);
      if (url.endsWith("/robots.txt")) return { status: 200, text: "User-agent: *\nDisallow:\n" };
      if (url.endsWith("/decklists")) {
        return { status: 200, text: `<a href="/decklists/magic-world-championship-32-standard-decklists">Magic World Championship 32 November 9, 2026</a>` };
      }
      return { status: 404, text: "" };
    },
  });
  assert.equal(narrow.some((url) => url.includes("world-championship-32-standard-decklists")), false);
});
