import { prisma } from "../db";
import { FORMATS, type Format } from "../types";

// Detects Banned & Restricted changes by diffing Scryfall's legality data — no HTML
// scraping. Scryfall updates a card's legality within hours of a WotC B&R announcement,
// so the 6-hour ingest picks up changes promptly. https://scryfall.com/docs/api/cards/search

const SEARCH = "https://api.scryfall.com/cards/search";

const SCRY_FORMAT: Record<Format, string> = {
  Standard: "standard",
  Pioneer: "pioneer",
  Modern: "modern",
  Legacy: "legacy",
  Vintage: "vintage",
  Pauper: "pauper",
};

interface ScrySearch {
  data?: { name: string }[];
  has_more?: boolean;
  next_page?: string;
}

/** All card names matching a Scryfall query (e.g. "banned:modern"), following pagination. */
async function fetchNames(query: string): Promise<string[]> {
  const names = new Set<string>();
  let url: string | null = `${SEARCH}?q=${encodeURIComponent(query)}&unique=cards`;
  while (url) {
    const res = await fetch(url, { headers: { "User-Agent": "comprel-banlist", Accept: "application/json" } });
    if (res.status === 404) return []; // Scryfall 404s when a search matches nothing
    if (!res.ok) throw new Error(`scryfall ${res.status} for "${query}"`);
    const json = (await res.json()) as ScrySearch;
    for (const c of json.data ?? []) names.add(c.name);
    url = json.has_more && json.next_page ? json.next_page : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return [...names].sort();
}

/** Today's date at midnight UTC, so same-day re-runs collapse to one marker. */
function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
}

/**
 * For each format, compare Scryfall's current banned/restricted lists to the stored
 * snapshot and record any change as a dated BanEvent. The first run for a format just
 * records the baseline (no events) — existing bans are historical, not "new".
 */
export async function syncBanlist(log: (m: string) => void = () => {}): Promise<{ detected: number }> {
  let detected = 0;
  for (const format of FORMATS) {
    const f = SCRY_FORMAT[format];
    let banned: string[];
    let restricted: string[];
    try {
      banned = await fetchNames(`banned:${f}`);
      await new Promise((r) => setTimeout(r, 100));
      restricted = await fetchNames(`restricted:${f}`);
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      log(`  ! ${format}: ${(e as Error).message}`);
      continue;
    }

    const prev = await prisma.banSnapshot.findUnique({ where: { format } });
    if (!prev) {
      await prisma.banSnapshot.create({ data: { format, banned, restricted } });
      log(`  ${format}: baseline recorded (${banned.length} banned, ${restricted.length} restricted)`);
      continue;
    }

    const prevBanned = new Set((prev.banned as string[]) ?? []);
    const prevRestricted = new Set((prev.restricted as string[]) ?? []);
    const curBanned = new Set(banned);
    const curRestricted = new Set(restricted);
    const date = todayUtc();

    const events: { format: string; date: Date; card: string; action: string }[] = [];
    for (const c of curBanned) if (!prevBanned.has(c)) events.push({ format, date, card: c, action: "banned" });
    for (const c of prevBanned) if (!curBanned.has(c)) events.push({ format, date, card: c, action: "unbanned" });
    for (const c of curRestricted) if (!prevRestricted.has(c)) events.push({ format, date, card: c, action: "restricted" });
    for (const c of prevRestricted) if (!curRestricted.has(c)) events.push({ format, date, card: c, action: "unrestricted" });

    if (events.length > 0) {
      await prisma.banEvent.createMany({ data: events, skipDuplicates: true });
      detected += events.length;
      log(`  ${format}: ${events.length} change(s) — ${events.map((e) => `${e.card} ${e.action}`).join("; ")}`);
    }
    await prisma.banSnapshot.update({ where: { format }, data: { banned, restricted, updatedAt: new Date() } });
  }
  return { detected };
}
