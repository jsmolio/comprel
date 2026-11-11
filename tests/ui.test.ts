import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverageNote } from "../src/components/CoverageNote";
import { MissingSnapshot } from "../src/components/MissingSnapshot";
import { ShareChart } from "../src/components/ShareChart";
import { TrendBadge } from "../src/components/TrendBadge";
import { buildSnapshotBody } from "../src/lib/facts/compute";
import { DAY_MS } from "../src/lib/facts/horizon";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import { loadPublished } from "../src/lib/published/load";
import { archetypeDetail, banMarkers, formatSummaries, matchupMatrix, metaBreakdown } from "../src/lib/queries";
import { FactStore } from "../src/lib/facts/store";
import { GET as ingestGet, POST as ingestPost } from "../src/app/api/ingest/route";

const ANCHOR = Date.parse("2026-06-01T00:00:00.000Z");

function modernEvent(id: string, source: string, dateMs: number, archetype: string, player: string): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "v",
    id,
    source,
    name: id,
    date: new Date(dateMs).toISOString(),
    format: "Modern",
    uri: "https://example.test/event",
    sourcePath: null,
    deckCount: 20,
    decks: [{ player, archetype, colorName: "Izzet", rank: 1 }],
    matches: [],
  };
}

test("filters, five-list cap, and weekly chart read the snapshot", () => {
  const decks = Array.from({ length: 25 }, (_, i) => ({
    player: `pad-${i}`,
    archetype: "Energy",
    colorName: "Temur",
    rank: null,
  }));
  const domainIds = Array.from({ length: 6 }, (_, i) => `melee.gg:d${i}`);
  const events: FactEvent[] = [
    {
      schemaVersion: 1,
      classifierVersion: "v",
      id: "melee.gg:pad",
      source: "melee.gg",
      name: "Pad",
      date: new Date(ANCHOR).toISOString(),
      format: "Modern",
      uri: null,
      sourcePath: null,
      deckCount: 25,
      decks,
      matches: [],
    },
    ...domainIds.map((id, i) => modernEvent(id, "melee.gg", ANCHOR - (i + 1) * DAY_MS, "Domain", `ada-${i}`)),
    modernEvent("mtgo.com:d3", "mtgo.com", ANCHOR - 8 * DAY_MS, "Domain", "cam"),
    modernEvent("melee.gg:old", "melee.gg", ANCHOR - 20 * DAY_MS, "Tron", "dee"),
  ];
  const boards = new Map<string, Record<string, PlayerBoard>>();
  for (const id of [...domainIds, "mtgo.com:d3", "melee.gg:old"]) {
    const player = events.find((event) => event.id === id)!.decks[0].player;
    boards.set(id, {
      [player]: {
        result: "1st",
        anchorUri: null,
        mainboard: [{ name: "Lightning Bolt", count: 4 }],
        sideboard: [],
      },
    });
  }
  const body = buildSnapshotBody(events, boards, { videos: [], banEvents: [], cards: { "Lightning Bolt": { imageUrl: null, typeLine: "Instant", priceUsd: "1.00" } } }, "v");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-ui-"));
  const store = new FactStore(root);
  store.writeSnapshot(body, "2026-06-02T00:00:00.000Z");
  const loaded = loadPublished(store.snapshotFile);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const snap = loaded.snapshot;

  const month = metaBreakdown(snap, "Modern", 30, "all");
  const week = metaBreakdown(snap, "Modern", 7, "paper");
  assert.ok(month.rows.some((row) => row.archetype === "Tron"));
  assert.equal(week.rows.some((row) => row.archetype === "Tron"), false);
  assert.equal(week.rows.some((row) => row.archetype === "Domain"), true);
  const mtgo = metaBreakdown(snap, "Modern", 30, "mtgo");
  assert.equal(mtgo.totalDecks, 1);

  const matrix = matchupMatrix(snap, "Modern", 30, "all", 12);
  assert.ok(matrix.archetypes.length <= 12);

  const detail = archetypeDetail(snap, "Modern", 30, "all", "domain");
  assert.ok(detail);
  assert.equal(detail.decks.length, 5);
  assert.ok(detail.timeline.length >= 1);
  assert.equal(detail.decks[0]?.mainboard[0]?.name, "Lightning Bolt");

  const home = formatSummaries(snap);
  assert.equal(home.length, 6);
  assert.equal(home.find((format) => format.format === "Modern")?.top[0]?.archetype, "Energy");

  const marks = banMarkers(snap, "Modern");
  assert.ok(marks.some((mark) => mark.affectsFormat && mark.date === "2026-05-18"));
});

test("missing snapshot and chart controls render explicit states", () => {
  const missing = renderToStaticMarkup(createElement(MissingSnapshot, { reason: "not published" }));
  assert.match(missing, /has not been published/);
  assert.match(missing, /not showing an empty metagame/);
  const flat = renderToStaticMarkup(createElement(TrendBadge, { current: 0.2, prev: 0.1 }));
  assert.match(flat, /10\.0/);
  const chart = renderToStaticMarkup(
    createElement(ShareChart, {
      format: "Modern",
      points: [
        { week: "2026-01-05", n: 1, total: 10, top10: 4 },
        { week: "2026-01-12", n: 2, total: 10, top10: 5 },
        { week: "2026-01-19", n: 3, total: 10, top10: 6 },
      ],
      bans: [{ date: "2026-01-12", label: "test", affectsFormat: true }],
    }),
  );
  assert.match(chart, /Total meta/);
  assert.match(chart, /Top 10 decks/);
});

test("the coverage banner separates misses from events the budget did not request", () => {
  const base = {
    complete: true,
    requestedDays: 5,
    discovered: 10,
    ingested: 10,
    failed: 0,
    emptyFiles: 0,
    newestFolderDate: "2026-11-11",
    oldestFolderDate: "2026-11-07",
    cacheLagDays: 0,
    mtgo: "partial" as const,
  };
  const left = renderToStaticMarkup(
    createElement(CoverageNote, {
      coverage: {
        ...base,
        mtgoMissed: 0,
        mtgoUnattempted: 19,
        mtgoUnattemptedEvents: [
          { slug: "a", url: "https://www.mtgo.com/decklist/a", reason: "budget" },
          { slug: "b", url: "https://www.mtgo.com/decklist/b", reason: "request-limit" },
        ],
      },
    }),
  );
  assert.match(left, /left 1 event unattempted/);
  assert.doesNotMatch(left, /missed/);
  const capped = renderToStaticMarkup(
    createElement(CoverageNote, {
      coverage: {
        ...base,
        mtgoMissed: 0,
        mtgoUnattempted: 3,
        mtgoUnattemptedEvents: [{ slug: "c", url: "https://www.mtgo.com/decklist/c", reason: "request-limit" }],
      },
    }),
  );
  assert.doesNotMatch(capped, /unattempted/);
  const both = renderToStaticMarkup(
    createElement(CoverageNote, {
      coverage: {
        ...base,
        mtgoMissed: 2,
        mtgoUnattempted: 5,
        mtgoUnattemptedEvents: [
          { slug: "d", url: "https://www.mtgo.com/decklist/d", reason: "budget" },
          { slug: "e", url: "https://www.mtgo.com/decklist/e", reason: "budget" },
          { slug: "f", url: "https://www.mtgo.com/decklist/f", reason: "budget" },
          { slug: "g", url: "https://www.mtgo.com/decklist/g", reason: "budget" },
          { slug: "h", url: "https://www.mtgo.com/decklist/h", reason: "request-limit" },
        ],
      },
    }),
  );
  assert.match(both, /missed 2/);
  assert.match(both, /left 4/);
});

test("public ingest route is closed", async () => {
  const get = await ingestGet();
  const post = await ingestPost();
  assert.equal(get.status, 410);
  assert.equal(post.status, 410);
  const body = await get.json();
  assert.equal(body.error, "ingest-disabled");
});

test("request path does not import Prisma", () => {
  const roots = ["src/app", "src/components", "src/lib/queries.ts", "src/lib/published", "src/lib/facts"];
  const files: string[] = [];
  const walk = (entry: string) => {
    if (!fs.existsSync(entry)) return;
    if (fs.statSync(entry).isFile()) {
      if (/\.(ts|tsx)$/.test(entry)) files.push(entry);
      return;
    }
    for (const name of fs.readdirSync(entry)) walk(path.join(entry, name));
  };
  for (const root of roots) walk(root);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /@prisma\/client|@\/lib\/db|from \"\.\.\/db\"|from \"\.\/db\"/);
  }
});

test("export command is read-only and legacy ingest is not the publisher", () => {
  const exporter = fs.readFileSync("scripts/export-db.ts", "utf8");
  assert.doesNotMatch(exporter, /prisma\.(tournament|deck|match|card|video|banEvent|banSnapshot)\.(delete|update|create|upsert)/);
  assert.match(exporter, /findMany/);
  const workflow = fs.readFileSync(".github/workflows/ingest.yml", "utf8");
  assert.match(workflow, /pnpm backfill --incremental/);
  assert.doesNotMatch(workflow, /DATABASE_URL/);
});
