import type { ListedEvent } from "./select";

/**
 * BoundRift's featured feed (`/api/events`) is curated events plus fields of
 * about 100. The constructed aggregate lists the rest, 100 events at a time.
 *
 * A slice with thousands of store events and almost no named legends is left
 * to that featured feed. A higher field floor is used only when it still holds
 * 90% of the slice's named legends and the list is small enough to page.
 * Standings that name fewer than the era minimum (8) are dropped later, which
 * keeps a city event with a real table and drops an empty registration list.
 */
export const AGGREGATE_LIST_LIMIT = 160;
export const LEGEND_RETENTION = 0.9;
export const DISCOVER_CATEGORIES = ["regional", "showdown", "other", "open_play", "nexus_nights", "skirmish"] as const;
export const RAISED_FIELD_FLOORS = [16, 24, 32, 48, 64, 96] as const;

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
    registeredUserCount: null,
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
 * list completely, preferring the lowest field floor that still keeps nearly
 * all named legends.
 */
export async function discoverAggregateEvents(
  fetchPage: FetchAggregatePage,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  const maxPages = opts.maxPages ?? 64;
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

  const expand = async (query: AggregateQuery, page: AggregatePage): Promise<ListedEvent[] | null> => {
    if (page.totalResolved > AGGREGATE_LIST_LIMIT) return null;
    if (pageListsEveryone(page)) return page.events;
    const parts = splitDateRange(query.start, query.end);
    if (!parts) {
      state.truncated = true;
      return null;
    }
    const out: ListedEvent[] = [];
    for (const part of parts) {
      const childQuery = { ...query, ...part };
      const child = await take(childQuery);
      if (!child) return null;
      const listed = await expand(childQuery, child);
      if (!listed) return null;
      out.push(...listed);
    }
    return out;
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
      if (root.playersWithLegends < opts.minLegends) continue;
      if (root.totalResolved <= AGGREGATE_LIST_LIMIT) {
        const listed = await expand(query, root);
        if (listed) events.push(...listed);
        continue;
      }
      for (const floor of RAISED_FIELD_FLOORS) {
        if (state.stop || floor <= opts.minPlayers) continue;
        const raised: AggregateQuery = { ...query, minPlayers: floor };
        const page = await take(raised);
        if (!page) break;
        if (page.playersWithLegends < root.playersWithLegends * LEGEND_RETENTION) continue;
        if (page.totalResolved > AGGREGATE_LIST_LIMIT) continue;
        const listed = await expand(raised, page);
        if (listed) {
          events.push(...listed);
          break;
        }
      }
    }
  }

  const byId = new Map<number, ListedEvent>();
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event);
  return { events: [...byId.values()], pages: state.pages, truncated: state.truncated };
}
