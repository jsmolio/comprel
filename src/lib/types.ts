// Shapes mirroring the MTGODecklistCache JSON (Newtonsoft PascalCase). A cache
// file deserializes to one `RawCacheItem`. See:
// https://github.com/Badaro/MTGODecklistCache.Tools/tree/main/MTGODecklistCache.Updater.Model

export interface RawCacheItem {
  Tournament: RawTournament;
  Decks: RawDeck[];
  Rounds?: RawRound[] | null;
  Standings?: RawStanding[] | null;
}

export interface RawTournament {
  Date: string; // ISO 8601
  Name: string;
  Uri?: string | null;
  Formats?: string | null; // explicit format from the fbettega cache, e.g. "Modern"
}

export interface RawDeckItem {
  Count: number;
  CardName: string;
}

export interface RawDeck {
  Date?: string | null;
  Player: string;
  Result?: string | null;
  AnchorUri?: string | null;
  Mainboard: RawDeckItem[];
  Sideboard: RawDeckItem[];
}

export interface RawRound {
  RoundName: string;
  Matches: RawRoundItem[];
}

export interface RawRoundItem {
  Player1: string;
  Player2: string;
  Result: string; // e.g. "2-1-0", "2-0-0", or "Player1 won" forms
}

export interface RawStanding {
  Rank: number;
  Player: string;
  Points: number;
  Wins: number;
  Losses: number;
  Draws: number;
  OMWP: number; // opponent match-win percentage
  GWP: number; // game-win percentage
  OGWP: number; // opponent game-win percentage
}

// Normalized board representation used throughout the app (stored as JSON on Deck).
export interface BoardCard {
  name: string;
  count: number;
}

export const FORMATS = [
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Pauper",
] as const;

export type Format = (typeof FORMATS)[number];

export const DEFAULT_WINDOW_DAYS = 30;
export const WINDOW_CHOICES = [7, 14, 30, 90, 365] as const;

// Data-source filter. "paper" = tabletop events, "mtgo" = Magic Online, "all" = both.
export const SOURCE_FILTERS = ["all", "paper", "mtgo"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export const DEFAULT_SOURCE: SourceFilter = "all";
export const SOURCE_LABELS: Record<SourceFilter, string> = { all: "All", paper: "Paper", mtgo: "MTGO" };

// Which upstream Tournament.source values belong to each filter. Manatraders
// runs on MTGO; melee/topdeck/cardsrealm are tabletop.
export const SOURCE_GROUP_MEMBERS: Record<"paper" | "mtgo", string[]> = {
  paper: ["melee.gg", "topdeck.gg", "cardsrealm.com"],
  mtgo: ["mtgo.com", "manatraders.com"],
};
