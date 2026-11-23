import { importCacheItem } from "./mtgodecklistcache";
import { FORMATS, type Format, type RawCacheItem, type RawDeck, type RawDeckItem, type RawRound, type RawStanding } from "../types";

// Direct MTGO scraper. MTGO has no public API; Wizards publishes decklists on
// mtgo.com as pages that embed the full event as JSON in `window.MTGO.decklists.data`.
// We parse that and reuse importCacheItem with the page slug as the stable id — which
// is IDENTICAL to the filename the fbettega cache uses, so the same event ingested
// from either source upserts to one row (no double-counting). This lets us show
// same-day MTGO results hours before the volunteer cache commits them.

const INDEX_URL = "https://www.mtgo.com/decklists";
const EVENT_URL = "https://www.mtgo.com/decklist/";

export function mtgoEventUrl(slug: string): string {
  return `${EVENT_URL}${slug}`;
}

export type MtgoMissReason = "timeout" | "http" | "empty-decklists" | "parse" | "exception";

export interface MtgoMiss {
  slug: string;
  url: string;
  reason: MtgoMissReason;
  detail: string;
}

export type MtgoKnowledge = "absent" | "empty" | "lists";

export interface MtgoUnattempted {
  slug: string;
  url: string;
  reason: "budget" | "request-limit";
}

export type MtgoPageFetch =
  | { kind: "ok"; status: number; html: string }
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "network"; detail: string };

/** Classify a fetched event page. Empty decklists are an upstream gap, not a parse bug. */
export function diagnoseMtgoHtml(html: string): { ok: true; data: MtgoData } | { ok: false; reason: "empty-decklists" | "parse" } {
  const data = extractData(html);
  if (!data) return { ok: false, reason: "parse" };
  if (!data.decklists?.length) return { ok: false, reason: "empty-decklists" };
  return { ok: true, data };
}
const UA = { "User-Agent": "Mozilla/5.0 (compatible; comprel/1.0)" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A hung mtgo.com response must not stall the whole ingest (the scheduled run
// has a hard workflow timeout); abort any single request after this long.
const FETCH_TIMEOUT_MS = 15_000;

// Bail out of the event loop once the scrape has run this long. Events not
// started yet are unattempted, not misses. One request at a time.
const SCRAPE_BUDGET_MS = 6 * 60_000;

// Two tries for a timeout or a 200 with no embedded decklist. A parsed page
// that lists zero decks is not retried: that publication is empty.
const EVENT_ATTEMPTS = 2;
// A timeout or a parsed listing with no recent tracked events is retried on a
// short backoff. A 404 is not. A 200 with no decklist links uses the longer
// schedule below, and those retries bypass a cached empty body.
const INDEX_ATTEMPTS = 3;
const INDEX_BACKOFF_MS = 700;
const INDEX_EMPTY_BACKOFF_MS = [10_000, 30_000, 60_000] as const;
const INDEX_RETRY_HEADERS = { "Cache-Control": "no-cache", Pragma: "no-cache" };
const EVENT_BACKOFF_MS = 1_000;

// Fast failures must not walk the whole index. Hangs hit the time budget first.
const MAX_EVENT_REQUESTS = 80;

// Leading slug token -> tracked format. Others (premodern, contraption, …) are skipped.
const FORMAT_PREFIX: Record<string, Format> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
};

interface MtgoCard {
  qty: string;
  card_attributes?: { card_name?: string };
}
interface MtgoDeck {
  loginid: string | number;
  player: string;
  main_deck?: MtgoCard[];
  sideboard_deck?: MtgoCard[];
}
interface MtgoBracketPlayer {
  player: string;
  wins?: number;
  losses?: number;
}
interface MtgoData {
  description?: string;
  starttime?: string;
  url?: string;
  decklists?: MtgoDeck[];
  standings?: { loginid: string | number; rank: string }[];
  winloss?: { loginid: string | number; wins: string; losses: string }[];
  final_rank?: { loginid: string | number; rank: string }[];
  brackets?: { matches: { players: MtgoBracketPlayer[] }[] }[];
}

/** Pull the embedded `window.MTGO.decklists.data = {…};` object out of an event page. */
function extractData(html: string): MtgoData | null {
  const i = html.indexOf("window.MTGO.decklists.data");
  if (i < 0) return null;
  const start = html.indexOf("{", html.indexOf("=", i));
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, j + 1)) as MtgoData;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function toBoard(cards: MtgoCard[] | undefined): RawDeckItem[] {
  return (cards ?? [])
    .map((c) => ({ Count: Number(c.qty) || 0, CardName: c.card_attributes?.card_name ?? "" }))
    .filter((c) => c.CardName);
}

function toCacheItem(d: MtgoData, format: Format, slug: string): RawCacheItem {
  const decklists = d.decklists ?? [];
  const rankBy = new Map<string, number>();
  for (const s of d.standings ?? []) rankBy.set(String(s.loginid), Number(s.rank));
  for (const r of d.final_rank ?? []) rankBy.set(String(r.loginid), Number(r.rank)); // playoff finish wins
  const wlBy = new Map<string, { w: number; l: number }>();
  for (const w of d.winloss ?? []) wlBy.set(String(w.loginid), { w: Number(w.wins) || 0, l: Number(w.losses) || 0 });

  // The payload's `url` is the challenges index, not this event. The page we
  // fetched (`slug`) is the list. Per-player anchors match the cache's #deck_ form.
  const eventUrl = mtgoEventUrl(slug);

  const Decks: RawDeck[] = decklists.map((dk) => ({
    Player: dk.player,
    Result: null,
    AnchorUri: `${eventUrl}#deck_${dk.player}`,
    Mainboard: toBoard(dk.main_deck),
    Sideboard: toBoard(dk.sideboard_deck),
  }));

  const Standings: RawStanding[] = decklists.map((dk) => {
    const wl = wlBy.get(String(dk.loginid)) ?? { w: 0, l: 0 };
    return {
      Rank: rankBy.get(String(dk.loginid)) ?? 0,
      Player: dk.player,
      Points: 0,
      Wins: wl.w,
      Losses: wl.l,
      Draws: 0,
      OMWP: 0,
      GWP: 0,
      OGWP: 0,
    };
  });

  const Rounds: RawRound[] = (d.brackets ?? []).map((b, idx) => ({
    RoundName: `Playoffs R${idx + 1}`,
    Matches: (b.matches ?? [])
      .filter((m) => m.players?.length === 2)
      .map((m) => {
        const [p1, p2] = m.players;
        return { Player1: p1.player, Player2: p2.player, Result: `${p1.wins ?? 0}-${p2.wins ?? 0}` };
      }),
  }));

  const date = d.starttime
    ? new Date(d.starttime.replace(" ", "T").replace(/\.\d+$/, "") + "Z").toISOString()
    : new Date().toISOString();

  return { Tournament: { Date: date, Name: d.description ?? slug, Uri: eventUrl, Formats: format }, Decks, Standings, Rounds };
}

export interface MtgoFetchInit {
  headers?: Record<string, string>;
  cache?: RequestCache;
}

export interface MtgoImportResult {
  indexOk: boolean;
  /** Why a non-structural listing fetch failed. Absent when the index loaded or the failure is structural. */
  indexError?: string;
  /**
   * One-off HTTP 200 index with no decklist links. A repeat of that miss sets
   * structuralFailure instead and leaves this false.
   */
  listingEmpty: boolean;
  found: number; // tracked-format events discovered on the index
  /** Unique decklist slugs on a parsed listing. Zero when the index did not parse. */
  indexLinks: number;
  events: number;
  decks: number;
  errors: number;
  misses: MtgoMiss[];
  /** Index events already stored with a non-empty list. Not fetched and not misses. */
  skippedStored: number;
  /** Not requested. Separate from misses. */
  unattempted: MtgoUnattempted[];
  requests: number;
  // Listing 404, an empty-200 index that the previous published cycle also
  // recorded, or every fetched page was a 200 whose decklist embed was missing.
  // A one-off empty-200 index, timeouts, HTTP errors, empty decklists, an
  // unreachable listing, and a parsed listing with no recent tracked events
  // are partial and do not block publish.
  structuralFailure: boolean;
}

export interface MtgoDiagnosticMiss {
  ref: string;
  reason: string;
  detail?: string;
}

export interface MtgoSourceAssessment {
  mtgo: "ok" | "partial" | "unavailable";
  mtgoMissed: number;
  mtgoUnattempted: number;
  mtgoMisses?: { slug: string; url: string; reason: string }[];
  mtgoUnattemptedEvents?: MtgoUnattempted[];
  /** Rows for the private job summary. Includes one listing-level row when the index could not be fetched, was an empty 200, or had no recent tracked events. */
  diagnosticMisses: MtgoDiagnosticMiss[];
}

/**
 * Private coverage status for one scrape.
 * An unreachable listing is partial, with reason `listing-unreachable`.
 * A one-off 200 listing with no decklist links is partial, with reason `listing-empty`.
 * A parsed listing with no recent tracked events is partial, with reason `listing-stale`.
 * Structural failures stay unavailable. A fetched listing with recent events and no misses is ok.
 */
export function assessMtgoImport(scraped: MtgoImportResult): MtgoSourceAssessment {
  const eventMisses = scraped.misses.map((miss) => ({ slug: miss.slug, url: miss.url, reason: miss.reason }));
  const diagnosticMisses = scraped.misses.map((miss) => {
    const row: MtgoDiagnosticMiss = { ref: miss.url, reason: miss.reason };
    if (miss.detail) row.detail = miss.detail;
    return row;
  });
  if (scraped.structuralFailure) {
    return { mtgo: "unavailable", mtgoMissed: 0, mtgoUnattempted: 0, diagnosticMisses };
  }
  if (scraped.listingEmpty) {
    const reason = "listing-empty";
    const row: MtgoDiagnosticMiss = { ref: INDEX_URL, reason };
    if (scraped.indexError) row.detail = scraped.indexError;
    return {
      mtgo: "partial",
      mtgoMissed: 1,
      mtgoUnattempted: 0,
      mtgoMisses: [{ slug: "listing", url: INDEX_URL, reason }],
      diagnosticMisses: [row],
    };
  }
  if (!scraped.indexOk) {
    const reason = "listing-unreachable";
    const row: MtgoDiagnosticMiss = { ref: INDEX_URL, reason };
    if (scraped.indexError) row.detail = scraped.indexError;
    return {
      mtgo: "partial",
      mtgoMissed: 1,
      mtgoUnattempted: 0,
      mtgoMisses: [{ slug: "listing", url: INDEX_URL, reason }],
      diagnosticMisses: [row],
    };
  }
  if (scraped.found === 0) {
    const reason = "listing-stale";
    const row: MtgoDiagnosticMiss = { ref: INDEX_URL, reason, detail: `${scraped.indexLinks} decklist links` };
    return {
      mtgo: "partial",
      mtgoMissed: 1,
      mtgoUnattempted: 0,
      mtgoMisses: [{ slug: "listing", url: INDEX_URL, reason }],
      diagnosticMisses: [row],
    };
  }
  if (scraped.errors > 0 || scraped.unattempted.length > 0) {
    return {
      mtgo: "partial",
      mtgoMissed: scraped.errors,
      mtgoUnattempted: scraped.unattempted.length,
      ...(eventMisses.length ? { mtgoMisses: eventMisses } : {}),
      ...(scraped.unattempted.length ? { mtgoUnattemptedEvents: scraped.unattempted } : {}),
      diagnosticMisses,
    };
  }
  return { mtgo: "ok", mtgoMissed: 0, mtgoUnattempted: 0, diagnosticMisses };
}

/** True when a published cycle already recorded an empty-200 MTGO index. */
export function listingEmptyPersisted(misses: { reason: string }[] | undefined): boolean {
  return misses?.some((miss) => miss.reason === "listing-empty") ?? false;
}

export function mtgoSlugDay(slug: string): string | null {
  return slug.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/**
 * Same-day events go first (never stored, then stored without a list), then older
 * unseen events, then older events stored without a list. Events with a list are omitted.
 */
export function prioritizeMtgoSlugs(
  slugs: string[],
  known: (slug: string) => MtgoKnowledge,
  today: string,
): { queue: string[]; skippedStored: string[] } {
  const skippedStored: string[] = [];
  const queue: { slug: string; day: string; rank: number }[] = [];
  for (const slug of slugs) {
    const state = known(slug);
    if (state === "lists") {
      skippedStored.push(slug);
      continue;
    }
    const day = mtgoSlugDay(slug) ?? "";
    const sameDay = day === today;
    const rank = sameDay ? (state === "absent" ? 0 : 1) : state === "absent" ? 2 : 3;
    queue.push({ slug, day, rank });
  }
  queue.sort((a, b) => a.rank - b.rank || b.day.localeCompare(a.day) || a.slug.localeCompare(b.slug));
  return { queue: queue.map((row) => row.slug), skippedStored };
}

function describeFetch(page: MtgoPageFetch): string {
  if (page.kind === "timeout") return "timeout";
  if (page.kind === "network") return page.detail || "network";
  if (page.kind === "http") return `HTTP ${page.status}`;
  return "ok";
}

function retryableFetch(page: MtgoPageFetch): boolean {
  if (page.kind === "timeout" || page.kind === "network") return true;
  return page.kind === "http" && page.status !== 404 && (page.status === 429 || page.status >= 500);
}

function decklistSlugs(html: string): string[] {
  return [...new Set([...html.matchAll(/\/decklist\/([a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase()))];
}

function trackedSlugInWindow(slug: string, cutoffMs: number): boolean {
  const fmt = FORMAT_PREFIX[slug.split("-")[0]];
  const day = mtgoSlugDay(slug);
  return Boolean(fmt) && Boolean(day) && new Date(day + "T00:00:00Z").getTime() >= cutoffMs;
}

/** A 200 listing worth another fetch: no decklist links, or none in the recent tracked window. */
function indexListingProblem(html: string, cutoffMs: number): "no-links" | "no-recent" | null {
  if (!/\/decklist\//i.test(html)) return "no-links";
  return decklistSlugs(html).some((slug) => trackedSlugInWindow(slug, cutoffMs)) ? null : "no-recent";
}

async function defaultFetchPage(url: string, init?: MtgoFetchInit): Promise<MtgoPageFetch> {
  try {
    const res = await fetch(url, {
      headers: { ...UA, ...init?.headers },
      ...(init?.cache ? { cache: init.cache } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: "http", status: res.status };
    return { kind: "ok", status: res.status, html: await res.text() };
  } catch (error) {
    const name = (error as { name?: string; message?: string }).name ?? "";
    const message = (error as { message?: string }).message ?? "";
    if (name === "TimeoutError" || name === "AbortError" || /timeout/i.test(message)) return { kind: "timeout" };
    return { kind: "network", detail: message.slice(0, 120) || name || "network" };
  }
}

/** Scrape recent MTGO events (last `days`) for the tracked formats, straight from mtgo.com. */
export async function importMtgo(
  opts: {
    days?: number;
    log?: (m: string) => void;
    dryRun?: boolean;
    /** When set, events are handed to the caller instead of written to Postgres. */
    onItem?: (item: RawCacheItem, slug: string, format: Format) => Promise<void> | void;
    /** Test hook. Default fetches mtgo.com. One request at a time. */
    fetchPage?: (url: string, init?: MtgoFetchInit) => Promise<MtgoPageFetch>;
    /** `lists` events are not fetched. Default treats every slug as unseen. */
    known?: (slug: string) => MtgoKnowledge;
    /** UTC day used for same-day priority. */
    today?: string;
    /**
     * Published cycles in a row that already ended on an empty-200 index.
     * Zero records this cycle as a partial `listing-empty` miss. One or more
     * treats another empty-200 index as a structural markup change. Scheduled
     * backfill passes 1 when the published snapshot already has that miss.
     */
    priorEmptyListings?: number;
    now?: () => number;
    budgetMs?: number;
    maxEventRequests?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MtgoImportResult> {
  const days = opts.days ?? 4;
  const log = opts.log ?? (() => {});
  const allow = new Set<Format>(FORMATS);
  const known = opts.known ?? (() => "absent" as const);
  const clock = opts.now ?? Date.now;
  const pause = opts.sleep ?? sleep;
  const budgetMs = opts.budgetMs ?? SCRAPE_BUDGET_MS;
  const maxEventRequests = opts.maxEventRequests ?? MAX_EVENT_REQUESTS;
  const result: MtgoImportResult = {
    indexOk: false,
    listingEmpty: false,
    found: 0,
    indexLinks: 0,
    events: 0,
    decks: 0,
    errors: 0,
    misses: [],
    skippedStored: 0,
    unattempted: [],
    requests: 0,
    structuralFailure: false,
  };
  const fetchPage = opts.fetchPage ?? defaultFetchPage;

  const cutoff = clock() - days * 86_400_000;
  let indexPage: MtgoPageFetch = { kind: "network", detail: "no attempt" };
  let parsedHtml: string | null = null;
  let sawLinklessOk = false;
  let emptyTries = 0;
  let otherTries = 0;
  let nextIndex: { url: string; init?: MtgoFetchInit } = { url: INDEX_URL };
  const persistentEmpty = (opts.priorEmptyListings ?? 0) > 0;
  while (emptyTries <= INDEX_EMPTY_BACKOFF_MS.length && otherTries < INDEX_ATTEMPTS) {
    indexPage = await fetchPage(nextIndex.url, nextIndex.init);
    if (indexPage.kind === "http" && indexPage.status === 404) {
      result.structuralFailure = true;
      log("  ! MTGO listing returned 404 — the decklists URL changed; needs a code fix");
      return result;
    }
    if (indexPage.kind === "ok") {
      const problem = indexListingProblem(indexPage.html, cutoff);
      if (problem === "no-links") {
        sawLinklessOk = true;
        const delay = INDEX_EMPTY_BACKOFF_MS[emptyTries];
        emptyTries++;
        if (delay == null) break;
        log(`  ! MTGO listing attempt ${emptyTries} failed (200 with no decklist links) — retrying`);
        await pause(delay);
        nextIndex = {
          url: `${INDEX_URL}?comprel-retry=${emptyTries}`,
          init: { headers: { ...INDEX_RETRY_HEADERS }, cache: "no-store" },
        };
        continue;
      }
      parsedHtml = indexPage.html;
      if (!problem) break;
      otherTries++;
      if (otherTries >= INDEX_ATTEMPTS) break;
      log(`  ! MTGO listing attempt ${otherTries} failed (0 recent events in tracked formats) — retrying`);
      await pause(INDEX_BACKOFF_MS * otherTries);
      nextIndex = { url: INDEX_URL };
      continue;
    }
    if (!retryableFetch(indexPage)) break;
    otherTries++;
    if (otherTries >= INDEX_ATTEMPTS) break;
    log(`  ! MTGO listing attempt ${otherTries} failed (${describeFetch(indexPage)}) — retrying`);
    await pause(INDEX_BACKOFF_MS * otherTries);
    nextIndex = { url: INDEX_URL };
  }
  if (!parsedHtml) {
    if (sawLinklessOk) {
      if (persistentEmpty) {
        result.structuralFailure = true;
        log("  ! MTGO listing returned 200 but no decklist links on consecutive published cycles — the index markup changed");
        return result;
      }
      result.listingEmpty = true;
      result.indexError = "200 with no decklist links";
      log("  ! MTGO listing returned 200 but no decklist links — transient, skipping this cycle");
      return result;
    }
    result.indexError = describeFetch(indexPage);
    log(`  ! MTGO listing unreachable after ${INDEX_ATTEMPTS} attempts (${result.indexError}) — transient, skipping this cycle`);
    return result;
  }
  const indexHtml = parsedHtml;
  result.indexOk = true;

  const today = opts.today ?? new Date(clock()).toISOString().slice(0, 10);
  const slugs = decklistSlugs(indexHtml);
  result.indexLinks = slugs.length;
  const wanted = slugs.filter((slug) => trackedSlugInWindow(slug, cutoff));
  result.found = wanted.length;
  const ordered = prioritizeMtgoSlugs(wanted, known, today);
  result.skippedStored = ordered.skippedStored.length;
  log(
    `  MTGO: ${wanted.length} recent events in tracked formats; ${ordered.skippedStored.length} already stored with lists, ${ordered.queue.length} to fetch`,
  );
  if (wanted.length === 0) {
    log(`  ! MTGO listing had 0 recent events in tracked formats (${slugs.length} decklist links)`);
  }

  const deadline = clock() + budgetMs;
  let stop: MtgoUnattempted["reason"] | null = null;
  for (let i = 0; i < ordered.queue.length; i++) {
    if (clock() > deadline) stop = "budget";
    else if (result.requests >= maxEventRequests) stop = "request-limit";
    if (stop) {
      for (const slug of ordered.queue.slice(i)) {
        const url = mtgoEventUrl(slug);
        result.unattempted.push({ slug, url, reason: stop });
        log(`    ! MTGO ${url} unattempted ${stop}`);
      }
      log(
        stop === "budget"
          ? "  ! MTGO: scrape time budget exhausted — remaining events were not requested"
          : "  ! MTGO: event request cap reached — remaining events were not requested",
      );
      break;
    }
    const slug = ordered.queue[i]!;
    const url = mtgoEventUrl(slug);
    const miss = (reason: MtgoMissReason, detail: string) => {
      result.errors++;
      result.misses.push({ slug, url, reason, detail });
      log(`    ! MTGO ${url} ${reason}${detail ? ` ${detail}` : ""}`);
    };
    try {
      let page: MtgoPageFetch = { kind: "network", detail: "no attempt" };
      for (let attempt = 0; attempt < EVENT_ATTEMPTS; attempt++) {
        if (result.requests >= maxEventRequests) break;
        page = await fetchPage(url);
        result.requests++;
        if (page.kind === "ok") {
          const diagnosed = diagnoseMtgoHtml(page.html);
          if (diagnosed.ok || diagnosed.reason === "empty-decklists") break;
        } else if (!retryableFetch(page)) break;
        if (attempt === EVENT_ATTEMPTS - 1) break;
        await pause(EVENT_BACKOFF_MS * (attempt + 1));
      }
      if (page.kind === "timeout" || page.kind === "network") {
        miss("timeout", "exhausted retries");
        continue;
      }
      if (page.kind === "http") {
        miss("http", String(page.status));
        continue;
      }
      const diagnosed = diagnoseMtgoHtml(page.html);
      if (!diagnosed.ok) {
        miss(diagnosed.reason, diagnosed.reason === "parse" ? "no embedded decklist after retries" : "");
        continue;
      }
      const fmt = FORMAT_PREFIX[slug.split("-")[0]];
      const item = toCacheItem(diagnosed.data, fmt, slug);
      if (opts.dryRun) {
        result.events++;
        result.decks += item.Decks.length;
        const matches = (item.Rounds ?? []).reduce((n, r) => n + r.Matches.length, 0);
        log(`    [dry] ${fmt} ${slug}: ${item.Decks.length} decks, ${item.Standings?.length ?? 0} ranked, ${matches} playoff matches`);
      } else if (opts.onItem) {
        await opts.onItem(item, slug, fmt);
        result.events++;
        result.decks += item.Decks.length;
      } else {
        const out = await importCacheItem("mtgo.com", slug, item, allow, fmt);
        if (out.imported) {
          result.events++;
          result.decks += out.decks;
        }
      }
    } catch (e) {
      miss("exception", (e as Error).message.slice(0, 160));
    }
    await pause(60);
  }
  // Structure change: every page we fetched was a 200 with no usable embed.
  // Timeouts, HTTP errors, and empty decklists stay partial so the cache import can publish.
  const embedMissing =
    stop === null &&
    result.events === 0 &&
    result.misses.length > 0 &&
    result.misses.every((miss) => miss.reason === "parse");
  if (embedMissing) result.structuralFailure = true;
  const byReason = new Map<string, number>();
  for (const item of result.misses) byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1);
  const reasonText = [...byReason.entries()].map(([reason, n]) => `${reason} ${n}`).join(", ");
  const parts = [
    `imported ${result.events} events, ${result.decks} decks`,
    `skipped ${result.skippedStored} already stored`,
    result.errors ? `missed ${result.errors} (${reasonText})` : "missed 0",
    `unattempted ${result.unattempted.length}`,
  ];
  log(`  MTGO: ${parts.join("; ")}. Previously stored lists were kept.`);
  return result;
}
