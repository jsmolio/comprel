import type { BoardCard } from "../types";

/** A top finish stored in the tournament index. Card lists live on the event file. */
export interface TournamentFinish {
  player: string;
  archetype: string;
  rank: number | null;
  /** Match record such as "5-0" when the source recorded one. Placement text is not a record. */
  record: string | null;
  hasList: boolean;
}

export interface TournamentEvent {
  id: string;
  slug: string;
  name: string;
  date: string;
  source: string;
  uri: string | null;
  /** Field size when the source recorded one. Absent when only deck entries are known. */
  playerCount?: number;
  deckCount: number;
  finishes: TournamentFinish[];
}

export interface TournamentIndexFile {
  schemaVersion: 1;
  status: "ok";
  events: TournamentEvent[];
}

export interface MagicFinish extends TournamentFinish {
  anchorUri?: string | null;
  mainboard?: BoardCard[];
  sideboard?: BoardCard[];
}

export interface MagicTournamentEventFile extends TournamentEvent {
  schemaVersion: 1;
  status: "ok";
  format: string;
  finishes: MagicFinish[];
}

export interface RiftboundFinish extends TournamentFinish {
  anchorUri?: string | null;
  legend?: BoardCard[];
  champion?: BoardCard[];
  battlefield?: BoardCard[];
  main?: BoardCard[];
  runePool?: BoardCard[];
  sideboard?: BoardCard[];
}

export interface RiftboundTournamentEventFile extends TournamentEvent {
  schemaVersion: 1;
  status: "ok";
  game: "riftbound";
  format: string;
  finishes: RiftboundFinish[];
}
