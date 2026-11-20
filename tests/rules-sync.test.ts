import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rulesSyncEvents, syncUpstreamRules } from "../src/lib/archetype/rules-sync";
import { classifierVersion } from "../src/lib/facts/classifier-version";
import { FactStore } from "../src/lib/facts/store";
import type { FactEvent, PlayerBoard } from "../src/lib/facts/types";
import { activeRulesRoot, loadFormatData, rulesMarkerPath } from "../src/lib/formatdata";
import { renderIngestDiagnostic } from "../src/lib/ingest-summary";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const FORMATS = ["Standard", "Pioneer", "Modern", "Legacy", "Vintage", "Pauper"];

function momoRule(cards: string[], type: string): string {
  return JSON.stringify({
    Name: "Momo",
    IncludeColorInName: true,
    Conditions: [
      { Type: "InMainboard", Cards: ["Momo, Friendly Flier"] },
      { Type: type, Cards: cards },
    ],
  });
}

function writeTree(dir: string, momo: string) {
  const formats = path.join(dir, "Formats");
  for (const format of FORMATS) fs.mkdirSync(path.join(formats, format, "Archetypes"), { recursive: true });
  for (let i = 0; i < 40; i++) {
    const name = i === 0 ? "UWMomo.json" : `Filler${i}.json`;
    const body =
      i === 0
        ? momo
        : JSON.stringify({
            Name: `Nope ${i}`,
            IncludeColorInName: false,
            Conditions: [{ Type: "InMainboard", Cards: [`Missing Card ${i}`] }],
          });
    fs.writeFileSync(path.join(formats, "Standard", "Archetypes", name), body);
  }
  const lands = [
    { Name: "Hallowed Fountain", Color: "WU" },
    { Name: "Plains", Color: "W" },
    { Name: "Island", Color: "U" },
  ];
  const nonLands = Array.from({ length: 1000 }, (_, i) => ({ Name: `Filler Card ${i}`, Color: "" }));
  fs.writeFileSync(path.join(formats, "card_colors.json"), JSON.stringify({ Lands: lands, NonLands: nonLands }));
}

function pack(tree: string): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-tar-"));
  const tarPath = path.join(dir, "rules.tar.gz");
  try {
    execFileSync("tar", ["-czf", tarPath, "-C", tree, "Formats"]);
    return fs.readFileSync(tarPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function board(): PlayerBoard {
  return {
    result: null,
    anchorUri: null,
    mainboard: [
      { name: "Hallowed Fountain", count: 4 },
      { name: "Plains", count: 4 },
      { name: "Island", count: 4 },
      { name: "Momo, Friendly Flier", count: 4 },
      { name: "Starfield Shepherd", count: 4 },
    ],
    sideboard: [],
  };
}

function event(id: string, players: string[]): FactEvent {
  return {
    schemaVersion: 1,
    classifierVersion: "stale",
    id,
    source: "mtgo.com",
    name: id,
    date: "2026-11-01T00:00:00.000Z",
    format: "Standard",
    uri: null,
    sourcePath: `Tournaments/MTGO/2026/11/01/${id}.json`,
    deckCount: players.length,
    decks: players.map((player) => ({ player, archetype: "Azorius Control", colorName: "Azorius", rank: 1 })),
    matches: [],
  };
}

function seedStore(root: string) {
  const store = new FactStore(root);
  store.putEvent(event("partial", ["Ada", "Bob"]));
  store.writeBoards("partial", { Ada: board() });
  store.putEvent(event("full", ["Cara"]));
  store.writeBoards("full", { Cara: board() });
  return store;
}

function override(root: string) {
  const file = path.join(root, "data", "rule-overrides", "Standard", "Archetypes", "UWMomo.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = momoRule(
    ["Starfield Shepherd", "Sage of the Skies", "Quantum Riddler", "Haliya, Guided by Light", "Abandoned Air Temple"],
    "OneOrMoreInMainboard",
  );
  fs.writeFileSync(file, body);
  return file;
}

test("unchanged upstream rules are a no-op", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-rules-same-"));
  try {
    writeTree(path.join(root, "data", "mtgoformatdata"), momoRule(["Haliya, Guided by Light"], "OneorMoreInMainboard"));
    const marker = rulesMarkerPath(root);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    const body = `${JSON.stringify({ schemaVersion: 1, appliedSha: OLD, source: "vendored", contentHash: "same" })}\n`;
    fs.writeFileSync(marker, body);
    const store = seedStore(root);
    const calls: string[] = [];
    const result = await syncUpstreamRules({
      root,
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/commits/")) return Response.json({ sha: OLD });
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    assert.equal(result.status, "unchanged");
    assert.equal(result.decksChanged, 0);
    assert.deepEqual(calls.map((url) => url.includes("/commits/")), [true]);
    assert.equal(fs.readFileSync(marker, "utf8"), body);
    assert.equal(store.readEvent("partial")?.decks.find((deck) => deck.player === "Ada")?.archetype, "Azorius Control");
    assert.equal(fs.existsSync(path.join(root, "data", "facts", "v1", "upstream-rules")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("changed upstream rules keep the local overlay and reclassify stored lists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-rules-new-"));
  try {
    writeTree(path.join(root, "data", "mtgoformatdata"), momoRule(["Vendored Only"], "InMainboard"));
    const overlay = override(root);
    const overlayBytes = fs.readFileSync(overlay);
    const upstream = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-upstream-"));
    writeTree(upstream, momoRule(["Haliya, Guided by Light"], "OneorMoreInMainboard"));
    const tar = pack(upstream);
    fs.rmSync(upstream, { recursive: true, force: true });
    const store = seedStore(root);
    const result = await syncUpstreamRules({
      root,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/commits/")) return Response.json({ sha: NEW });
        return new Response(new Uint8Array(tar));
      },
    });
    assert.equal(result.status, "updated");
    assert.equal(result.sha, NEW);
    assert.equal(result.decksChanged, 2);
    assert.equal(result.decksSkipped, 1);
    assert.equal(result.eventsUpdated, 2);
    assert.deepEqual(fs.readFileSync(overlay), overlayBytes);

    const synced = fs.readFileSync(
      path.join(root, "data", "facts", "v1", "upstream-rules", "Formats", "Standard", "Archetypes", "UWMomo.json"),
      "utf8",
    );
    assert.match(synced, /OneorMoreInMainboard/);
    assert.doesNotMatch(synced, /Quantum Riddler/);
    assert.equal(activeRulesRoot(root), path.join(root, "data", "facts", "v1", "upstream-rules"));
    const loaded = loadFormatData("Standard", root).archetypes.find((row) => row.Name === "Momo");
    assert.ok(loaded?.Conditions.some((condition) => condition.Cards.includes("Starfield Shepherd")));
    assert.ok(loaded?.Conditions.some((condition) => condition.Cards.includes("Quantum Riddler")));

    const partial = store.readEvent("partial");
    assert.equal(partial?.classifierVersion, "stale");
    assert.equal(partial?.decks.find((deck) => deck.player === "Ada")?.archetype, "Azorius Momo");
    assert.equal(partial?.decks.find((deck) => deck.player === "Bob")?.archetype, "Azorius Control");
    const full = store.readEvent("full");
    assert.equal(full?.decks[0]?.archetype, "Azorius Momo");
    assert.equal(full?.classifierVersion, classifierVersion(root));

    const summary = renderIngestDiagnostic({
      game: "Magic",
      status: "Publish allowed.",
      sections: [{ title: "Rules sync", events: rulesSyncEvents(result) }],
    });
    assert.match(summary, /### Rules sync/);
    assert.match(summary, new RegExp(NEW));
    assert.match(summary, /Azorius Control 2->0/);
    assert.match(summary, /Azorius Momo 0->2/);
    assert.match(summary, /kept without a stored list/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a reclassify error rolls the new rules back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-rules-rollback-"));
  try {
    const vendored = path.join(root, "data", "mtgoformatdata");
    writeTree(vendored, momoRule(["VENDORED-RULE"], "InMainboard"));
    const vendoredBytes = fs.readFileSync(path.join(vendored, "Formats", "Standard", "Archetypes", "UWMomo.json"));
    const upstream = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-upstream-"));
    writeTree(upstream, momoRule(["Haliya, Guided by Light"], "OneorMoreInMainboard"));
    const tar = pack(upstream);
    fs.rmSync(upstream, { recursive: true, force: true });
    const store = seedStore(root);
    const result = await syncUpstreamRules({
      root,
      fetch: async (input) => {
        if (String(input).includes("/commits/")) return Response.json({ sha: NEW });
        return new Response(new Uint8Array(tar));
      },
      reclassify: () => {
        throw new Error("reclassify blew up");
      },
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /reclassify blew up/);
    assert.equal(fs.existsSync(rulesMarkerPath(root)), false);
    assert.equal(fs.existsSync(path.join(root, "data", "facts", "v1", "upstream-rules")), false);
    assert.deepEqual(fs.readFileSync(path.join(vendored, "Formats", "Standard", "Archetypes", "UWMomo.json")), vendoredBytes);
    assert.equal(activeRulesRoot(root), vendored);
    assert.equal(store.readEvent("full")?.decks[0]?.archetype, "Azorius Control");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("upstream failure keeps the rules already in use", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-rules-fail-"));
  try {
    const vendored = path.join(root, "data", "mtgoformatdata");
    writeTree(vendored, momoRule(["VENDORED-RULE"], "InMainboard"));
    const vendoredFile = path.join(vendored, "Formats", "Standard", "Archetypes", "UWMomo.json");
    const vendoredBytes = fs.readFileSync(vendoredFile);
    const syncedDir = path.join(root, "data", "facts", "v1", "upstream-rules");
    writeTree(syncedDir, momoRule(["SENTINEL-RULE"], "InMainboard"));
    const sentinel = path.join(syncedDir, "Formats", "Standard", "Archetypes", "UWMomo.json");
    const sentinelBytes = fs.readFileSync(sentinel);
    const marker = rulesMarkerPath(root);
    const markerBody = `${JSON.stringify({ schemaVersion: 1, appliedSha: OLD, source: "synced", contentHash: "old" })}\n`;
    fs.writeFileSync(marker, markerBody);
    const store = seedStore(root);

    const failed = await syncUpstreamRules({
      root,
      fetch: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /network down/);
    assert.equal(failed.decksChanged, 0);
    assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
    assert.deepEqual(fs.readFileSync(vendoredFile), vendoredBytes);
    assert.equal(fs.readFileSync(marker, "utf8"), markerBody);
    assert.equal(store.readEvent("full")?.decks[0]?.archetype, "Azorius Control");

    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-broken-"));
    fs.mkdirSync(path.join(broken, "Formats"), { recursive: true });
    fs.writeFileSync(path.join(broken, "Formats", "card_colors.json"), "not json");
    const tar = pack(broken);
    fs.rmSync(broken, { recursive: true, force: true });
    const parsed = await syncUpstreamRules({
      root,
      fetch: async (input) => {
        if (String(input).includes("/commits/")) return Response.json({ sha: NEW });
        return new Response(new Uint8Array(tar));
      },
    });
    assert.equal(parsed.status, "failed");
    assert.equal(fs.readFileSync(marker, "utf8"), markerBody);
    assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
    assert.equal(store.readEvent("partial")?.decks.find((deck) => deck.player === "Ada")?.archetype, "Azorius Control");
    assert.equal(activeRulesRoot(root), syncedDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
