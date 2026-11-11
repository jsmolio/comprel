import fs from "node:fs";
import path from "node:path";
import type { SnapMatchup, SnapSlice, SnapWeek } from "../facts/types";
import { ALL_ERA } from "../riftbound/eras";
import type { EraDef } from "../riftbound/eras";
import { RIFTBOUND_SOURCES } from "../riftbound/sources";
import type { RiftboundList, RiftboundSnapshot, RiftboundSnapshotBody } from "../riftbound/types";
import { WINDOW_CHOICES } from "../types";
import { publishedPart, publishedSegment, readPublishedDoc, type PublishedPart } from "./doc";
import { loadPublished } from "./load";

export function riftboundPublishedDir(root: string): string {
  return path.join(root, "data", "published", "riftbound");
}

export const RIFTBOUND_DIR = riftboundPublishedDir(process.cwd());
export const RIFTBOUND_INDEX_PATH = path.join(RIFTBOUND_DIR, "index.json");
export const RIFTBOUND_INDEX_LABEL = "data/published/riftbound/index.json";

export interface RiftboundIndexFile {
  schemaVersion: 1;
  status: "ok";
  publishedAt: string;
  game: "riftbound";
  eventCount: number;
  anchor: string | null;
  latest: string | null;
  videos: RiftboundSnapshot["videos"];
  videosState?: RiftboundSnapshot["videosState"];
  banEvents: RiftboundSnapshot["banEvents"];
  eras: EraDef[];
  coverage?: RiftboundSnapshot["coverage"];
  /** Legend names in the same order a full snapshot read would produce. */
  legends: string[];
}

export interface RiftboundSummaryFile {
  schemaVersion: 1;
  status: "ok";
  slices: Record<string, { totalDecks: number; rows: SnapSlice["rows"] }>;
  weekly: Record<string, { top10: string[]; weeks: SnapWeek[] }>;
}

export interface RiftboundMatchupFile {
  schemaVersion: 1;
  status: "ok";
  windowDays: number;
  source: string;
  era: string;
  matchups: SnapMatchup[];
}

export interface RiftboundListFile {
  schemaVersion: 1;
  status: "ok";
  source: string;
  era: string;
  lists: Record<string, RiftboundList[]>;
}

export interface RiftboundCardsFile {
  schemaVersion: 1;
  status: "ok";
  cards: RiftboundSnapshot["cards"];
}

export type { PublishedPart };

export function publishedLegendNames(snapshot: Pick<RiftboundSnapshotBody, "slices" | "lists">): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(snapshot.slices).sort()) {
    for (const row of snapshot.slices[key].rows) names.add(row.archetype);
  }
  for (const key of Object.keys(snapshot.lists).sort()) {
    for (const name of Object.keys(snapshot.lists[key]).sort()) names.add(name);
  }
  return [...names];
}

function eraIds(snapshot: Pick<RiftboundSnapshotBody, "eras">): string[] {
  return [ALL_ERA, ...snapshot.eras.map((era) => era.id)];
}

export function riftboundPartFiles(snapshot: RiftboundSnapshot): PublishedPart[] {
  const index: RiftboundIndexFile = {
    schemaVersion: 1,
    status: "ok",
    publishedAt: snapshot.publishedAt,
    game: "riftbound",
    eventCount: snapshot.eventCount,
    anchor: snapshot.anchor,
    latest: snapshot.latest,
    videos: snapshot.videos,
    banEvents: snapshot.banEvents,
    eras: snapshot.eras,
    legends: publishedLegendNames(snapshot),
  };
  if (snapshot.videosState) index.videosState = snapshot.videosState;
  if (snapshot.coverage) index.coverage = snapshot.coverage;

  const summarySlices: RiftboundSummaryFile["slices"] = {};
  for (const [key, slice] of Object.entries(snapshot.slices)) {
    summarySlices[key] = { totalDecks: slice.totalDecks, rows: slice.rows };
  }
  const files: PublishedPart[] = [
    publishedPart("index.json", index),
    publishedPart("cards.json", { schemaVersion: 1, status: "ok", cards: snapshot.cards }),
    publishedPart("summary.json", { schemaVersion: 1, status: "ok", slices: summarySlices, weekly: snapshot.weekly }),
  ];

  const sources = [...RIFTBOUND_SOURCES];
  for (const era of eraIds(snapshot)) {
    const eraSeg = publishedSegment(era);
    for (const source of sources) {
      const sourceSeg = publishedSegment(source);
      for (const windowDays of WINDOW_CHOICES) {
        const key = `${windowDays}:${source}:${era}`;
        files.push(
          publishedPart(`matchups/${windowDays}-${sourceSeg}-${eraSeg}.json`, {
            schemaVersion: 1,
            status: "ok",
            windowDays,
            source,
            era,
            matchups: snapshot.slices[key]?.matchups ?? [],
          }),
        );
      }
    }
  }

  for (const [key, lists] of Object.entries(snapshot.lists)) {
    const [source, era] = key.split(":");
    if (!source || !era || key.split(":").length !== 2) {
      throw new Error(`Refusing to publish a Riftbound list key ${JSON.stringify(key)}.`);
    }
    files.push(
      publishedPart(`lists/${publishedSegment(source)}/${publishedSegment(era)}.json`, {
        schemaVersion: 1,
        status: "ok",
        source,
        era,
        lists,
      }),
    );
  }
  return files;
}

export function readRiftboundSnapshot(dir: string): RiftboundSnapshot | null {
  const index = readPublishedDoc<RiftboundIndexFile>(path.join(dir, "index.json"));
  if (!index || index.game !== "riftbound" || typeof index.publishedAt !== "string" || !Array.isArray(index.eras)) return null;
  const cards = readPublishedDoc<RiftboundCardsFile>(path.join(dir, "cards.json"));
  const summary = readPublishedDoc<RiftboundSummaryFile>(path.join(dir, "summary.json"));
  if (!cards || !cards.cards || !summary || !summary.slices || !summary.weekly) return null;

  const slices: RiftboundSnapshot["slices"] = {};
  for (const key of Object.keys(summary.slices)) {
    const [windowDays, source, era] = key.split(":");
    if (!windowDays || !source || !era) return null;
    let sourceSeg: string;
    let eraSeg: string;
    try {
      sourceSeg = publishedSegment(source);
      eraSeg = publishedSegment(era);
    } catch {
      return null;
    }
    const matchups = readPublishedDoc<RiftboundMatchupFile>(
      path.join(dir, "matchups", `${windowDays}-${sourceSeg}-${eraSeg}.json`),
    );
    if (!matchups || !Array.isArray(matchups.matchups)) return null;
    const slice = summary.slices[key];
    slices[key] = {
      totalDecks: slice?.totalDecks ?? 0,
      rows: slice?.rows ?? [],
      matchups: matchups.matchups,
    };
  }

  const lists: RiftboundSnapshot["lists"] = {};
  const listRoot = path.join(dir, "lists");
  if (fs.existsSync(listRoot)) {
    for (const source of fs.readdirSync(listRoot)) {
      const sourceDir = path.join(listRoot, source);
      if (!fs.statSync(sourceDir).isDirectory()) continue;
      for (const name of fs.readdirSync(sourceDir)) {
        if (!name.endsWith(".json")) continue;
        const era = name.slice(0, -".json".length);
        try {
          publishedSegment(source);
          publishedSegment(era);
        } catch {
          return null;
        }
        const file = readPublishedDoc<RiftboundListFile>(path.join(sourceDir, name));
        if (!file || !file.lists) return null;
        lists[`${source}:${era}`] = file.lists;
      }
    }
  }

  const snapshot: RiftboundSnapshot = {
    schemaVersion: 1,
    status: "ok",
    game: "riftbound",
    publishedAt: index.publishedAt,
    eventCount: index.eventCount,
    anchor: index.anchor,
    latest: index.latest,
    slices,
    weekly: summary.weekly,
    lists,
    cards: cards.cards,
    videos: index.videos ?? [],
    banEvents: index.banEvents ?? [],
    eras: index.eras,
  };
  if (index.videosState) snapshot.videosState = index.videosState;
  if (index.coverage) snapshot.coverage = index.coverage;
  return snapshot;
}

export function loadRiftboundIndex() {
  return loadPublished<RiftboundIndexFile>(RIFTBOUND_INDEX_PATH, RIFTBOUND_INDEX_LABEL);
}

export function loadRiftboundSummary() {
  return loadPublished<RiftboundSummaryFile>(path.join(RIFTBOUND_DIR, "summary.json"), "data/published/riftbound/summary.json");
}

export function loadRiftboundMatchups(windowDays: number, source: string, era: string) {
  const name = `${windowDays}-${publishedSegment(source)}-${publishedSegment(era)}.json`;
  return loadPublished<RiftboundMatchupFile>(
    path.join(RIFTBOUND_DIR, "matchups", name),
    `data/published/riftbound/matchups/${name}`,
  );
}

/** A missing list file is an empty group. List files are written only when a group has decks. */
export function loadRiftboundListGroup(
  source: string,
  era: string,
): { ok: true; lists: Record<string, RiftboundList[]> } | { ok: false; reason: string } {
  const file = path.join(RIFTBOUND_DIR, "lists", publishedSegment(source), `${publishedSegment(era)}.json`);
  const label = `data/published/riftbound/lists/${source}/${era}.json`;
  if (!fs.existsSync(file)) return { ok: true, lists: {} };
  const loaded = loadPublished<RiftboundListFile>(file, label);
  if (!loaded.ok) return loaded;
  return { ok: true, lists: loaded.snapshot.lists };
}

export function loadRiftboundCards() {
  return loadPublished<RiftboundCardsFile>(path.join(RIFTBOUND_DIR, "cards.json"), "data/published/riftbound/cards.json");
}

function shell(index: RiftboundIndexFile, summary: RiftboundSummaryFile): RiftboundSnapshot {
  const snapshot: RiftboundSnapshot = {
    schemaVersion: 1,
    status: "ok",
    game: "riftbound",
    publishedAt: index.publishedAt,
    eventCount: index.eventCount,
    anchor: index.anchor,
    latest: index.latest,
    slices: {},
    weekly: summary.weekly,
    lists: {},
    cards: {},
    videos: index.videos ?? [],
    banEvents: index.banEvents ?? [],
    eras: index.eras,
  };
  if (index.videosState) snapshot.videosState = index.videosState;
  if (index.coverage) snapshot.coverage = index.coverage;
  return snapshot;
}

function withSlice(
  snapshot: RiftboundSnapshot,
  key: string,
  summary: RiftboundSummaryFile,
  matchups: SnapMatchup[],
): RiftboundSnapshot {
  const slice = summary.slices[key];
  snapshot.slices[key] = {
    totalDecks: slice?.totalDecks ?? 0,
    rows: slice?.rows ?? [],
    matchups,
  };
  return snapshot;
}

export function loadRiftboundMetaView(
  windowDays: number,
  source: string,
  era: string,
): { ok: true; snapshot: RiftboundSnapshot } | { ok: false; reason: string } {
  const index = loadRiftboundIndex();
  if (!index.ok) return index;
  const summary = loadRiftboundSummary();
  if (!summary.ok) return summary;
  const key = `${windowDays}:${source}:${era}`;
  const name = `${windowDays}-${publishedSegment(source)}-${publishedSegment(era)}.json`;
  const file = path.join(RIFTBOUND_DIR, "matchups", name);
  if (!fs.existsSync(file)) {
    if (summary.snapshot.slices[key]) {
      return {
        ok: false,
        reason: `data/published/riftbound/matchups/${name} is not in this deployment. No metagame has been published yet.`,
      };
    }
    return { ok: true, snapshot: withSlice(shell(index.snapshot, summary.snapshot), key, summary.snapshot, []) };
  }
  const matchups = loadRiftboundMatchups(windowDays, source, era);
  if (!matchups.ok) return matchups;
  return { ok: true, snapshot: withSlice(shell(index.snapshot, summary.snapshot), key, summary.snapshot, matchups.snapshot.matchups) };
}

export function loadRiftboundLegendView(
  windowDays: number,
  source: string,
  era: string,
  legend: string,
): { ok: true; snapshot: RiftboundSnapshot } | { ok: false; reason: string } {
  const meta = loadRiftboundMetaView(windowDays, source, era);
  if (!meta.ok) return meta;
  const cards = loadRiftboundCards();
  if (!cards.ok) return cards;
  const primary = loadRiftboundListGroup(source, era);
  if (!primary.ok) return primary;
  let group = primary.lists[legend];
  if (!group && source !== "all") {
    const fallback = loadRiftboundListGroup("all", era);
    if (!fallback.ok) return fallback;
    group = fallback.lists[legend];
  }
  const key = `${source}:${era}`;
  meta.snapshot.lists[key] = group ? { [legend]: group } : {};
  meta.snapshot.cards = cards.snapshot.cards;
  return meta;
}

export function riftboundBody(snapshot: RiftboundSnapshot): RiftboundSnapshotBody {
  const body: RiftboundSnapshotBody = {
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
    game: "riftbound",
    eventCount: snapshot.eventCount,
    anchor: snapshot.anchor,
    latest: snapshot.latest,
    slices: snapshot.slices,
    weekly: snapshot.weekly,
    lists: snapshot.lists,
    cards: snapshot.cards,
    videos: snapshot.videos,
    banEvents: snapshot.banEvents,
    eras: snapshot.eras,
  };
  if (snapshot.videosState) body.videosState = snapshot.videosState;
  if (snapshot.coverage) body.coverage = snapshot.coverage;
  return body;
}
