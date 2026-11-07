import { FORMATS, type Format } from "../types";
import type { FactExtras, StoredBanEvent } from "./types";

const SEARCH = "https://api.scryfall.com/cards/search";
const SCRY_FORMAT: Record<Format, string> = {
  Standard: "standard",
  Pioneer: "pioneer",
  Modern: "modern",
  Legacy: "legacy",
  Vintage: "vintage",
  Pauper: "pauper",
};

async function fetchNames(query: string): Promise<string[]> {
  const names = new Set<string>();
  let url: string | null = `${SEARCH}?q=${encodeURIComponent(query)}&unique=cards`;
  while (url) {
    const res = await fetch(url, { headers: { "User-Agent": "comprel-banlist", Accept: "application/json" } });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`scryfall ${res.status} for "${query}"`);
    const json = (await res.json()) as { data?: { name: string }[]; has_more?: boolean; next_page?: string };
    for (const card of json.data ?? []) names.add(card.name);
    url = json.has_more && json.next_page ? json.next_page : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return [...names].sort();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Diff Scryfall's current ban lists against the extras sidecar.
 * The first observation of a format records a baseline and does not invent history.
 * On failure the previous extras object is returned unchanged.
 */
export async function syncBansToExtras(extras: FactExtras, log: (message: string) => void = () => {}): Promise<FactExtras> {
  const next: FactExtras = {
    schemaVersion: 1,
    videos: extras.videos,
    videoRefreshedOn: extras.videoRefreshedOn,
    banEvents: [...extras.banEvents],
    banSnapshot: { ...extras.banSnapshot },
  };
  try {
    for (const format of FORMATS) {
      const key = SCRY_FORMAT[format];
      const banned = await fetchNames(`banned:${key}`);
      await new Promise((r) => setTimeout(r, 100));
      const restricted = await fetchNames(`restricted:${key}`);
      await new Promise((r) => setTimeout(r, 100));
      const prev = next.banSnapshot[format];
      if (!prev) {
        next.banSnapshot[format] = { banned, restricted };
        log(`  ${format}: ban baseline recorded (${banned.length} banned, ${restricted.length} restricted)`);
        continue;
      }
      const date = todayUtc();
      const events: StoredBanEvent[] = [];
      const prevBanned = new Set(prev.banned);
      const prevRestricted = new Set(prev.restricted);
      const curBanned = new Set(banned);
      const curRestricted = new Set(restricted);
      for (const card of banned) if (!prevBanned.has(card)) events.push({ format, date, card, action: "banned" });
      for (const card of prev.banned) if (!curBanned.has(card)) events.push({ format, date, card, action: "unbanned" });
      for (const card of restricted) if (!prevRestricted.has(card)) events.push({ format, date, card, action: "restricted" });
      for (const card of prev.restricted) if (!curRestricted.has(card)) events.push({ format, date, card, action: "unrestricted" });
      const seen = new Set(next.banEvents.map((e) => `${e.format}|${e.date}|${e.card}|${e.action}`));
      for (const event of events) {
        const id = `${event.format}|${event.date}|${event.card}|${event.action}`;
        if (seen.has(id)) continue;
        next.banEvents.push(event);
        seen.add(id);
      }
      next.banSnapshot[format] = { banned, restricted };
      if (events.length) log(`  ${format}: ${events.length} ban change(s)`);
    }
  } catch (error) {
    log(`  ! ban sync unchanged: ${(error as Error).message}`);
    return extras;
  }
  return next;
}
