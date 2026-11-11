import type { RiftboundSource } from "./sources";

export interface ListedEvent {
  id: number;
  name: string;
  startDatetime: string | null;
  lifecycleStatus: string | null;
  source: string | null;
  eventCategory: string | null;
  gameplayFormatName: string | null;
  eventFormat: string | null;
  startingPlayerCount: number | null;
  registeredUserCount: number | null;
}

const TEAM =
  /\b(2v2|two-?headed|team trios|trios|free for all|free-for-all|sealed|draft|prerelease|pre-release)\b/i;

const PREMIER_CATEGORIES = new Set(["regional", "showdown"]);
const LARGE_SIDE_CATEGORIES = new Set(["other", "open_play", "nexus_nights"]);

export function fieldSize(event: ListedEvent): number {
  const size = event.startingPlayerCount ?? event.registeredUserCount ?? 0;
  return Number.isFinite(size) ? size : 0;
}

export function isConstructedSolo(event: ListedEvent): boolean {
  if (TEAM.test(event.name ?? "")) return false;
  const named = (event.gameplayFormatName ?? "").toLowerCase();
  const code = (event.eventFormat ?? "").toUpperCase();
  if (named.includes("sealed") || named.includes("draft") || code === "SEALED" || code === "DRAFT") return false;
  return named === "constructed" || code === "CONSTRUCTED";
}

export function isPremier(event: ListedEvent, minPlayers: number): boolean {
  if (!isConstructedSolo(event) || fieldSize(event) < minPlayers) return false;
  const category = event.eventCategory ?? "";
  if (PREMIER_CATEGORIES.has(category)) return true;
  if (event.source === "playriftbound") return true;
  return LARGE_SIDE_CATEGORIES.has(category) && fieldSize(event) >= 128;
}

export interface SelectOptions {
  now: Date;
  days: number;
  minPlayers: number;
  skirmishSample: number;
}

function inWindow(event: ListedEvent, now: Date, days: number): boolean {
  if (!event.startDatetime) return false;
  const time = Date.parse(event.startDatetime);
  if (Number.isNaN(time)) return false;
  const start = now.getTime() - days * 86_400_000;
  return time >= start && time <= now.getTime() + 86_400_000;
}

/** Round-robin the newest skirmish per source so one region does not fill the sample. */
export function sampleSkirmishes(events: ListedEvent[], limit: number): ListedEvent[] {
  const sorted = [...events].sort((a, b) => (b.startDatetime ?? "").localeCompare(a.startDatetime ?? ""));
  const bySource = new Map<string, ListedEvent[]>();
  for (const event of sorted) {
    const key = event.source ?? "unknown";
    const list = bySource.get(key);
    if (list) list.push(event);
    else bySource.set(key, [event]);
  }
  const keys = [...bySource.keys()].sort();
  const out: ListedEvent[] = [];
  for (let depth = 0; out.length < limit; depth++) {
    let progressed = false;
    for (const key of keys) {
      const event = bySource.get(key)?.[depth];
      if (!event) continue;
      out.push(event);
      progressed = true;
      if (out.length >= limit) break;
    }
    if (!progressed) break;
  }
  return out;
}

/**
 * Premier and regional constructed events in the window, plus a bounded skirmish sample.
 * Team, sealed, and draft events are left out. Newly finished events come first.
 */
export function selectIngestEvents(events: readonly ListedEvent[], opts: SelectOptions): ListedEvent[] {
  const eligible = events.filter(
    (event) =>
      event.lifecycleStatus === "EVENT_FINISHED" &&
      isConstructedSolo(event) &&
      fieldSize(event) >= opts.minPlayers &&
      inWindow(event, opts.now, opts.days),
  );
  const premier = eligible.filter((event) => isPremier(event, opts.minPlayers));
  const premierIds = new Set(premier.map((event) => event.id));
  const skirmish = sampleSkirmishes(
    eligible.filter((event) => event.eventCategory === "skirmish" && !premierIds.has(event.id)),
    opts.skirmishSample,
  );
  return [...premier, ...skirmish].sort((a, b) => (b.startDatetime ?? "").localeCompare(a.startDatetime ?? ""));
}

export function normalizeListed(value: unknown): ListedEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  if (!Number.isFinite(id)) return null;
  const num = (key: string): number | null => (typeof row[key] === "number" ? (row[key] as number) : null);
  const str = (key: string): string | null => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    id,
    name: str("name") ?? str("nameEn") ?? "",
    startDatetime: str("startDatetime"),
    lifecycleStatus: str("lifecycleStatus"),
    source: str("source"),
    eventCategory: str("eventCategory"),
    gameplayFormatName: str("gameplayFormatName"),
    eventFormat: str("eventFormat"),
    startingPlayerCount: num("startingPlayerCount") ?? num("size"),
    registeredUserCount: num("registeredUserCount"),
  };
}

export function isKnownSource(source: string): source is RiftboundSource {
  return source === "all" || source === "uvs" || source === "playriftbound" || source === "topdeck" || source === "loltcg";
}
