// Parsers for the free-text result strings that appear in the cache.

export interface MatchOutcome {
  p1: number;
  p2: number;
  draws: number;
  winner: 1 | 2 | 0; // 0 = draw or undetermined
}

const BYE = /^(bye|\s*|-+)$/i;

export function isByePlayer(name: string | null | undefined): boolean {
  return !name || BYE.test(name.trim());
}

/**
 * Parse a round result like "2-1-0", "2-0", "1-1-1". Convention: first number
 * is Player1's game wins, second is Player2's, optional third is draws.
 */
export function parseMatchResult(result: string | null | undefined): MatchOutcome | null {
  if (!result) return null;
  const nums = (result.match(/\d+/g) ?? []).map(Number);
  if (nums.length < 2) return null;
  const [p1, p2, draws = 0] = nums;
  const winner: 1 | 2 | 0 = p1 > p2 ? 1 : p2 > p1 ? 2 : 0;
  return { p1, p2, draws, winner };
}

export interface DeckRecord {
  wins: number;
  losses: number;
  draws: number;
  rank: number | null;
}

const ORDINAL = /^(\d+)(st|nd|rd|th)\b/i;

/**
 * Parse a deck-level result string. Handles MTGO league records ("5-0"),
 * placements ("1st Place"), and "Top 8" style finishes.
 */
export function parseDeckResult(result: string | null | undefined): DeckRecord {
  const empty: DeckRecord = { wins: 0, losses: 0, draws: 0, rank: null };
  if (!result) return empty;
  const text = result.trim();

  const ord = text.match(ORDINAL);
  if (ord) return { ...empty, rank: Number(ord[1]) };

  const top = text.match(/top\s*(\d+)/i);
  // A "Top 8" finish gives a coarse rank bound, not a W/L record.
  if (top) return { ...empty, rank: Number(top[1]) };

  const rec = text.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (rec) {
    return {
      wins: Number(rec[1]),
      losses: Number(rec[2]),
      draws: rec[3] ? Number(rec[3]) : 0,
      rank: null,
    };
  }
  return empty;
}
