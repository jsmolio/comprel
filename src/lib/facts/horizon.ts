/**
 * How far back published facts have to go.
 *
 * The longest display window is 365 days, anchored at the 25th-newest deck
 * (`anchor`). Meta-share trend compares that window to the immediately previous
 * window of the same length, i.e. decks in [anchor-730d, anchor-365d). Matchup
 * and win-rate displays only read the current window. The weekly chart reads
 * 364 days.
 *
 * The scheduled Postgres ingest deleted whole tournaments older than 365 days
 * from wall-clock now (`--retention-days=365`). That cutoff removes the entire
 * previous 365-day window, so a 365-day trend on the database path was already
 * wrong whenever that prune had run. This store does not do that. It keeps
 * event facts back to anchor - (730 + slack) days. Slack (30 days) leaves room
 * for the anchor to sit behind the newest event and for a corrected file to
 * land a little older than the cutoff. It does not keep unbounded history.
 *
 * Nothing here deletes rows in Postgres.
 */
export const DAY_MS = 86_400_000;

/** 25th-newest deck (0-based index 24), matching anchorDateForFormat. */
export const ANCHOR_DECK_INDEX = 24;

export const STATS_WINDOW_DAYS = 365;
export const TREND_HISTORY_DAYS = STATS_WINDOW_DAYS * 2;
export const PRUNE_SLACK_DAYS = 30;
export const HISTORY_KEEP_DAYS = TREND_HISTORY_DAYS + PRUNE_SLACK_DAYS;

export const LISTS_PER_ARCHETYPE = 5;
export const MIN_DECKS_FOR_MATRIX = 3;
export const CHART_DAYS = 364;

/** Oldest instant that must survive so the previous 365-day window is intact. */
export function historyCutoffMs(anchorMs: number): number {
  return anchorMs - HISTORY_KEEP_DAYS * DAY_MS;
}
