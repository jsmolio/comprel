import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissingSnapshot } from "../src/components/MissingSnapshot";
import { ShareChart } from "../src/components/ShareChart";
import { TrendBadge } from "../src/components/TrendBadge";
import { buildSnapshotBody } from "../src/lib/facts/compute";
import { DAY_MS } from "../src/lib/facts/horizon";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
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
  const snap = store.readSnapshot();
  assert.ok(snap);
  const index = JSON.parse(fs.readFileSync(store.snapshotFile, "utf8")) as {
    home: { format: string; totalDecks: number; top: { archetype: string }[] }[];
    formats: { format: string; archetypes: string[] }[];
  };
  assert.equal(index.home.find((row) => row.format === "Modern")?.top[0]?.archetype, "Energy");
  assert.ok(index.formats.find((row) => row.format === "Modern")?.archetypes.includes("Domain"));
  assert.equal(fs.readFileSync(store.snapshotFile, "utf8").includes("Lightning Bolt"), false);
  assert.equal(fs.existsSync(path.join(root, "data", "published", "magic", "modern", "lists", "all.json")), true);
  assert.equal(fs.existsSync(path.join(root, "data", "published", "magic", "modern", "matchups", "30-all.json")), true);

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

test("pages and components do not render ingest miss diagnostics", () => {
  const roots = ["src/app", "src/components"];
  const files: string[] = [];
  const walk = (entry: string) => {
    if (!fs.existsSync(entry)) return;
    if (fs.statSync(entry).isFile()) {
      if (/\.tsx$/.test(entry)) files.push(entry);
      return;
    }
    for (const name of fs.readdirSync(entry)) walk(path.join(entry, name));
  };
  for (const root of roots) walk(root);
  assert.ok(files.length > 0);
  const banned = [
    /\bmissed\b/i,
    /\bunattempted\b/i,
    /partial coverage/i,
    /same-day mtgo/i,
    /scrape budget/i,
    /scrape was unavailable/i,
    /previously stored results/i,
    /CoverageNote/,
    /days behind/i,
    /no published decklists/i,
    /named no legend/i,
    /with no lists/i,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.doesNotMatch(text, pattern, `${file} matches ${pattern}`);
    }
  }
  assert.equal(fs.existsSync("src/components/CoverageNote.tsx"), false);
  assert.equal(fs.existsSync("src/components/RiftboundCoverageNote.tsx"), false);
  const magic = fs.readFileSync("src/app/magic/page.tsx", "utf8");
  const riftbound = fs.readFileSync("src/app/riftbound/page.tsx", "utf8");
  const home = fs.readFileSync("src/app/page.tsx", "utf8");
  assert.match(magic, /data last refreshed/);
  assert.match(riftbound, /latest data/);
  assert.doesNotMatch(home, /coverage/i);
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
