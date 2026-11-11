import type { BoardCard } from "../types";
import type { SnapSlice, SnapWeek, StoredVideo, VideosState } from "../facts/types";
import type { EraDef } from "./eras";

export interface RiftboundFactDeck {
  /** Stable join key for pairings. This is the BoundRift player id, not the display name. */
  player: string;
  name: string;
  archetype: string;
  colorName: string | null;
  rank: number | null;
}

export interface RiftboundFactMatch {
  player1: string;
  player2: string;
  winner: 0 | 1 | 2;
}

export interface RiftboundFactEvent {
  schemaVersion: 1;
  id: string;
  boundriftId: number;
  source: string;
  name: string;
  date: string;
  uri: string | null;
  category: string | null;
  format: "Constructed";
  playerCount: number;
  deckCount: number;
  decks: RiftboundFactDeck[];
  matches: RiftboundFactMatch[];
  /** True when the event published no decklists (PlayRiftbound lag, or none on the source). */
  listsAbsent: boolean;
}

export interface RiftboundBoard {
  anchorUri: string | null;
  legend: BoardCard[];
  champion: BoardCard[];
  battlefield: BoardCard[];
  main: BoardCard[];
  runePool: BoardCard[];
  sideboard: BoardCard[];
}

export interface RiftboundList {
  player: string;
  playerId: string;
  rank: number | null;
  anchorUri: string | null;
  legend: BoardCard[];
  champion: BoardCard[];
  battlefield: BoardCard[];
  main: BoardCard[];
  runePool: BoardCard[];
  sideboard: BoardCard[];
  tournamentName: string;
  tournamentDate: string;
  tournamentUri: string | null;
  source: string;
}

export interface RiftboundCardSnap {
  imageUrl: string | null;
  typeLine: string | null;
  priceUsd: string | null;
  slug: string | null;
  domains: string[];
}

export interface RiftboundCoverage {
  complete: boolean;
  requestedDays: number;
  discovered: number;
  ingested: number;
  failed: number;
  unattempted: number;
  boundrift: "ok" | "partial" | "unavailable";
  playriftboundEvents: number;
  playriftboundWithoutLists: number;
  /** Constructed events whose standings and pairings named no legend, so they were not stored. */
  skippedNoLegend?: number;
  misses?: { id: string; reason: string }[];
  unattemptedEvents?: { id: string; reason: string }[];
}

export interface RiftboundSnapshotBody {
  schemaVersion: 1;
  status: "ok";
  game: "riftbound";
  eventCount: number;
  anchor: string | null;
  latest: string | null;
  slices: Record<string, SnapSlice>;
  weekly: Record<string, { top10: string[]; weeks: SnapWeek[] }>;
  lists: Record<string, Record<string, RiftboundList[]>>;
  cards: Record<string, RiftboundCardSnap>;
  videos: StoredVideo[];
  videosState?: VideosState;
  banEvents: { date: string; card: string; kind: string }[];
  eras: EraDef[];
  coverage?: RiftboundCoverage;
}

export interface RiftboundSnapshot extends RiftboundSnapshotBody {
  publishedAt: string;
}

export const RIFTBOUND_VIDEO_FORMAT = "Riftbound";
