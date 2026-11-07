import type { BoardCard, Format, SourceFilter } from "../types";

export interface FactDeck {
  player: string;
  archetype: string;
  colorName: string | null;
  rank: number | null;
}

export interface FactMatch {
  player1: string;
  player2: string;
  /** 1 = player1 won, 2 = player2 won, 0 = draw or undetermined. Game scores are not stored. */
  winner: 0 | 1 | 2;
}

/**
 * One upstream event. Idempotency key is `id` (`source:stableId`).
 * Card lists are not stored here; pruning them must not be able to reclassify
 * the event. Reclassification refetches `sourcePath`.
 */
export interface FactEvent {
  schemaVersion: 1;
  classifierVersion: string;
  id: string;
  source: string;
  name: string;
  /** ISO-8601 instant. Window math uses this exact millisecond value. */
  date: string;
  format: Format;
  uri: string | null;
  /** Repo-relative cache path, or null when the event cannot be refetched. */
  sourcePath: string | null;
  deckCount: number;
  decks: FactDeck[];
  matches: FactMatch[];
}

export interface PlayerBoard {
  result: string | null;
  anchorUri: string | null;
  mainboard: BoardCard[];
  sideboard: BoardCard[];
}

export interface StoredVideo {
  id: string;
  format: string;
  archetype: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string | null;
}

export interface StoredBanEvent {
  format: string;
  date: string;
  card: string;
  action: string;
}

/** Optional sidecar recovered from a read-only database export or ban sync. Not required to publish stats. */
export interface FactExtras {
  schemaVersion: 1;
  videos: StoredVideo[];
  /** UTC day (YYYY-MM-DD) of the last successful YouTube search for `format\\0archetype`. */
  videoRefreshedOn?: Record<string, string>;
  /** UTC day of the last search attempt, including failures. Counts toward the daily cap. */
  videoAttemptedOn?: Record<string, string>;
  /** event id → player → UTC day the upstream list was confirmed absent. Skips repeat fetches. */
  boardEmptyOn?: Record<string, Record<string, string>>;
  banEvents: StoredBanEvent[];
  /** Last Scryfall banned/restricted lists, so a later sync can diff. Not shown in the UI. */
  banSnapshot: Record<string, { banned: string[]; restricted: string[] }>;
}

export type VideosState = "current" | "degraded" | "no-key";

export interface CardSnap {
  imageUrl: string | null;
  typeLine: string | null;
  priceUsd: string | null;
}

export interface SnapRow {
  archetype: string;
  colorName: string | null;
  deckCount: number;
  metaShare: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  winRate: number;
  /** Set only when the archetype had decks in the previous equal window. */
  prevShare?: number;
  conversion: { top8: number; elig8: number; top32: number; elig32: number };
}

export interface SnapMatchup {
  archetypeA: string;
  archetypeB: string;
  matches: number;
  winsA: number;
  winsB: number;
  draws: number;
  winRateA: number;
  ciLow: number;
  ciHigh: number;
}

export interface SnapSlice {
  totalDecks: number;
  rows: SnapRow[];
  matchups: SnapMatchup[];
}

export interface SnapWeek {
  week: string;
  total: number;
  counts: Record<string, number>;
}

export interface PublishedDeck {
  player: string;
  result: string | null;
  rank: number | null;
  anchorUri: string | null;
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  tournamentName: string;
  tournamentDate: string;
  tournamentUri: string | null;
  source: string;
}

export interface FormatSnap {
  format: Format;
  anchor: string | null;
  latest: string | null;
  latestBySource: Record<SourceFilter, string | null>;
  slices: Record<string, SnapSlice>;
  weekly: Record<SourceFilter, { top10: string[]; weeks: SnapWeek[] }>;
  lists: Record<SourceFilter, Record<string, PublishedDeck[]>>;
}

export interface SnapshotCoverage {
  /** True only when every discovered cache file in the requested window was ingested. */
  complete: boolean;
  requestedDays: number;
  discovered: number;
  ingested: number;
  failed: number;
  /** Cache files that downloaded and were empty, so they hold no event. */
  emptyFiles: number;
  newestFolderDate: string | null;
  oldestFolderDate: string | null;
  /** Days from the newest cache folder to the publish clock. Null when no folders were found. */
  cacheLagDays: number | null;
  /**
   * Same-day MTGO scrape. "unavailable" is a structural failure and blocks publish
   * unless explicitly overridden. "partial" means some events were missed; the
   * snapshot still publishes and those events keep any previously stored facts.
   */
  mtgo: "ok" | "skipped" | "unavailable" | "partial";
  /** Events skipped by this scrape. Present when mtgo is "partial". */
  mtgoMissed?: number;
}

export interface SnapshotBody {
  schemaVersion: 1;
  status: "ok";
  classifierVersion: string;
  eventCount: number;
  formats: FormatSnap[];
  cards: Record<string, CardSnap>;
  videos: StoredVideo[];
  /** Omitted when unchanged so a skipped refresh does not rewrite the snapshot. */
  videosState?: VideosState;
  banEvents: StoredBanEvent[];
  coverage?: SnapshotCoverage;
}

export interface Snapshot extends SnapshotBody {
  /** Present only on the file that was atomically renamed into place. */
  publishedAt: string;
}
