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
const UA = { "User-Agent": "Mozilla/5.0 (compatible; comprel/1.0)" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A hung mtgo.com response must not stall the whole ingest (the scheduled run
// has a hard workflow timeout); abort any single request after this long.
const FETCH_TIMEOUT_MS = 15_000;

// Bail out of the event loop once the scrape has run this long; leftovers are
// picked up by the next cycle (or land via the volunteer cache anyway).
const SCRAPE_BUDGET_MS = 6 * 60_000;

/**
 * Fetch with retries on network errors and transient (5xx/429) responses. Returns
 * the Response — even a final non-ok one, so the caller can distinguish a 404 — or
 * null if every attempt threw at the network level.
 */
async function tryFetch(url: string, attempts = 3): Promise<Response | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok || res.status === 404 || a === attempts - 1) return res;
    } catch {
      if (a === attempts - 1) return null;
    }
    await sleep(700 * (a + 1));
  }
  return null;
}

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

  const url = d.url && d.url.startsWith("http") ? d.url : `${EVENT_URL}${slug}`;

  const Decks: RawDeck[] = decklists.map((dk) => ({
    Player: dk.player,
    Result: null,
    AnchorUri: url,
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

  return { Tournament: { Date: date, Name: d.description ?? slug, Uri: url, Formats: format }, Decks, Standings, Rounds };
}

export interface MtgoImportResult {
  indexOk: boolean;
  found: number; // tracked-format events discovered on the index
  events: number;
  decks: number;
  errors: number;
  // True only for a real, actionable break (listing 404 = URL moved, or events found
  // but none parseable = page structure changed). Transient network/5xx blips are NOT
  // structural failures — they self-heal next run, so they shouldn't alert.
  structuralFailure: boolean;
}

/** Scrape recent MTGO events (last `days`) for the tracked formats, straight from mtgo.com. */
export async function importMtgo(
  opts: { days?: number; log?: (m: string) => void; dryRun?: boolean } = {},
): Promise<MtgoImportResult> {
  const days = opts.days ?? 4;
  const log = opts.log ?? (() => {});
  const allow = new Set<Format>(FORMATS);
  const result: MtgoImportResult = { indexOk: false, found: 0, events: 0, decks: 0, errors: 0, structuralFailure: false };

  const idxRes = await tryFetch(INDEX_URL);
  if (!idxRes || !idxRes.ok) {
    const is404 = idxRes?.status === 404;
    result.structuralFailure = is404; // 404 = listing URL moved (actionable); transient/5xx = not
    log(
      is404
        ? "  ! MTGO listing returned 404 — the decklists URL changed; needs a code fix"
        : `  ! MTGO listing unreachable (${idxRes ? `HTTP ${idxRes.status}` : "network error"}) — transient, skipping this cycle`,
    );
    return result;
  }
  const indexHtml = await idxRes.text();
  result.indexOk = true;

  const slugs = [...new Set([...indexHtml.matchAll(/\/decklist\/([a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase()))];
  const cutoff = Date.now() - days * 86_400_000;
  const wanted = slugs.filter((s) => {
    const fmt = FORMAT_PREFIX[s.split("-")[0]];
    const dm = s.match(/(\d{4}-\d{2}-\d{2})/);
    return Boolean(fmt) && Boolean(dm) && new Date(dm![1] + "T00:00:00Z").getTime() >= cutoff;
  });
  result.found = wanted.length;
  log(`  MTGO: ${wanted.length} recent events in tracked formats`);

  const deadline = Date.now() + SCRAPE_BUDGET_MS;
  let bailedEarly = false;
  for (const slug of wanted) {
    if (Date.now() > deadline) {
      bailedEarly = true;
      log(`  ! MTGO: scrape time budget exhausted — remaining events resume next cycle`);
      break;
    }
    try {
      const res = await tryFetch(`${EVENT_URL}${slug}`, 2);
      if (!res || !res.ok) {
        result.errors++;
        continue;
      }
      const data = extractData(await res.text());
      if (!data || !data.decklists?.length) {
        result.errors++;
        continue;
      }
      const fmt = FORMAT_PREFIX[slug.split("-")[0]];
      const item = toCacheItem(data, fmt, slug);
      if (opts.dryRun) {
        result.events++;
        result.decks += item.Decks.length;
        const matches = (item.Rounds ?? []).reduce((n, r) => n + r.Matches.length, 0);
        log(`    [dry] ${fmt} ${slug}: ${item.Decks.length} decks, ${item.Standings?.length ?? 0} ranked, ${matches} playoff matches`);
      } else {
        const out = await importCacheItem("mtgo.com", slug, item, allow, fmt);
        if (out.imported) {
          result.events++;
          result.decks += out.decks;
        }
      }
    } catch (e) {
      result.errors++;
      log(`    ! MTGO ${slug}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 60)); // be polite to mtgo.com
  }
  // Found events on the listing but parsed none → the event-page structure changed.
  // (Not conclusive if the time budget cut the loop short — that's a transient.)
  if (!bailedEarly && result.found > 0 && result.events === 0) result.structuralFailure = true;
  log(`  MTGO: imported ${result.events} events, ${result.decks} decks (${result.errors} errors)`);
  return result;
}
