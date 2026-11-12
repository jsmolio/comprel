import path from "node:path";
import { sliceKey } from "../facts/compute";
import type {
  FormatSnap,
  PublishedDeck,
  SnapMatchup,
  SnapRow,
  Snapshot,
  SnapshotBody,
} from "../facts/types";
import {
  DEFAULT_SOURCE,
  DEFAULT_WINDOW_DAYS,
  FORMATS,
  SOURCE_FILTERS,
  WINDOW_CHOICES,
  type Format,
  type SourceFilter,
} from "../types";
import { publishedPart, publishedSegment, readPublishedDoc, type PublishedPart } from "./doc";
import { loadPublished } from "./load";

export function magicPublishedDir(root: string): string {
  return path.join(root, "data", "published", "magic");
}

export function magicLegacySnapshot(root: string): string {
  return path.join(root, "data", "published", "snapshot.json");
}

export const MAGIC_DIR = magicPublishedDir(process.cwd());
export const MAGIC_INDEX_PATH = path.join(MAGIC_DIR, "index.json");
export const MAGIC_INDEX_LABEL = "data/published/magic/index.json";

export interface MagicFormatHeader {
  format: Format;
  anchor: string | null;
  latest: string | null;
  latestBySource: Record<SourceFilter, string | null>;
  /** Every archetype name in this format, in the same order a full snapshot read would produce. */
  archetypes: string[];
}

export interface MagicHomeEntry {
  format: Format;
  totalDecks: number;
  archetypeCount: number;
  latest: string | null;
  /** Top rows of the default 30-day, all-sources slice. At most four. */
  top: SnapRow[];
}

export interface MagicIndexFile {
  schemaVersion: 1;
  status: "ok";
  publishedAt: string;
  classifierVersion: string;
  eventCount: number;
  videosState?: Snapshot["videosState"];
  coverage?: Snapshot["coverage"];
  banEvents: Snapshot["banEvents"];
  videos: Snapshot["videos"];
  formats: MagicFormatHeader[];
  home: MagicHomeEntry[];
}

export interface MagicSummaryFile {
  schemaVersion: 1;
  status: "ok";
  format: Format;
  slices: Record<string, { totalDecks: number; rows: SnapRow[] }>;
  weekly: FormatSnap["weekly"];
}

export interface MagicMatchupFile {
  schemaVersion: 1;
  status: "ok";
  format: Format;
  windowDays: number;
  source: SourceFilter;
  matchups: SnapMatchup[];
}

export interface MagicListFile {
  schemaVersion: 1;
  status: "ok";
  format: Format;
  source: SourceFilter;
  lists: Record<string, PublishedDeck[]>;
}

export interface MagicCardsFile {
  schemaVersion: 1;
  status: "ok";
  cards: Snapshot["cards"];
}

export type { PublishedPart };

/** Names in the order `Object.keys` has after the snapshot is written with sorted keys. */
export function publishedArchetypeNames(format: FormatSnap): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(format.slices).sort()) {
    for (const row of format.slices[key].rows) names.add(row.archetype);
  }
  for (const source of Object.keys(format.lists).sort() as SourceFilter[]) {
    for (const name of Object.keys(format.lists[source]).sort()) names.add(name);
  }
  return [...names];
}

function homeEntries(snapshot: Snapshot): MagicHomeEntry[] {
  return FORMATS.map((format) => {
    const snap = snapshot.formats.find((row) => row.format === format);
    const slice = snap?.slices[sliceKey(DEFAULT_WINDOW_DAYS, DEFAULT_SOURCE)];
    const rows = slice?.rows ?? [];
    return {
      format,
      totalDecks: slice?.totalDecks ?? 0,
      archetypeCount: rows.length,
      latest: snap?.latest ?? null,
      top: rows.slice(0, 4),
    };
  });
}

export function magicPartFiles(snapshot: Snapshot): PublishedPart[] {
  const index: MagicIndexFile = {
    schemaVersion: 1,
    status: "ok",
    publishedAt: snapshot.publishedAt,
    classifierVersion: snapshot.classifierVersion,
    eventCount: snapshot.eventCount,
    banEvents: snapshot.banEvents,
    videos: snapshot.videos,
    formats: snapshot.formats.map((format) => ({
      format: format.format,
      anchor: format.anchor,
      latest: format.latest,
      latestBySource: format.latestBySource,
      archetypes: publishedArchetypeNames(format),
    })),
    home: homeEntries(snapshot),
  };
  if (snapshot.videosState) index.videosState = snapshot.videosState;
  if (snapshot.coverage) index.coverage = snapshot.coverage;

  const files: PublishedPart[] = [
    publishedPart("index.json", index),
    publishedPart("cards.json", { schemaVersion: 1, status: "ok", cards: snapshot.cards }),
  ];
  for (const format of snapshot.formats) {
    const slug = publishedSegment(format.format.toLowerCase());
    const slices: MagicSummaryFile["slices"] = {};
    for (const [key, slice] of Object.entries(format.slices)) {
      slices[key] = { totalDecks: slice.totalDecks, rows: slice.rows };
    }
    files.push(
      publishedPart(`${slug}/summary.json`, {
        schemaVersion: 1,
        status: "ok",
        format: format.format,
        slices,
        weekly: format.weekly,
      }),
    );
    for (const windowDays of WINDOW_CHOICES) {
      for (const source of SOURCE_FILTERS) {
        const key = sliceKey(windowDays, source);
        files.push(
          publishedPart(`${slug}/matchups/${windowDays}-${source}.json`, {
            schemaVersion: 1,
            status: "ok",
            format: format.format,
            windowDays,
            source,
            matchups: format.slices[key]?.matchups ?? [],
          }),
        );
      }
    }
    for (const source of SOURCE_FILTERS) {
      files.push(
        publishedPart(`${slug}/lists/${source}.json`, {
          schemaVersion: 1,
          status: "ok",
          format: format.format,
          source,
          lists: format.lists[source] ?? {},
        }),
      );
    }
  }
  return files;
}

export function readMagicSnapshot(dir: string): Snapshot | null {
  const index = readPublishedDoc<MagicIndexFile>(path.join(dir, "index.json"));
  if (!index || !Array.isArray(index.formats) || typeof index.publishedAt !== "string") return null;
  const cards = readPublishedDoc<MagicCardsFile>(path.join(dir, "cards.json"));
  if (!cards || !cards.cards) return null;
  const formats: FormatSnap[] = [];
  for (const header of index.formats) {
    let slug: string;
    try {
      slug = publishedSegment(String(header.format).toLowerCase());
    } catch {
      return null;
    }
    const summary = readPublishedDoc<MagicSummaryFile>(path.join(dir, slug, "summary.json"));
    if (!summary || !summary.slices || !summary.weekly) return null;
    const lists = { all: {}, paper: {}, mtgo: {} } as FormatSnap["lists"];
    for (const source of SOURCE_FILTERS) {
      const file = readPublishedDoc<MagicListFile>(path.join(dir, slug, "lists", `${source}.json`));
      if (!file || !file.lists) return null;
      lists[source] = file.lists;
    }
    const slices: FormatSnap["slices"] = {};
    for (const key of Object.keys(summary.slices)) {
      const [windowDays, source] = key.split(":");
      if (!windowDays || !source) return null;
      const matchups = readPublishedDoc<MagicMatchupFile>(path.join(dir, slug, "matchups", `${windowDays}-${source}.json`));
      if (!matchups || !Array.isArray(matchups.matchups)) return null;
      const slice = summary.slices[key];
      slices[key] = {
        totalDecks: slice?.totalDecks ?? 0,
        rows: slice?.rows ?? [],
        matchups: matchups.matchups,
      };
    }
    formats.push({
      format: header.format,
      anchor: header.anchor,
      latest: header.latest,
      latestBySource: header.latestBySource,
      slices,
      weekly: summary.weekly,
      lists,
    });
  }
  const snapshot: Snapshot = {
    schemaVersion: 1,
    status: "ok",
    publishedAt: index.publishedAt,
    classifierVersion: index.classifierVersion,
    eventCount: index.eventCount,
    formats,
    cards: cards.cards,
    videos: index.videos ?? [],
    banEvents: index.banEvents ?? [],
  };
  if (index.videosState) snapshot.videosState = index.videosState;
  if (index.coverage) snapshot.coverage = index.coverage;
  return snapshot;
}

export function loadMagicIndex() {
  return loadPublished<MagicIndexFile>(MAGIC_INDEX_PATH, MAGIC_INDEX_LABEL);
}

export function loadMagicSummary(format: Format) {
  const slug = format.toLowerCase();
  return loadPublished<MagicSummaryFile>(
    path.join(MAGIC_DIR, slug, "summary.json"),
    `data/published/magic/${slug}/summary.json`,
  );
}

export function loadMagicMatchups(format: Format, windowDays: number, source: SourceFilter) {
  const slug = format.toLowerCase();
  const name = `${windowDays}-${source}.json`;
  return loadPublished<MagicMatchupFile>(
    path.join(MAGIC_DIR, slug, "matchups", name),
    `data/published/magic/${slug}/matchups/${name}`,
  );
}

export function loadMagicLists(format: Format, source: SourceFilter) {
  const slug = format.toLowerCase();
  return loadPublished<MagicListFile>(
    path.join(MAGIC_DIR, slug, "lists", `${source}.json`),
    `data/published/magic/${slug}/lists/${source}.json`,
  );
}

export function loadMagicCards() {
  return loadPublished<MagicCardsFile>(path.join(MAGIC_DIR, "cards.json"), "data/published/magic/cards.json");
}

/** One format, one window, and one source. Decklists are included only when requested. */
export function viewMagicFormat(
  index: MagicIndexFile,
  summary: MagicSummaryFile,
  matchups: MagicMatchupFile,
  listsForSource?: { source: SourceFilter; lists: Record<string, PublishedDeck[]> },
): Snapshot {
  const header = index.formats.find((row) => row.format === summary.format);
  const key = sliceKey(matchups.windowDays, matchups.source);
  const rowSlice = summary.slices[key];
  const lists = { all: {}, paper: {}, mtgo: {} } as FormatSnap["lists"];
  if (listsForSource) lists[listsForSource.source] = listsForSource.lists;
  const formatSnap: FormatSnap = {
    format: summary.format,
    anchor: header?.anchor ?? null,
    latest: header?.latest ?? null,
    latestBySource: header?.latestBySource ?? { all: null, paper: null, mtgo: null },
    slices: {
      [key]: {
        totalDecks: rowSlice?.totalDecks ?? 0,
        rows: rowSlice?.rows ?? [],
        matchups: matchups.matchups,
      },
    },
    weekly: summary.weekly,
    lists,
  };
  const snapshot: Snapshot = {
    schemaVersion: 1,
    status: "ok",
    publishedAt: index.publishedAt,
    classifierVersion: index.classifierVersion,
    eventCount: index.eventCount,
    formats: [formatSnap],
    cards: {},
    videos: index.videos ?? [],
    banEvents: index.banEvents ?? [],
  };
  if (index.videosState) snapshot.videosState = index.videosState;
  if (index.coverage) snapshot.coverage = index.coverage;
  return snapshot;
}

export type MagicFormatView =
  | { ok: true; index: MagicIndexFile; snapshot: Snapshot; archetypes: readonly string[] }
  | { ok: false; reason: string };

export function loadMagicFormatView(
  format: Format,
  windowDays: number,
  source: SourceFilter,
  opts?: { lists?: boolean },
): MagicFormatView {
  const index = loadMagicIndex();
  if (!index.ok) return index;
  const summary = loadMagicSummary(format);
  if (!summary.ok) return summary;
  const matchups = loadMagicMatchups(format, windowDays, source);
  if (!matchups.ok) return matchups;
  let listsForSource: { source: SourceFilter; lists: Record<string, PublishedDeck[]> } | undefined;
  if (opts?.lists) {
    const lists = loadMagicLists(format, source);
    if (!lists.ok) return lists;
    listsForSource = { source, lists: lists.snapshot.lists };
  }
  const header = index.snapshot.formats.find((row) => row.format === format);
  return {
    ok: true,
    index: index.snapshot,
    archetypes: header?.archetypes ?? [],
    snapshot: viewMagicFormat(index.snapshot, summary.snapshot, matchups.snapshot, listsForSource),
  };
}

export function magicBody(snapshot: Snapshot): SnapshotBody {
  const body: SnapshotBody = {
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
    classifierVersion: snapshot.classifierVersion,
    eventCount: snapshot.eventCount,
    formats: snapshot.formats,
    cards: snapshot.cards,
    videos: snapshot.videos,
    banEvents: snapshot.banEvents,
  };
  if (snapshot.videosState) body.videosState = snapshot.videosState;
  if (snapshot.coverage) body.coverage = snapshot.coverage;
  return body;
}
