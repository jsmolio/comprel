import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { anchorMs } from "../src/lib/facts/compute";
import { classifyFetched } from "../src/lib/facts/classify-guard";
import { DAY_MS, historyCutoffMs } from "../src/lib/facts/horizon";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore, stableStringify } from "../src/lib/facts/store";
import type { SnapshotCoverage } from "../src/lib/facts/types";
import type { FactEvent } from "../src/lib/facts/types";
import { buildSnapshotBody } from "../src/lib/facts/compute";

const ANCHOR = Date.parse("2026-11-01T00:00:00.000Z");

function event(id: string, dateMs: number, archetype = "Domain"): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "v1",
    id,
    source: "melee.gg",
    name: id,
    date: new Date(dateMs).toISOString(),
    format: "Modern",
    uri: null,
    sourcePath: `Tournaments/MTGmelee/2026/11/01/${id}.json`,
    deckCount: 1,
    decks: [{ player: "p", archetype, colorName: null, rank: 1 }],
    matches: [],
  };
}

test("event writes are idempotent and a revision replaces the same id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-facts-"));
  const store = new FactStore(root);
  const original = event("melee.gg:open", ANCHOR);
  assert.equal(store.putEvent(original).changed, true);
  assert.equal(store.putEvent(original).changed, false);
  const revised = {
    ...original,
    matches: [{ player1: "p", player2: "q", winner: 1 as const }],
    decks: [
      original.decks[0],
      { player: "q", archetype: "Tron", colorName: null, rank: 2 },
    ],
    deckCount: 2,
  };
  assert.equal(store.putEvent(revised).changed, true);
  const read = store.readEvent(original.id);
  assert.equal(read?.deckCount, 2);
  assert.equal(read?.matches[0]?.winner, 1);
  const indexDir = path.join(store.factDir, "index");
  const entries = fs.readdirSync(indexDir).flatMap((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(indexDir, name), "utf8")) as { events: Record<string, unknown> };
    return Object.keys(json.events);
  });
  assert.deepEqual(entries, [original.id]);
});

test("horizon prune keeps the previous 365-day window and drops older facts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-prune-"));
  const store = new FactStore(root);
  const anchorDecks = Array.from({ length: 25 }, (_, i) => ({
    player: `a${i}`,
    archetype: "Energy",
    colorName: null,
    rank: null,
  }));
  const anchorEvent: FactEvent = {
    ...event("melee.gg:anchor", ANCHOR),
    decks: anchorDecks,
    deckCount: 25,
  };
  const edge = event("melee.gg:edge", ANCHOR - 730 * DAY_MS);
  const slackEdge = event("melee.gg:slack", historyCutoffMs(ANCHOR));
  const tooOld = event("melee.gg:old", historyCutoffMs(ANCHOR) - 1);
  for (const item of [anchorEvent, edge, slackEdge, tooOld]) store.putEvent(item);
  const before = store.allEvents();
  assert.equal(anchorMs(before), ANCHOR);
  const { deleted } = store.pruneToHorizon(before);
  assert.deepEqual(deleted, ["melee.gg:old"]);
  assert.ok(store.readEvent(edge.id));
  assert.ok(store.readEvent(slackEdge.id));
  assert.equal(store.readEvent(tooOld.id), null);
});

test("a failed snapshot rename leaves the previous file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-snap-"));
  const store = new FactStore(root);
  const body = buildSnapshotBody([], new Map(), { videos: [], banEvents: [], cards: {} }, "v");
  store.writeSnapshot(body, "2026-01-01T00:00:00.000Z");
  assert.throws(() =>
    store.writeSnapshot(
      { ...body, eventCount: 1 },
      "2026-02-01T00:00:00.000Z",
      { beforeRename: () => { throw new Error("boom"); } },
    ),
  );
  const snapshot = store.readSnapshot();
  assert.equal(snapshot?.publishedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot?.eventCount, 0);
  const dir = path.dirname(store.snapshotFile);
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith(".tmp")), false);
});

test("republishing identical facts does not rewrite the snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-same-"));
  const store = new FactStore(root);
  store.putEvent(event("melee.gg:one", ANCHOR));
  const first = await publishSnapshot(store, { classifierVersion: "v1", now: new Date("2026-11-02T00:00:00.000Z") });
  assert.equal(first.changed, true);
  const second = await publishSnapshot(store, { classifierVersion: "v1", now: new Date("2026-12-01T00:00:00.000Z") });
  assert.equal(second.changed, false);
  assert.equal(store.readSnapshot()?.publishedAt, "2026-11-02T00:00:00.000Z");
});

test("an undefined coverage field is omitted and the written snapshot still parses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-undef-"));
  const store = new FactStore(root);
  const body = buildSnapshotBody([], new Map(), { videos: [], banEvents: [], cards: {} }, "v");
  const coverage: SnapshotCoverage = {
    complete: true,
    requestedDays: 5,
    discovered: 1,
    ingested: 1,
    failed: 0,
    emptyFiles: 0,
    newestFolderDate: "2026-11-07",
    oldestFolderDate: "2026-11-07",
    cacheLagDays: 1,
    mtgo: "ok",
    mtgoMissed: undefined,
  };
  body.coverage = coverage;
  store.writeSnapshot(body, "2026-11-08T13:00:16.044Z");
  const text = fs.readFileSync(store.snapshotFile, "utf8");
  assert.equal(text.includes("undefined"), false);
  const parsed = JSON.parse(text) as { coverage: { mtgo: string } };
  assert.equal(parsed.coverage.mtgo, "ok");
  assert.equal("mtgoMissed" in parsed.coverage, false);
  assert.equal(stableStringify({ a: 1, b: undefined }), '{"a":1}');
  assert.throws(() => stableStringify(Number.NaN), /non-finite/);
});

test("unreadable snapshot JSON can be replaced, and a refused write keeps the previous file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-badjson-"));
  const store = new FactStore(root);
  const body = buildSnapshotBody([], new Map(), { videos: [], banEvents: [], cards: {} }, "v");
  fs.mkdirSync(path.dirname(store.snapshotFile), { recursive: true });
  fs.writeFileSync(store.snapshotFile, '{"coverage":{"mtgo":"ok","mtgoMissed":undefined}}\n');
  assert.equal(store.readSnapshot(), null);
  store.writeSnapshot(body, "2026-11-08T13:00:16.044Z");
  const replaced = JSON.parse(fs.readFileSync(store.snapshotFile, "utf8")) as { publishedAt: string; status: string };
  assert.equal(replaced.status, "ok");
  assert.equal(replaced.publishedAt, "2026-11-08T13:00:16.044Z");
  assert.equal(fs.readFileSync(store.snapshotFile, "utf8").includes("undefined"), false);
  assert.throws(() => store.writeSnapshot({ ...body, eventCount: Number.NaN }, "2026-11-09T00:00:00.000Z"), /non-finite/);
  const kept = JSON.parse(fs.readFileSync(store.snapshotFile, "utf8")) as { publishedAt: string };
  assert.equal(kept.publishedAt, "2026-11-08T13:00:16.044Z");
});

test("missing fetch does not reclassify pruned boards as Unknown", () => {
  assert.equal(classifyFetched("Modern", [], [], false), null);
  const fetched = classifyFetched("Modern", [], [], true);
  assert.ok(fetched);
  assert.match(fetched.archetype, /Unknown/);
});
