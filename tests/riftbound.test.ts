import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { anchorMs, computeSlice } from "../src/lib/facts/compute";
import { legendColorFor } from "../src/lib/riftbound/cards";
import { buildRiftboundSnapshot, sliceKey } from "../src/lib/riftbound/aggregate";
import { eraContains, loadEraFile, type EraDef } from "../src/lib/riftbound/eras";
import { fetchJsonPolite } from "../src/lib/riftbound/http";
import { chooseDeckPlayers, normalizeEvent, parseMatches, playRoundIds } from "../src/lib/riftbound/normalize";
import { decideRiftboundPublish } from "../src/lib/riftbound/publish-policy";
import { isConstructedSolo, sampleSkirmishes, selectIngestEvents, type ListedEvent } from "../src/lib/riftbound/select";
import { RiftboundStore } from "../src/lib/riftbound/store";
import type { RiftboundFactEvent } from "../src/lib/riftbound/types";
import { magicLegacyDestination, magicLegacyLocation, magicRedirects } from "../src/lib/routing";
import { slugify } from "../src/lib/slug";

const ANCHOR = Date.parse("2026-11-01T00:00:00.000Z");

function listed(partial: Partial<ListedEvent> & Pick<ListedEvent, "id" | "name">): ListedEvent {
  return {
    startDatetime: "2026-10-01T00:00:00.000Z",
    lifecycleStatus: "EVENT_FINISHED",
    source: "uvs",
    eventCategory: "regional",
    gameplayFormatName: "Constructed",
    eventFormat: "CONSTRUCTED",
    startingPlayerCount: 64,
    registeredUserCount: null,
    ...partial,
  };
}

function fact(partial: Partial<RiftboundFactEvent> & Pick<RiftboundFactEvent, "id" | "date" | "decks">): RiftboundFactEvent {
  return {
    schemaVersion: 1,
    boundriftId: 1,
    source: "uvs",
    name: partial.id,
    uri: null,
    category: "regional",
    format: "Constructed",
    playerCount: partial.decks.length,
    deckCount: partial.decks.length,
    matches: [],
    listsAbsent: false,
    ...partial,
  };
}

test("legend colors use the title when the standing name includes the champion", () => {
  const colors = new Map<string, string>([
    ["Blade Dancer", "Calm Chaos"],
    ["The Exile", "Calm Chaos"],
    ["Wuju Bladesman, Starter", "Calm Body"],
    ["Wuju Master", "Calm Body"],
    ["Agony’s Embrace", "Body Chaos"],
  ]);
  assert.equal(legendColorFor("Irelia, Blade Dancer", colors), "Calm Chaos");
  assert.equal(legendColorFor("Riven, The Exile", colors), "Calm Chaos");
  assert.equal(legendColorFor("Master Yi, Wuju Bladesman", colors), "Calm Body");
  assert.equal(legendColorFor("Evelynn, Agony's Embrace", colors), "Body Chaos");
});

test("legend slugs are stable and keep apostrophes from colliding", () => {
  assert.equal(slugify("Kai'Sa, Daughter of the Void"), "kai-sa-daughter-of-the-void");
  assert.equal(slugify("Kha'Zix, Voidreaver"), "kha-zix-voidreaver");
  assert.notEqual(slugify("Lee Sin"), slugify("Leesin"));
  assert.equal(slugify("Master Yi, Wuju Bladesman"), "master-yi-wuju-bladesman");
});

test("legacy Magic paths redirect permanently and keep the query string", () => {
  assert.equal(magicLegacyDestination("/modern"), "/magic/modern");
  assert.equal(magicLegacyDestination("/Modern/Domain-Zoo"), "/magic/modern/Domain-Zoo");
  assert.equal(magicLegacyDestination("/pauper/burn"), "/magic/pauper/burn");
  assert.equal(magicLegacyDestination("/riftbound"), null);
  assert.equal(magicLegacyDestination("/magic/modern"), null);
  assert.equal(magicLegacyDestination("/api/videos"), null);
  assert.equal(magicLegacyLocation("/modern/domain", "?window=14&source=paper"), "/magic/modern/domain?window=14&source=paper");
  const redirects = magicRedirects();
  assert.equal(redirects.length, 2);
  assert.ok(redirects.every((redirect) => redirect.permanent));
  assert.match(redirects[0].source, /modern/);
  assert.match(redirects[1].destination, /:archetype/);
});

test("era windows are inclusive at the start and exclusive at the next set", () => {
  const file = loadEraFile();
  const vendetta = file.eras.find((era) => era.id === "vendetta") as EraDef;
  const post = file.eras.find((era) => era.id === "vendetta-postban") as EraDef;
  const radiance = file.eras.find((era) => era.id === "radiance") as EraDef;
  assert.equal(eraContains(vendetta, "2026-09-01T12:00:00.000Z"), true);
  assert.equal(eraContains(post, "2026-09-01T12:00:00.000Z"), false);
  assert.equal(eraContains(vendetta, "2026-09-18T00:00:00.000Z"), true);
  assert.equal(eraContains(post, "2026-09-20T00:00:00.000Z"), true);
  assert.equal(eraContains(radiance, "2026-09-20T00:00:00.000Z"), false);
  assert.equal(eraContains(vendetta, "2026-10-23T00:00:00.000Z"), false);
  assert.equal(eraContains(radiance, "2026-10-23T00:00:00.000Z"), true);
  assert.ok(file.bans.some((ban) => ban.card === "Stacked Deck" && ban.date === "2026-09-18"));
  assert.ok(file.bans.some((ban) => ban.card === "Dreaming Tree"));
});

test("constructed solo selection drops team events and samples skirmishes", () => {
  assert.equal(isConstructedSolo(listed({ id: 1, name: "2v2 Team Challenge" })), false);
  assert.equal(isConstructedSolo(listed({ id: 2, name: "Regional Qualifier" })), true);
  const now = new Date("2026-11-11T00:00:00.000Z");
  const events = [
    listed({ id: 1, name: "RQ", eventCategory: "regional", startDatetime: "2026-10-01T00:00:00.000Z" }),
    listed({ id: 2, name: "2v2 Team", eventCategory: "other", startDatetime: "2026-10-02T00:00:00.000Z" }),
    listed({ id: 3, name: "City A", eventCategory: "skirmish", source: "loltcg", startingPlayerCount: 32, startDatetime: "2026-10-03T00:00:00.000Z" }),
    listed({ id: 4, name: "City B", eventCategory: "skirmish", source: "uvs", startingPlayerCount: 40, startDatetime: "2026-10-04T00:00:00.000Z" }),
    listed({ id: 5, name: "Tiny", eventCategory: "skirmish", startingPlayerCount: 4, startDatetime: "2026-10-05T00:00:00.000Z" }),
    listed({ id: 6, name: "Old", eventCategory: "regional", startDatetime: "2026-01-01T00:00:00.000Z" }),
  ];
  const selected = selectIngestEvents(events, { now, days: 90, minPlayers: 8, skirmishSample: 1 });
  assert.deepEqual(selected.map((event) => event.id).sort(), [1, 3]);
  assert.ok(selected.some((event) => event.id === 1));
  assert.equal(selected.filter((event) => event.eventCategory === "skirmish").length, 1);
  assert.equal(selected.some((event) => event.id === 2 || event.id === 5 || event.id === 6), false);
  const sample = sampleSkirmishes(
    [
      listed({ id: 10, name: "a", source: "uvs", eventCategory: "skirmish" }),
      listed({ id: 11, name: "b", source: "loltcg", eventCategory: "skirmish" }),
    ],
    2,
  );
  assert.deepEqual(sample.map((event) => event.source).sort(), ["loltcg", "uvs"]);
});

test("share counts Chinese decks and win rate ignores them, mirrors, and reports Wilson", () => {
  const pad = fact({
    id: "boundrift:pad",
    date: new Date(ANCHOR).toISOString(),
    decks: Array.from({ length: 25 }, (_, i) => ({
      player: `pad-${i}`,
      name: `Pad ${i}`,
      archetype: "Pad Legend",
      colorName: null,
      rank: null,
    })),
    deckCount: 25,
    playerCount: 25,
  });
  const chinese = fact({
    id: "boundrift:cn",
    source: "loltcg",
    date: new Date(ANCHOR - 86_400_000).toISOString(),
    decks: [
      { player: "c1", name: "C1", archetype: "Irelia, Blade Dancer", colorName: "Fury", rank: 1 },
      { player: "c2", name: "C2", archetype: "Irelia, Blade Dancer", colorName: "Fury", rank: 2 },
    ],
    matches: [{ player1: "c1", player2: "c2", winner: 1 }],
  });
  const table = fact({
    id: "boundrift:uvs",
    source: "uvs",
    date: new Date(ANCHOR - 2 * 86_400_000).toISOString(),
    playerCount: 4,
    decks: [
      { player: "a1", name: "A1", archetype: "Irelia, Blade Dancer", colorName: "Fury", rank: 1 },
      { player: "a2", name: "A2", archetype: "Irelia, Blade Dancer", colorName: "Fury", rank: 2 },
      { player: "b1", name: "B1", archetype: "Jinx, Rebel", colorName: "Chaos", rank: 3 },
      { player: "b2", name: "B2", archetype: "Jinx, Rebel", colorName: "Chaos", rank: 4 },
      { player: "b3", name: "B3", archetype: "Jinx, Rebel", colorName: "Chaos", rank: 5 },
    ],
    matches: [
      { player1: "a1", player2: "a2", winner: 1 },
      { player1: "a1", player2: "b1", winner: 1 },
      { player1: "a2", player2: "b2", winner: 0 },
    ],
  });
  const events = [pad, chinese, table];
  assert.equal(anchorMs(events), ANCHOR);
  const slice = computeSlice(events, ANCHOR, 30, "all", {
    includeDeck: () => true,
    includeMatch: (event) => event.source !== "loltcg",
  });
  const irelia = slice.rows.find((row) => row.archetype === "Irelia, Blade Dancer");
  const jinx = slice.rows.find((row) => row.archetype === "Jinx, Rebel");
  assert.equal(irelia?.deckCount, 4);
  assert.equal(jinx?.deckCount, 3);
  assert.equal(slice.totalDecks, 4 + 3 + 25);
  assert.equal(irelia?.matchWins, 1);
  assert.equal(irelia?.matchLosses, 0);
  assert.equal(irelia?.matchDraws, 1);
  assert.equal(irelia?.winRate, 1);
  const cell = slice.matchups.find((matchup) => matchup.archetypeA === "Irelia, Blade Dancer" && matchup.archetypeB === "Jinx, Rebel");
  assert.ok(cell);
  assert.equal(cell.winsA, 1);
  assert.equal(cell.winsB, 0);
  assert.equal(cell.draws, 1);
  const z = 1.96;
  const n = 1;
  const p = 1;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const low = Math.max(0, (center - margin) / denom);
  const high = Math.min(1, (center + margin) / denom);
  assert.ok(Math.abs(cell.ciLow - low) < 1e-12);
  assert.ok(Math.abs(cell.ciHigh - high) < 1e-12);

  const vendetta: EraDef = { id: "vendetta", name: "Vendetta", start: "2026-07-31", end: "2026-10-23" };
  const inside = fact({
    id: "boundrift:inside",
    date: "2026-09-10T00:00:00.000Z",
    decks: [
      { player: "j1", name: "J1", archetype: "Jinx, Rebel", colorName: null, rank: 1 },
      { player: "j2", name: "J2", archetype: "Jinx, Rebel", colorName: null, rank: 2 },
    ],
  });
  const outside = fact({
    id: "boundrift:radiance",
    date: "2026-10-25T00:00:00.000Z",
    decks: [{ player: "r1", name: "R", archetype: "Jinx, Rebel", colorName: null, rank: 1 }],
  });
  const filtered = computeSlice([inside, outside], Date.parse("2026-09-15T00:00:00.000Z"), 365, "all", {
    includeDeck: (event) => eraContains(vendetta, event.date),
    includeMatch: (event) => event.source !== "loltcg" && eraContains(vendetta, event.date),
  });
  assert.equal(filtered.rows.find((row) => row.archetype === "Jinx, Rebel")?.deckCount, 2);
  assert.equal(eraContains(vendetta, outside.date), false);
  assert.equal(eraContains(vendetta, inside.date), true);
});

test("normalize keeps zones, drops byes, and drops Chinese matches", () => {
  const detail = {
    id: 7,
    name: "City Challenge",
    source: "loltcg",
    gameplayFormatName: "Constructed",
    eventFormat: null,
    eventCategory: "skirmish",
    lifecycleStatus: "EVENT_FINISHED",
    startDatetime: "2026-10-01T00:00:00.000Z",
    startingPlayerCount: 16,
    rounds: [{ id: 1, roundType: "SWISS", status: "COMPLETE" }],
  };
  const standings = {
    standings: [
      { rank: 1, playerId: 9, username: "Ada", legendName: "Irelia, Blade Dancer", hasDeck: true },
      { rank: 2, playerId: 8, username: "Bea", legendName: null, hasDeck: false },
    ],
  };
  const deck = {
    shareSlug: "abc",
    sections: [
      { type: "legend", cards: [{ name: "Irelia", quantity: 1 }] },
      { type: "champion", cards: [] },
      { type: "battlefield", cards: [] },
      { type: "main", cards: [{ name: "Blade", quantity: 3 }] },
      { type: "rune_pool", cards: [{ name: "Fury Rune", quantity: 12 }] },
      { type: "sideboard", cards: [{ name: "Spell", quantity: 2 }] },
      { type: "considering", cards: [{ name: "Nope", quantity: 1 }] },
    ],
  };
  const normalized = normalizeEvent({
    detail,
    standings,
    matchBodies: [{ matches: [{ player1Id: 9, player2Id: 8, winningPlayerId: 9, isBye: false }] }],
    decks: { "9": deck },
    minPlayers: 8,
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.event.matches.length, 0);
  assert.equal(normalized.event.decks.length, 1);
  assert.equal(normalized.event.listsAbsent, false);
  assert.deepEqual(normalized.boards["9"].runePool, [{ name: "Fury Rune", count: 12 }]);
  assert.equal(normalized.boards["9"].champion.length, 0);
  assert.equal(normalized.boards["9"].anchorUri, "https://boundrift.com/d/abc");
  const bye = parseMatches(
    { matches: [{ player1Id: 1, player2Id: 2, isBye: true, winningPlayerId: 1 }, { player1Id: 1, player2Id: 3, winningPlayerId: 3, isBye: false }] },
    true,
  );
  assert.equal(bye.ok, true);
  if (bye.ok) {
    assert.equal(bye.matches.length, 1);
    assert.equal(bye.matches[0].winner, 2);
  }
  assert.deepEqual(playRoundIds([
    { id: 1, roundType: "PLAY_VS_OPPONENT", status: "COMPLETE" },
    { id: 2, roundType: "SWISS", status: "COMPLETE" },
    { id: 3, roundType: "DRAFT", status: "COMPLETE" },
  ]), [1]);
  assert.deepEqual(playRoundIds([
    { id: -10, roundType: "SWISS", status: "COMPLETE" },
    { id: -11, roundType: "SINGLE_ELIMINATION", status: "COMPLETE" },
    { id: -12, roundType: "SWISS", status: "PENDING" },
  ]), [-10, -11]);

  assert.deepEqual(
    chooseDeckPlayers(
      [
        { player: "a", rank: 2, legend: "Jinx", hasDeck: true },
        { player: "b", rank: 1, legend: "Jinx", hasDeck: true },
        { player: "c", rank: 3, legend: "Irelia", hasDeck: true },
        { player: "d", rank: 4, legend: "Irelia", hasDeck: false },
      ],
      2,
    ),
    ["b", "c"],
  );
});

test("rate limit honors Retry-After and a partial event does not block publish", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: "abc" } });
  };
  const result = await fetchJsonPolite("https://boundrift.com/api/events/1", {
    fetchImpl,
    sleep: async () => {},
    maxAttempts: 3,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  if (result.ok && result.status === 200) assert.equal(result.etag, "abc");

  const held = decideRiftboundPublish({
    listingAvailable: false,
    shapeFailures: 0,
    attemptedFetches: 0,
    ingestedThisRun: 0,
    storedEvents: 3,
    networkFailures: 0,
  });
  assert.equal(held.publish, false);
  assert.equal(held.structural, true);

  const shape = decideRiftboundPublish({
    listingAvailable: true,
    shapeFailures: 4,
    attemptedFetches: 4,
    ingestedThisRun: 0,
    storedEvents: 2,
    networkFailures: 0,
  });
  assert.equal(shape.publish, false);

  const partial = decideRiftboundPublish({
    listingAvailable: true,
    shapeFailures: 0,
    attemptedFetches: 5,
    ingestedThisRun: 4,
    storedEvents: 1,
    networkFailures: 1,
  });
  assert.equal(partial.publish, true);
  assert.match(partial.reason, /partial/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "riftbound-publish-"));
  const store = new RiftboundStore(root);
  const event = fact({
    id: "boundrift:1",
    boundriftId: 1,
    date: "2026-10-01T00:00:00.000Z",
    decks: [{ player: "1", name: "Ada", archetype: "Irelia, Blade Dancer", colorName: "Fury", rank: 1 }],
  });
  store.putEvent(event);
  const body = buildRiftboundSnapshot([event], new Map(), {
    videos: [],
    banEvents: [{ date: "2026-09-18", card: "Stacked Deck", kind: "card" }],
    cards: {},
    eras: loadEraFile().eras,
  });
  const decision = decideRiftboundPublish({
    listingAvailable: true,
    shapeFailures: 0,
    attemptedFetches: 2,
    ingestedThisRun: 1,
    storedEvents: 0,
    networkFailures: 1,
  });
  assert.equal(decision.publish, true);
  store.writeSnapshot({ ...body, coverage: { complete: false, requestedDays: 90, discovered: 2, ingested: 1, failed: 1, unattempted: 0, boundrift: "partial", playriftboundEvents: 0, playriftboundWithoutLists: 0 } }, "2026-11-11T00:00:00.000Z");
  const snap = store.readSnapshot();
  assert.equal(snap?.status, "ok");
  assert.equal(snap?.game, "riftbound");
  assert.ok(snap?.slices[sliceKey(30, "all", "all")].rows.some((row) => row.archetype === "Irelia, Blade Dancer"));
  const before = fs.readFileSync(store.snapshotFile);
  const refused = decideRiftboundPublish({
    listingAvailable: false,
    shapeFailures: 0,
    attemptedFetches: 0,
    ingestedThisRun: 0,
    storedEvents: 1,
    networkFailures: 0,
  });
  if (refused.publish) store.writeSnapshot({ ...body, eventCount: 99 }, "2026-11-12T00:00:00.000Z");
  assert.equal(refused.publish, false);
  assert.deepEqual(fs.readFileSync(store.snapshotFile), before);
});
