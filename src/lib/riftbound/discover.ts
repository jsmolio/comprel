import type { ListedEvent } from "./select";

/**
 * BoundRift's featured feed (`/api/events`) is curated events plus fields of
 * about 100. The constructed aggregate lists the rest. Its echoed event list
 * is the largest rows only, and `totalResolved` is the true count.
 *
 * A slice over the list cap is halved by date until each part can be listed
 * in full, so a mid-size event is not dropped by a higher field floor. A slice
 * of thousands of store events with almost no named legends is not paged day
 * by day. A higher field floor is used only when it still holds 90% of that
 * slice's named legends and the list is small enough to page. A one-day slice
 * that is still over the cap uses that floor. Standings that name fewer than
 * the era minimum (8) are dropped later, which keeps a city event with a real
 * table and drops an empty registration list.
 */
export const AGGREGATE_LIST_LIMIT = 160;
export const LEGEND_RETENTION = 0.9;
export const DISCOVER_CATEGORIES = ["regional", "showdown", "other", "open_play", "nexus_nights", "skirmish"] as const;
export const RAISED_FIELD_FLOORS = [16, 24, 32, 48, 64, 96] as const;
/**
 * Aggregate reads for one discovery, including date splits. A 90-day listing
 * of the legend-bearing slices is about 240 reads; the extra room is for a
 * busier week. Past this, halves already listed are kept and the rest is truncated.
 */
export const DEFAULT_DISCOVER_PAGES = 320;
/** An over-cap slice no larger than this multiple of the list cap is date-split even when legends are sparse. */
export const DATE_SPLIT_OVERAGE = 4;

export interface AggregateQuery {
  category: string;
  cn: "only" | "exclude";
  /** Inclusive YYYY-MM-DD. */
  start: string;
  /** Exclusive YYYY-MM-DD. */
  end: string;
  minPlayers: number;
}

export interface AggregatePage {
  totalResolved: number;
  playersWithLegends: number;
  events: ListedEvent[];
}

export interface DiscoverOptions {
  start: string;
  end: string;
  minPlayers: number;
  minLegends: number;
  maxPages?: number;
}

export interface DiscoverResult {
  events: ListedEvent[];
  pages: number;
  truncated: boolean;
}

const STOP = Symbol("stop");

export type FetchAggregatePage = (query: AggregateQuery) => Promise<AggregatePage | null | typeof STOP>;

export { STOP as AGGREGATE_STOP };

/**
 * Date-split an over-cap slice when a few halvings can list it, or when named
 * legends are at least as common as events. Below that, the rows are mostly
 * empty registrations and a higher field floor is the cheaper cut.
 */
export function sliceNeedsDateSplit(page: AggregatePage, minLegends: number): boolean {
  if (page.totalResolved <= AGGREGATE_LIST_LIMIT) return false;
  if (page.playersWithLegends < minLegends) return false;
  if (page.totalResolved <= AGGREGATE_LIST_LIMIT * DATE_SPLIT_OVERAGE) return true;
  return page.playersWithLegends >= page.totalResolved;
}

export function aggregateUrl(query: AggregateQuery, origin = "https://boundrift.com/api"): string {
  const params = new URLSearchParams({
    gameplay_format: "Constructed",
    event_category: query.category,
    cn: query.cn,
    min_players: String(query.minPlayers),
    start_date_after: query.start,
    start_date_before: query.end,
  });
  return `${origin}/stats/aggregate?${params}`;
}

export function toIso(value: string): string | null {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const normalized = Date.parse(value.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(normalized)) return null;
  return new Date(normalized).toISOString();
}

/** Half-open date range. A one-day span cannot be split. */
export function splitDateRange(start: string, end: string): [{ start: string; end: string }, { start: string; end: string }] | null {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b - a <= 86_400_000) return null;
  const mid = a + Math.floor((b - a) / 86_400_000 / 2) * 86_400_000;
  const midIso = new Date(mid).toISOString().slice(0, 10);
  if (midIso <= start || midIso >= end) return null;
  return [
    { start, end: midIso },
    { start: midIso, end },
  ];
}

export function listedFromAggregate(value: unknown): ListedEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  if (!Number.isFinite(id)) return null;
  const when = typeof row.startDatetime === "string" ? toIso(row.startDatetime) : null;
  const num = (key: string): number | null => (typeof row[key] === "number" ? (row[key] as number) : null);
  return {
    id,
    name: typeof row.name === "string" ? row.name : "",
    startDatetime: when,
    lifecycleStatus: typeof row.lifecycleStatus === "string" ? row.lifecycleStatus : null,
    source: typeof row.source === "string" ? row.source : null,
    eventCategory: typeof row.eventCategory === "string" ? row.eventCategory : null,
    gameplayFormatName: "Constructed",
    eventFormat: "CONSTRUCTED",
    startingPlayerCount: typeof row.playerCount === "number" ? row.playerCount : null,
    registeredUserCount: num("registeredUserCount"),
    capacity: num("capacity"),
    roundCount: typeof row.roundCount === "number" ? row.roundCount : Array.isArray(row.rounds) ? row.rounds.length : null,
  };
}

export function parseAggregateBody(body: unknown): AggregatePage | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.totalResolved !== "number" || !Array.isArray(record.events)) return null;
  const totals = record.totals;
  const players =
    totals && typeof totals === "object" && typeof (totals as { players?: unknown }).players === "number"
      ? (totals as { players: number }).players
      : null;
  if (players == null) return null;
  const events = record.events.map(listedFromAggregate).filter((event): event is ListedEvent => event != null);
  return { totalResolved: record.totalResolved, playersWithLegends: players, events };
}

function pageListsEveryone(page: AggregatePage): boolean {
  return page.totalResolved <= page.events.length;
}

/**
 * Events the featured feed misses: every constructed event in slices we can
 * list completely. Over-cap slices are halved by date before a higher field
 * floor is considered.
 */
export async function discoverAggregateEvents(
  fetchPage: FetchAggregatePage,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  const maxPages = opts.maxPages ?? DEFAULT_DISCOVER_PAGES;
  const state = { pages: 0, truncated: false, stop: false };
  const events: ListedEvent[] = [];

  const take = async (query: AggregateQuery): Promise<AggregatePage | null> => {
    if (state.stop) return null;
    if (state.pages >= maxPages) {
      state.stop = true;
      state.truncated = true;
      return null;
    }
    state.pages += 1;
    const page = await fetchPage(query);
    if (page === STOP) {
      state.stop = true;
      state.truncated = true;
      return null;
    }
    if (!page) {
      state.truncated = true;
      return null;
    }
    return page;
  };

  const eachHalf = async (
    query: AggregateQuery,
    parts: [{ start: string; end: string }, { start: string; end: string }],
    splitting: boolean,
  ): Promise<ListedEvent[] | null> => {
    const out: ListedEvent[] = [];
    for (const part of parts) {
      if (state.stop) return out.length ? out : null;
      const childQuery = { ...query, ...part };
      const child = await take(childQuery);
      if (!child) return out.length ? out : null;
      const listed = await collect(childQuery, child, splitting);
      if (!listed) return out.length ? out : null;
      out.push(...listed);
    }
    return out;
  };

  const raiseFloor = async (query: AggregateQuery, page: AggregatePage): Promise<ListedEvent[] | null> => {
    for (const floor of RAISED_FIELD_FLOORS) {
      if (state.stop) return null;
      if (floor <= query.minPlayers) continue;
      const raised: AggregateQuery = { ...query, minPlayers: floor };
      const raisedPage = await take(raised);
      if (!raisedPage) return null;
      if (raisedPage.playersWithLegends < page.playersWithLegends * LEGEND_RETENTION) continue;
      if (raisedPage.totalResolved > AGGREGATE_LIST_LIMIT) continue;
      const listed = await collect(raised, raisedPage, false);
      if (listed) return listed;
    }
    return [];
  };

  const collect = async (query: AggregateQuery, page: AggregatePage, splitting: boolean): Promise<ListedEvent[] | null> => {
    if (state.stop) return null;
    if (page.playersWithLegends < opts.minLegends) return [];
    if (pageListsEveryone(page)) return page.events;
    const parts = splitDateRange(query.start, query.end);
    if (!parts) {
      // A one-day slice cannot be halved. Over the list cap, a higher floor is
      // the remaining cut. Under the cap, keep the rows the feed echoed.
      if (page.totalResolved > AGGREGATE_LIST_LIMIT) return raiseFloor(query, page);
      // The feed echoed the largest rows of this day. Smaller rows on a single
      // day cannot be split out; keep the rows we have.
      return page.events;
    }
    if (page.totalResolved <= AGGREGATE_LIST_LIMIT || splitting || sliceNeedsDateSplit(page, opts.minLegends)) {
      return eachHalf(query, parts, true);
    }
    return raiseFloor(query, page);
  };

  for (const category of DISCOVER_CATEGORIES) {
    if (state.stop) break;
    for (const cn of ["only", "exclude"] as const) {
      if (state.stop) break;
      const query: AggregateQuery = {
        category,
        cn,
        start: opts.start,
        end: opts.end,
        minPlayers: opts.minPlayers,
      };
      const root = await take(query);
      if (!root) continue;
      const listed = await collect(query, root, false);
      if (listed?.length) events.push(...listed);
    }
  }

  const byId = new Map<number, ListedEvent>();
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event);
  return { events: [...byId.values()], pages: state.pages, truncated: state.truncated };
}
