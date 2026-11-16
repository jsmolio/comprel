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

export interface SelectOptions {
  now: Date;
  days: number;
  minPlayers: number;
}

function inWindow(event: ListedEvent, now: Date, days: number): boolean {
  if (!event.startDatetime) return false;
  const time = Date.parse(event.startDatetime);
  if (Number.isNaN(time)) return false;
  const start = now.getTime() - days * 86_400_000;
  return time >= start && time <= now.getTime() + 86_400_000;
}

/**
 * Every finished constructed event in the window at the field floor.
 * Premier, side, and skirmish events use that same floor. Team, sealed, and
 * draft events stay out. A legend floor applied after standings are read drops
 * events that do not name enough legends to move a share.
 */
export function selectIngestEvents(events: readonly ListedEvent[], opts: SelectOptions): ListedEvent[] {
  return events
    .filter(
      (event) =>
        event.lifecycleStatus === "EVENT_FINISHED" &&
        isConstructedSolo(event) &&
        fieldSize(event) >= opts.minPlayers &&
        inWindow(event, opts.now, opts.days),
    )
    .sort((a, b) => (b.startDatetime ?? "").localeCompare(a.startDatetime ?? ""));
}

/** First listing wins. Later listings fill only fields the first one left empty. */
export function mergeListed(groups: readonly (readonly ListedEvent[])[]): ListedEvent[] {
  const byId = new Map<number, ListedEvent>();
  for (const group of groups) {
    for (const event of group) {
      const prev = byId.get(event.id);
      if (!prev) {
        byId.set(event.id, event);
        continue;
      }
      byId.set(event.id, {
        ...prev,
        name: prev.name || event.name,
        startDatetime: prev.startDatetime ?? event.startDatetime,
        lifecycleStatus: prev.lifecycleStatus ?? event.lifecycleStatus,
        source: prev.source ?? event.source,
        eventCategory: prev.eventCategory ?? event.eventCategory,
        gameplayFormatName: prev.gameplayFormatName ?? event.gameplayFormatName,
        eventFormat: prev.eventFormat ?? event.eventFormat,
        startingPlayerCount: prev.startingPlayerCount ?? event.startingPlayerCount,
        registeredUserCount: prev.registeredUserCount ?? event.registeredUserCount,
      });
    }
  }
  return [...byId.values()];
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
