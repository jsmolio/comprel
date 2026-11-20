import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeCacheItem } from "../src/lib/facts/normalize";
import { FactStore } from "../src/lib/facts/store";
import { importPremierEvents, type FetchInit } from "../src/lib/sources/premier";
import {
  constructedRounds,
  createPremierDraftLookup,
  draftRoundNumbers,
  incomingIsFuller,
  isDraftRound,
  isLimitedRoundLabel,
  parseMagicDecklists,
  parseMagicResultRow,
  parseMagicStandings,
  parseMeleeMatchPage,
  parseMeleeTournament,
  parseRobots,
  parseSchedulePhases,
  premierKey,
  robotsAllow,
  selectConstructedCache,
} from "../src/lib/sources/premier-parse";
import { detectFormat } from "../src/lib/format";
import { topFinishes } from "../src/lib/tournaments/select";
import { selectMagicEvents } from "../src/lib/tournaments/magic";
import { FORMATS } from "../src/lib/types";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const WORLDS_SHEET = `
Friday: Three (3) rounds of Magic: The Gathering | Star Trek Booster Draft, followed by four (4) rounds of Standard Constructed
Saturday: Three (3) rounds of Magic: The Gathering | Star Trek Booster Draft, followed by four (4) rounds of Standard Constructed
Fourteen (14) Swiss rounds total.
`;

test("worlds schedule marks rounds 1-3 and 8-10 as draft, not the Pro Tour set", () => {
  const phases = parseSchedulePhases(WORLDS_SHEET);
  const draft = draftRoundNumbers(phases);
  assert.deepEqual([...draft].sort((a, b) => a - b), [1, 2, 3, 8, 9, 10]);
  const proTour = new Set([1, 2, 3, 9, 10, 11]);
  assert.equal(draft.has(8), true);
  assert.equal(draft.has(11), false);
  assert.notDeepEqual([...draft].sort((a, b) => a - b), [...proTour].sort((a, b) => a - b));
});

test("a format label overrides the schedule when they disagree", () => {
  const draft = new Set([1, 2, 3, 8, 9, 10]);
  assert.equal(isDraftRound({ name: "Round 8", number: 8, format: "Draft" }, draft), true);
  assert.equal(isDraftRound({ name: "Round 8", number: 8, format: "Standard" }, draft), false);
  assert.equal(isDraftRound({ name: "Round 11", number: 11, format: null }, draft), false);
  assert.equal(isDraftRound({ name: "Round 8", number: 8, format: null }, draft), true);
  assert.equal(isDraftRound({ name: "Draft Round 1", number: null, format: null }, null), true);
  const kept = constructedRounds(
    [
      { name: "Round 8", number: 8, format: "Draft", matches: [{ Player1: "A", Player2: "B", Result: "2-0-0" }] },
      { name: "Round 11", number: 11, format: "Standard", matches: [{ Player1: "A", Player2: "C", Result: "2-1-0" }] },
      { name: "Finals", number: null, format: "Standard", matches: [{ Player1: "A", Player2: "D", Result: "3-1-0" }] },
    ],
    draft,
  );
  assert.deepEqual(kept.map((round) => round.name), ["Round 11", "Finals"]);
});

test("magic.gg deck lists, standings, and result rows keep player names aligned", () => {
  const html = `
    <deck-list deck-title="Schütz, Stefan" subtitle="Izzet Mission" event-date="November 13, 2026" event-name="World Championship 32" format="Standard">
      <main-deck>
      4 Lightning Bolt
      6 Island
      </main-deck>
      <side-board>
      2 Spell Pierce
      1 Annul
      </side-board>
    </deck-list>`;
  const [deck] = parseMagicDecklists(html);
  assert.equal(deck?.player, "Stefan Schütz");
  assert.equal(deck?.eventDay, "2026-11-13");
  assert.equal(deck?.mainboard[0]?.CardName, "Lightning Bolt");
  assert.equal(deck?.sideboard.length, 2);

  const home = parseMagicResultRow("Bejarano Espejo, Julio", "Kans, Alex", "Kans, Alexander won 2-0-0");
  assert.equal(home?.player, "Julio Bejarano Espejo");
  assert.equal(home?.opponent, "Alex Kans");
  assert.equal(home?.result, "0-2-0");
  const away = parseMagicResultRow("Courson, Dawson", "Kominowski, Maxx", "Courson, Dawson won 2-1-0");
  assert.equal(away?.result, "2-1-0");

  const standings = parseMagicStandings(`<table><tr><th>Rank</th><th>Points</th><th>First Name</th><th>Last Name</th></tr>
    <tr><td>1</td><td>33</td><td>Stefan</td><td>Schütz</td></tr></table>`);
  assert.deepEqual(standings, [{ rank: 1, player: "Stefan Schütz", points: 33 }]);
});

test("melee match pages expose the round format and public tournament page stays allowed", () => {
  const page = parseMeleeTournament(`
    <input id="tournament-id" value="471980" />
    <h3><i class="fa"></i>World Championship 32 in Atlanta, USA</h3>
    <span data-value="2026-11-13T14:00:00.0000000Z"></span>
    <button data-name="Round 8" data-id="1678037" data-is-completed="True">Round 8</button>
    <button data-id="1678037" data-name="Round 8">Round 8</button>`);
  assert.equal(page.id, 471980);
  assert.equal(page.name, "World Championship 32 in Atlanta, USA");
  assert.equal(page.rounds.length, 1);
  assert.equal(page.date, "2026-11-13T14:00:00.000Z");

  const round = parseMeleeMatchPage(
    {
      data: [
        {
          Format: "Draft",
          RoundNumber: 8,
          RoundDescription: "Round 8",
          GameDraws: 0,
          Competitors: [
            { SortOrder: 0, GameWins: 2, Team: { Players: [{ DisplayName: "Stefan Schütz" }] } },
            { SortOrder: 1, GameWins: 0, Team: { Players: [{ DisplayName: "Abe Schnake" }] } },
          ],
        },
      ],
    },
    "Round 8",
  );
  assert.equal(round?.format, "Draft");
  assert.equal(round?.matches[0]?.Result, "2-0-0");

  const robots = parseRobots("User-agent: *\nCrawl-delay: 5\nDisallow: /Decklist/View/\nDisallow: /Scripts/\n");
  assert.equal(robots.crawlDelaySec, 5);
  assert.equal(robotsAllow(robots.disallowed, "https://melee.gg/Decklist/View/abc"), false);
  assert.equal(robotsAllow(robots.disallowed, "https://melee.gg/Tournament/View/471980"), true);
  assert.equal(robotsAllow(robots.disallowed, "https://melee.gg/Match/GetRoundMatches/1678033"), true);
});

test("the fuller premier bundle wins ties only when it identified draft rounds", () => {
  const stored = { lists: 10, sideboards: 40, matches: 12, ranks: 10, draftIdentified: false };
  const same = { ...stored, draftIdentified: true, matches: 8 };
  assert.equal(incomingIsFuller(same, stored), true);
  assert.equal(incomingIsFuller({ ...stored }, stored), false);
  assert.equal(incomingIsFuller({ ...stored, sideboards: 39, draftIdentified: true }, stored), false);
});

test("cache and premier copies of Worlds collapse, and draft rounds stay out of the matches", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-premier-"));
  const store = new FactStore(root);
  const cacheId = "melee.gg:world-championship-32-in-atlanta-usa-standard-471980-2026-11-13";
  store.putEvent({
    schemaVersion: 1,
    classifierVersion: "cache",
    id: cacheId,
    source: "melee.gg",
    name: "World Championship 32 in Atlanta, USA",
    date: "2026-11-13T14:00:00.000Z",
    format: "Standard",
    uri: "https://melee.gg/Tournament/View/471980",
    sourcePath: "Tournaments/MTGmelee/2026/11/13/world-championship-32-in-atlanta-usa-standard-471980-2026-11-13.json",
    deckCount: 2,
    decks: [
      { player: "Stefan Schütz", archetype: "Izzet Unknown", colorName: "Izzet", rank: 1 },
      { player: "Abe Schnake", archetype: "Jund", colorName: "Jund", rank: 8 },
    ],
    matches: [
      { player1: "Stefan Schütz", player2: "Draft Ghost", winner: 1 },
      { player1: "Stefan Schütz", player2: "Abe Schnake", winner: 1 },
    ],
  });
  store.writeBoards(cacheId, {
    "Stefan Schütz": { result: "1st Place", anchorUri: null, mainboard: [{ name: "Island", count: 6 }], sideboard: [] },
    "Abe Schnake": { result: "8th Place", anchorUri: null, mainboard: [{ name: "Swamp", count: 4 }], sideboard: [{ name: "Duress", count: 2 }] },
  });
  store.putEvent({
    schemaVersion: 1,
    classifierVersion: "early",
    id: "magic.gg:magic-world-championship-32",
    source: "magic.gg",
    name: "World Championship 32",
    date: "2026-11-13T12:00:00.000Z",
    format: "Standard",
    uri: null,
    sourcePath: null,
    deckCount: 1,
    decks: [{ player: "Stefan Schütz", archetype: "Izzet", colorName: "Izzet", rank: 1 }],
    matches: [],
  });

  const pages = new Map<string, string>([
    ["https://magic.gg/robots.txt", "User-agent: *\nDisallow:\n"],
    ["https://melee.gg/robots.txt", "User-agent: *\nCrawl-delay: 5\nDisallow: /Decklist/View/\n"],
    [
      "https://magic.gg/decklists",
      `<a href="/decklists/magic-world-championship-32-standard-decklists-a-l">Magic World Championship 32 Standard Decklists November 13, 2026</a>`,
    ],
    [
      "https://magic.gg/decklists/magic-world-championship-32-standard-decklists-a-l",
      `<deck-list deck-title="Stefan Schütz" format="Standard" event-date="November 13, 2026" event-name="World Championship 32">
        <main-deck>${Array.from({ length: 15 }, () => "4 Island").join("\n")}</main-deck><side-board>3 Spell Pierce\n2 Annul</side-board></deck-list>
        <deck-list deck-title="Abe Schnake" format="Standard" event-date="November 13, 2026" event-name="World Championship 32">
        <main-deck>${Array.from({ length: 15 }, () => "4 Swamp").join("\n")}</main-deck><side-board>1 Duress</side-board></deck-list>
        <a href="/events/magic-world-championship-32">event</a>
        <a href="/news/world-championship-32-fact-sheet-for-competitors">sheet</a>
        <a href="https://magic.gg/news/magic-world-championship-32-final-standings">standings</a>`,
    ],
    ["https://magic.gg/events/magic-world-championship-32", `<title>Magic World Championship 32</title>`],
    ["https://magic.gg/news/world-championship-32-fact-sheet-for-competitors", WORLDS_SHEET],
    [
      "https://magic.gg/news/magic-world-championship-32-final-standings",
      `<table><tr><td>Rank</td><td>Points</td><td>First Name</td><td>Last Name</td></tr>
        <tr><td>1</td><td>33</td><td>Stefan</td><td>Schütz</td></tr>
        <tr><td>8</td><td>30</td><td>Abe</td><td>Schnake</td></tr></table>`,
    ],
    [
      "https://melee.gg/Tournament/View/471980",
      `<input id="tournament-id" value="471980" />
       <h3><i></i>World Championship 32 in Atlanta, USA</h3>
       <button data-id="4" data-name="Round 4"></button>
       <button data-id="8" data-name="Round 8"></button>
       <button data-id="17" data-name="Finals"></button>`,
    ],
  ]);
  const matches = new Map<string, unknown>([
    [
      "https://melee.gg/Match/GetRoundMatches/4",
      {
        data: [
          {
            Format: "Standard",
            RoundNumber: 4,
            RoundDescription: "Round 4",
            GameDraws: 0,
            Competitors: [
              { SortOrder: 0, GameWins: 2, Team: { Players: [{ DisplayName: "Stefan Schütz" }] } },
              { SortOrder: 1, GameWins: 1, Team: { Players: [{ DisplayName: "Abe Schnake" }] } },
            ],
          },
        ],
      },
    ],
    [
      "https://melee.gg/Match/GetRoundMatches/8",
      {
        data: [
          {
            Format: "Draft",
            RoundNumber: 8,
            RoundDescription: "Round 8",
            GameDraws: 0,
            Competitors: [
              { SortOrder: 0, GameWins: 2, Team: { Players: [{ DisplayName: "Stefan Schütz" }] } },
              { SortOrder: 1, GameWins: 0, Team: { Players: [{ DisplayName: "Draft Ghost" }] } },
            ],
          },
        ],
      },
    ],
    [
      "https://melee.gg/Match/GetRoundMatches/17",
      {
        data: [
          {
            Format: "Standard",
            RoundNumber: 17,
            RoundDescription: "Finals",
            GameDraws: 0,
            Competitors: [
              { SortOrder: 0, GameWins: 3, Team: { Players: [{ DisplayName: "Stefan Schütz" }] } },
              { SortOrder: 1, GameWins: 1, Team: { Players: [{ DisplayName: "Abe Schnake" }] } },
            ],
          },
        ],
      },
    ],
  ]);

  const result = await importPremierEvents({
    store,
    days: 5,
    now: () => NOW,
    sleep: async () => {},
    meleeDelayMs: 0,
    magicDelayMs: 0,
    fetch: async (url: string, _init: FetchInit) => {
      if (matches.has(url)) return { status: 200, text: JSON.stringify(matches.get(url)) };
      const text = pages.get(url);
      if (!text) return { status: 404, text: "" };
      return { status: 200, text };
    },
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.id, cacheId);
  assert.equal(result.events[0]?.kept, "incoming");
  assert.deepEqual(result.events[0]?.draftRounds, [8]);
  assert.equal(store.readEvent("magic.gg:magic-world-championship-32"), null);
  const saved = store.readEvent(cacheId);
  assert.ok(saved);
  assert.equal(saved?.decks.length, 2);
  assert.deepEqual(
    saved?.matches.map((match) => `${match.player1} vs ${match.player2}`),
    ["Stefan Schütz vs Abe Schnake", "Stefan Schütz vs Abe Schnake"],
  );
  assert.equal(saved?.matches.some((match) => match.player2 === "Draft Ghost"), false);
  const boards = store.readBoards(cacheId);
  assert.equal(boards?.["Stefan Schütz"]?.sideboard.length, 2);
  assert.equal(saved?.decks.find((deck) => deck.player === "Stefan Schütz")?.rank, 1);

  const selected = selectMagicEvents([saved!]);
  assert.equal(selected.length, 1);
  const finishes = topFinishes(
    saved!.decks.map((deck) => ({
      player: deck.player,
      archetype: deck.archetype,
      rank: deck.rank,
      result: boards?.[deck.player]?.result ?? null,
      hasList: true,
    })),
  );
  assert.equal(finishes[0]?.player, "Stefan Schütz");
});

test("a premier source failure is a miss and does not throw", async () => {
  const result = await importPremierEvents({
    days: 5,
    now: () => NOW,
    sleep: async () => {},
    meleeDelayMs: 0,
    magicDelayMs: 0,
    fetch: async () => {
      throw new Error("magic.gg down");
    },
  });
  assert.equal(result.events.length, 0);
  assert.ok(result.misses.some((miss) => miss.reason === "network" || miss.reason === "exception"));
});

test("named draft rounds are dropped on the cache path without using Pro Tour numbers", () => {
  const normalized = normalizeCacheItem(
    "melee.gg",
    "pro-tour-sample",
    {
      Tournament: { Name: "Pro Tour Sample", Date: "2026-05-01T16:00:00.000Z", Formats: "Standard" },
      Decks: [{ Player: "Ada", Result: "1st Place", Mainboard: [{ Count: 4, CardName: "Lightning Bolt" }], Sideboard: [] }],
      Rounds: [
        { RoundName: "Draft Round 1", Matches: [{ Player1: "Ada", Player2: "Bea", Result: "2-1-0" }] },
        { RoundName: "Round 9", Matches: [{ Player1: "Ada", Player2: "Cy", Result: "2-0-0" }] },
        { RoundName: "Round 4", Matches: [{ Player1: "Ada", Player2: "Dee", Result: "2-1-0" }] },
      ],
    },
    new Set(FORMATS),
    "test",
    null,
  );
  assert.deepEqual(
    normalized?.event.matches.map((match) => match.player2),
    ["Cy", "Dee"],
  );
});

function copies(name: string, count: number) {
  return Array.from({ length: count }, () => ({ Count: 1, CardName: name }));
}

test("Unlimited is not limited, and a constructed main under 60 cards is dropped", () => {
  assert.equal(isLimitedRoundLabel("Unlimited"), false);
  assert.equal(isLimitedRoundLabel("Vintage Unlimited"), false);
  assert.equal(isLimitedRoundLabel("Unlimited Round 1"), false);
  assert.equal(isLimitedRoundLabel("Limited"), true);
  assert.equal(isLimitedRoundLabel("Booster Draft"), true);
  assert.equal(detectFormat("Vintage Unlimited"), "Vintage");
  assert.equal(detectFormat("Unlimited"), null);

  const selected = selectConstructedCache(
    {
      Tournament: { Name: "Vintage Unlimited", Date: "2026-11-01T00:00:00.000Z", Formats: "Vintage" },
      Decks: [
        { Player: "Ada", Mainboard: copies("Island", 40), Sideboard: [] },
        { Player: "Bea", Mainboard: copies("Island", 60), Sideboard: [] },
        { Player: "Cy", Mainboard: copies("Island", 61), Sideboard: [] },
      ],
      Rounds: [
        { RoundName: "Unlimited Round 1", Matches: [{ Player1: "Bea", Player2: "Cy", Result: "2-0-0" }] },
        { RoundName: "Draft Round 1", Matches: [{ Player1: "Bea", Player2: "Ada", Result: "2-1-0" }] },
      ],
    },
  );
  assert.equal(selected.droppedLists, 1);
  assert.deepEqual(selected.decks.map((deck) => deck.Player), ["Bea", "Cy"]);
  assert.deepEqual(selected.rounds.map((round) => round.RoundName), ["Unlimited Round 1"]);
});

test("a cache premier event drops draft lists and schedule draft rounds, including Worlds round 8", () => {
  const normalized = normalizeCacheItem(
    "melee.gg",
    "world-championship-32-in-atlanta-usa-standard-471980-2026-11-13",
    {
      Tournament: {
        Name: "World Championship 32 in Atlanta, USA",
        Date: "2026-11-13T14:00:00.000Z",
        Formats: "Standard",
        Uri: "https://melee.gg/Tournament/View/471980",
        Schedule: WORLDS_SHEET,
      },
      Decks: [
        { Player: "Stefan Schütz", Result: "1st Place", Mainboard: copies("Island", 40), Sideboard: [] },
        {
          Player: "James Drake",
          Result: "4th Place",
          Mainboard: [...copies("Temple Garden", 4), ...copies("Forest", 28), ...copies("Llanowar Elves", 4), ...copies("Plains", 24)],
          Sideboard: copies("Seam Rip", 2),
        },
      ],
      Standings: [
        { Rank: 1, Player: "Stefan Schütz", Points: 33, Wins: 13, Losses: 3, Draws: 0, OMWP: 0, GWP: 0, OGWP: 0 },
        { Rank: 4, Player: "James Drake", Points: 30, Wins: 11, Losses: 5, Draws: 0, OMWP: 0, GWP: 0, OGWP: 0 },
      ],
      Rounds: [
        { RoundName: "Round 8", Matches: [{ Player1: "Stefan Schütz", Player2: "James Drake", Result: "2-0-0" }] },
        { RoundName: "Round 12", Matches: [{ Player1: "James Drake", Player2: "Abe Schnake", Result: "2-1-0" }] },
        { RoundName: "Round 4", Format: "Standard", Matches: [{ Player1: "James Drake", Player2: "Abe Schnake", Result: "2-0-0" }] },
      ],
    },
    new Set(FORMATS),
    "test",
    null,
  );
  assert.equal(normalized?.droppedLists, 1);
  assert.deepEqual(normalized?.event.decks.map((deck) => deck.player), ["James Drake"]);
  assert.equal(normalized?.event.deckCount, 1);
  assert.equal(normalized?.boards["Stefan Schütz"], undefined);
  assert.equal(normalized?.boards["James Drake"]?.mainboard.reduce((sum, card) => sum + card.count, 0), 60);
  assert.deepEqual(
    normalized?.event.matches.map((match) => match.player2),
    ["Abe Schnake", "Abe Schnake"],
  );
  assert.equal(normalized?.event.matches.some((match) => match.player1 === "Stefan Schütz"), false);
});

test("a format label still overrides the schedule, and a missing schedule does not invent Pro Tour rounds", () => {
  const item = {
    Tournament: { Name: "Pro Tour Sample", Date: "2026-05-01T16:00:00.000Z", Formats: "Standard", Schedule: WORLDS_SHEET },
    Decks: [{ Player: "Ada", Result: "1st Place", Mainboard: copies("Island", 60), Sideboard: [] }],
    Rounds: [
      { RoundName: "Round 8", Format: "Standard", Matches: [{ Player1: "Ada", Player2: "Bea", Result: "2-0-0" }] },
      { RoundName: "Round 11", Matches: [{ Player1: "Ada", Player2: "Cy", Result: "2-1-0" }] },
    ],
  };
  const kept = selectConstructedCache(item);
  assert.deepEqual(kept.rounds.map((round) => round.RoundName), ["Round 8", "Round 11"]);
  const unnamed = selectConstructedCache({ ...item, Tournament: { ...item.Tournament, Schedule: null }, Rounds: [
    { RoundName: "Round 8", Matches: [{ Player1: "Ada", Player2: "Bea", Result: "2-0-0" }] },
    { RoundName: "Round 9", Matches: [{ Player1: "Ada", Player2: "Cy", Result: "2-0-0" }] },
  ]});
  assert.deepEqual(unnamed.rounds.map((round) => round.RoundName), ["Round 8", "Round 9"]);
});

test("premier schedule lookup reads this event's fact sheet and does not use another event", async () => {
  const lookup = createPremierDraftLookup(async (url) => {
    if (url === "https://magic.gg/decklists") {
      return `<a href="/decklists/magic-world-championship-32-standard-decklists-a-l">Magic World Championship 32</a>
        <a href="/decklists/pro-tour-edge-of-eternities-decklists">Pro Tour Edge of Eternities</a>`;
    }
    if (url.endsWith("magic-world-championship-32-standard-decklists-a-l")) {
      return `<a href="/events/magic-world-championship-32">event</a>`;
    }
    if (url.endsWith("/events/magic-world-championship-32")) {
      return `<a href="/news/world-championship-32-fact-sheet-for-competitors">sheet</a>`;
    }
    if (url.endsWith("world-championship-32-fact-sheet-for-competitors")) return WORLDS_SHEET;
    if (url.endsWith("pro-tour-edge-of-eternities-decklists")) {
      return `<a href="/news/pro-tour-edge-of-eternities-fact-sheet">sheet</a>`;
    }
    if (url.endsWith("pro-tour-edge-of-eternities-fact-sheet")) {
      return "Three (3) rounds of Booster Draft, followed by five (5) rounds of Modern Constructed";
    }
    return null;
  });
  const worlds = await lookup("World Championship 32 in Atlanta, USA");
  assert.deepEqual([...(worlds ?? [])].sort((a, b) => a - b), [1, 2, 3, 8, 9, 10]);
  const other = await lookup("Pro Tour Edge of Eternities");
  assert.equal(other?.has(8), false);
  assert.equal(other?.has(1), true);
  assert.equal(await lookup("Friday Night Standard"), null);
});

test("premier misses are recorded for the ingest summary and not described as a site banner", () => {
  const backfill = fs.readFileSync("scripts/backfill.ts", "utf8");
  assert.match(backfill, /importPremierEvents/);
  assert.match(backfill, /Premier misses/);
  assert.match(backfill, /Premier unattempted/);
  assert.match(backfill, /Dropped short lists/);
  assert.match(backfill, /Unmatched names/);
  assert.match(backfill, /PREMIER_LOOKBACK_DAYS/);
  assert.match(backfill, /shortListStatus/);
  assert.doesNotMatch(backfill, /coverage\.dropped|droppedLists:/);
  const app = fs.readFileSync("src/app/magic/page.tsx", "utf8");
  assert.doesNotMatch(app, /premier/i);
  assert.doesNotMatch(app, /short-list|under 60|unmatched-name/);
  const layout = fs.readFileSync("src/app/magic/layout.tsx", "utf8");
  assert.doesNotMatch(layout, /short-list|under 60|droppedLists|unmatched-name/);
  const coverage = fs.readFileSync("src/lib/facts/types.ts", "utf8");
  assert.doesNotMatch(coverage, /droppedLists|short-list/);
  assert.equal(premierKey("World Championship 32 in Atlanta, USA"), "worlds:32");
  assert.equal(premierKey("https://magic.gg/decklists/magic-world-championship-32-standard-decklists-a-l"), "worlds:32");
});
