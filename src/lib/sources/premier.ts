import { classifierVersion } from "../facts/classifier-version";
import { normalizeCacheItem } from "../facts/normalize";
import type { FactStore } from "../facts/store";
import type { FactEvent, PlayerBoard } from "../facts/types";
import { detectFormat } from "../format";
import { FORMATS, type Format } from "../types";
import {
  alignToDeck,
  buildPremierItem,
  bundleFromItem,
  datesClose,
  decodeJsEscapes,
  discoverPremierLinks,
  draftRoundNumbers,
  isoDate,
  meleeIdFromText,
  matchOfficialName,
  mergeRosterLists,
  parseMagicDecklists,
  parseMagicRoundResults,
  parseMagicStandings,
  parseMeleeMatchPage,
  parseMeleeTournament,
  parseRobots,
  parseSchedulePhases,
  premierKey,
  robotsAllow,
  type LabeledRound,
  type ParsedDeck,
  type PremierBundle,
  type RobotsRules,
  type RosterList,
} from "./premier-parse";

/**
 * Same-day Pro Tours and World Championships.
 * Decklists come from magic.gg. Melee public tournament pages supply pairings
 * when we know the tournament id, and they are the fallback when magic.gg has
 * not posted lists or results yet. A failure here is a diagnostic miss. It
 * must not fail the Magic ingest.
 */

const MAGIC_ORIGIN = "https://magic.gg";
const MELEE_ORIGIN = "https://melee.gg";
const USER_AGENT = "Mozilla/5.0 (compatible; comprel/1.0; +https://github.com/jsmolio/comprel)";

/** Safety cap. Upgraded events are skipped first, so a later run retries the rest. */
const MAX_EVENTS = 8;
const MAX_MAGIC = 48;
const MAX_MELEE = 40;
const BUDGET_MS = 180_000;
/** Premier pages are fetched for this many days, not the full cache window. */
export const PREMIER_LOOKBACK_DAYS = 14;
const MAGIC_GAP_MS = 300;
const PAGE_TIMEOUT_MS = 20_000;

/** Used only when melee.gg/robots.txt cannot be read. These paths are disallowed there today. */
const MELEE_DISALLOW_FALLBACK = [
  "/decklist/view/",
  "/decklist/index/",
  "/decklist/searchcardnames/",
  "/tournament/search/",
  "/tournament/searchresults/",
  "/scripts/",
];

export interface PremierMiss {
  ref: string;
  reason: string;
  detail?: string;
}

export interface PremierTop {
  rank: number | null;
  player: string;
  archetype: string;
}

export interface PremierEventReport {
  id: string;
  name: string;
  format: string;
  date: string;
  decks: number;
  matches: number;
  draftRounds: number[];
  constructedRounds: string[];
  meleeId: number | null;
  kept: "incoming" | "stored";
  top: PremierTop[];
}

export interface PremierRunResult {
  events: PremierEventReport[];
  misses: PremierMiss[];
  unattempted: PremierMiss[];
  requests: { magic: number; melee: number };
  /** Constructed lists dropped because the main deck had fewer than 60 cards. */
  droppedLists: { ref: string; dropped: number }[];
  /** Cache names that did not uniquely match the magic.gg roster. Private diagnostic only. */
  unmatchedNames: { ref: string; name: string }[];
}

export type FetchInit = { method: "GET" | "POST"; body?: string; headers?: Record<string, string> };
type FetchResponse = { status: number; text: string };
type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface PremierImportOptions {
  store?: FactStore;
  days?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
  now?: () => number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxEvents?: number;
  maxMagic?: number;
  maxMelee?: number;
  /** Overrides the Melee crawl-delay. Tests pass 0. */
  meleeDelayMs?: number;
  magicDelayMs?: number;
}

const emptyResult = (): PremierRunResult => ({
  events: [],
  misses: [],
  unattempted: [],
  requests: { magic: 0, melee: 0 },
  droppedLists: [],
  unmatchedNames: [],
});

function absolute(href: string, origin: string): string | null {
  try {
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}

async function defaultFetch(url: string, init: FetchInit): Promise<FetchResponse> {
  const res = await fetch(url, {
    method: init.method,
    body: init.body,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...init.headers },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    redirect: "follow",
  });
  return { status: res.status, text: await res.text() };
}

export async function importPremierEvents(opts: PremierImportOptions = {}): Promise<PremierRunResult> {
  const log = opts.log ?? (() => {});
  try {
    return await runPremier(opts, log);
  } catch (error) {
    const detail = (error as Error).message?.slice(0, 180) || "unknown";
    log(`  ! premier events skipped: ${detail}`);
    const result = emptyResult();
    result.misses.push({ ref: MAGIC_ORIGIN, reason: "exception", detail });
    return result;
  }
}

async function runPremier(opts: PremierImportOptions, log: (message: string) => void): Promise<PremierRunResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchPage = opts.fetch ?? defaultFetch;
  const days = opts.days ?? PREMIER_LOOKBACK_DAYS;
  const budgetMs = opts.budgetMs ?? BUDGET_MS;
  const maxEvents = opts.maxEvents ?? MAX_EVENTS;
  const maxMagic = opts.maxMagic ?? MAX_MAGIC;
  const maxMelee = opts.maxMelee ?? MAX_MELEE;
  const started = now();
  const result = emptyResult();
  const allow = new Set<Format>(FORMATS);
  const version = classifierVersion();

  const budget = {
    magic: 0,
    melee: 0,
    stop: null as "budget" | "request-limit" | null,
  };

  const noteStop = (kind: "magic" | "melee", url: string) => {
    const reason = budget.stop === "budget" ? "budget" : "request-limit";
    result.unattempted.push({ ref: url, reason, detail: kind });
  };

  const load = async (kind: "magic" | "melee", url: string, init: FetchInit, delayMs: number): Promise<string | null> => {
    if (now() - started > budgetMs) budget.stop = "budget";
    if (kind === "magic" && budget.magic >= maxMagic) budget.stop = budget.stop ?? "request-limit";
    if (kind === "melee" && budget.melee >= maxMelee) budget.stop = budget.stop ?? "request-limit";
    if (budget.stop) {
      noteStop(kind, url);
      return null;
    }
    if (delayMs > 0 && (kind === "melee" ? budget.melee > 0 : budget.magic > 0)) await sleep(delayMs);
    try {
      const response = await fetchPage(url, init);
      if (kind === "magic") budget.magic++;
      else budget.melee++;
      result.requests[kind]++;
      if (response.status === 200 && response.text.trim()) return response.text;
      result.misses.push({ ref: url, reason: "http", detail: String(response.status) });
      return null;
    } catch (error) {
      if (kind === "magic") budget.magic++;
      else budget.melee++;
      result.requests[kind]++;
      const message = (error as Error).message ?? "";
      const reason = /timeout|abort/i.test(message) ? "timeout" : "network";
      result.misses.push({ ref: url, reason, detail: message.slice(0, 120) });
      return null;
    }
  };

  const magicRules = await loadRobots(load, "magic", `${MAGIC_ORIGIN}/robots.txt`, { crawlDelaySec: 0, disallowed: [] });
  const meleeRules = await loadRobots(load, "melee", `${MELEE_ORIGIN}/robots.txt`, {
    crawlDelaySec: 5,
    disallowed: MELEE_DISALLOW_FALLBACK,
  });
  const magicDelay = opts.magicDelayMs ?? Math.max(MAGIC_GAP_MS, magicRules.crawlDelaySec * 1000);
  const meleeDelay = opts.meleeDelayMs ?? Math.max(5_000, meleeRules.crawlDelaySec * 1000);

  const guarded = async (kind: "magic" | "melee", url: string, init: FetchInit): Promise<string | null> => {
    const rules = kind === "magic" ? magicRules : meleeRules;
    if (!robotsAllow(rules.disallowed, url)) {
      result.misses.push({ ref: url, reason: "robots", detail: "disallowed" });
      return null;
    }
    return load(kind, url, init, kind === "magic" ? magicDelay : meleeDelay);
  };

  const index = await guarded("magic", `${MAGIC_ORIGIN}/decklists`, { method: "GET" });
  if (!index) {
    log("  premier: magic.gg decklist index unavailable");
    return result;
  }
  const groups = groupLinks(discoverPremierLinks(index), now(), days);
  const upgraded = upgradedPremierKeys(opts.store);
  const pending = groups.filter((group) => !upgraded.has(group.key));
  const queue = pending.slice(0, maxEvents);
  for (const skipped of pending.slice(maxEvents)) {
    result.unattempted.push({ ref: skipped.urls[0] ?? skipped.key, reason: "request-limit", detail: "event cap" });
  }
  log(`  premier: ${groups.length} recent event(s), ${upgraded.size} already upgraded, fetching ${queue.length}`);

  for (const group of queue) {
    try {
      const report = await ingestGroup({
        group,
        guarded,
        result,
        store: opts.store,
        dryRun: Boolean(opts.dryRun),
        days,
        now: now(),
        allow,
        version,
        log,
      });
      if (report) result.events.push(report);
    } catch (error) {
      result.misses.push({
        ref: group.urls[0] ?? group.key,
        reason: "exception",
        detail: (error as Error).message?.slice(0, 160) || "event failed",
      });
    }
  }

  const kept = result.events.filter((event) => event.kept === "incoming").length;
  log(
    `  premier: ${result.events.length} event(s), ${kept} ${opts.dryRun ? "ready" : "updated"}, magic ${result.requests.magic} request(s), melee ${result.requests.melee} request(s), missed ${result.misses.length}`,
  );
  return result;
}

async function loadRobots(
  load: (kind: "magic" | "melee", url: string, init: FetchInit, delayMs: number) => Promise<string | null>,
  kind: "magic" | "melee",
  url: string,
  fallback: RobotsRules,
): Promise<RobotsRules> {
  const text = await load(kind, url, { method: "GET" }, 0);
  if (!text) return fallback;
  const parsed = parseRobots(text);
  if (kind === "melee" && parsed.disallowed.length === 0) return { ...parsed, disallowed: fallback.disallowed };
  return parsed;
}

interface LinkGroup {
  key: string;
  day: string | null;
  urls: string[];
}

function groupLinks(links: { url: string; day: string | null; key: string }[], nowMs: number, days: number): LinkGroup[] {
  const cutoff = nowMs - days * 86_400_000;
  const groups = new Map<string, LinkGroup>();
  for (const link of links) {
    if (link.day) {
      const time = Date.parse(`${link.day}T00:00:00.000Z`);
      if (Number.isFinite(time) && time < cutoff) continue;
    }
    const group = groups.get(link.key) ?? { key: link.key, day: link.day, urls: [] };
    if (link.day && (!group.day || link.day > group.day)) group.day = link.day;
    if (!group.urls.includes(link.url)) group.urls.push(link.url);
    groups.set(link.key, group);
  }
  const dated = [...groups.values()].filter((group) => group.day);
  const pool = dated.length ? dated : [...groups.values()];
  return pool.sort((a, b) => (a.day === b.day ? a.key.localeCompare(b.key) : a.day && b.day ? (a.day < b.day ? 1 : -1) : a.day ? -1 : 1));
}

interface IngestGroupInput {
  group: LinkGroup;
  guarded: (kind: "magic" | "melee", url: string, init: FetchInit) => Promise<string | null>;
  result: PremierRunResult;
  store?: FactStore;
  dryRun: boolean;
  days: number;
  now: number;
  allow: Set<Format>;
  version: string;
  log: (message: string) => void;
}

async function ingestGroup(input: IngestGroupInput): Promise<PremierEventReport | null> {
  const pages: string[] = [];
  const seen = new Set<string>();
  const queue = [...input.group.urls];
  const decks: ParsedDeck[] = [];
  while (queue.length && pages.length < 6) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await input.guarded("magic", url, { method: "GET" });
    if (!html) continue;
    pages.push(html);
    const parsed = parseMagicDecklists(html);
    if (parsed.length === 0) {
      for (const link of discoverPremierLinks(html)) {
        if (link.key === input.group.key && !seen.has(link.url)) queue.push(link.url);
      }
    }
    decks.push(...parsed);
  }
  if (decks.length === 0) {
    input.result.misses.push({ ref: input.group.urls[0] ?? input.group.key, reason: "no-lists", detail: "magic.gg posted no deck-list blocks" });
    return null;
  }

  const format = majorityFormat(decks);
  if (!format || !input.allow.has(format)) {
    input.result.misses.push({ ref: input.group.urls[0] ?? input.group.key, reason: "parse", detail: "format not tracked" });
    return null;
  }
  const eventDay = decks.find((deck) => deck.eventDay)?.eventDay ?? input.group.day;
  if (eventDay) {
    const time = Date.parse(`${eventDay}T00:00:00.000Z`);
    if (Number.isFinite(time) && time < input.now - input.days * 86_400_000) return null;
  }

  const html = pages.join("\n");
  const eventUrl = firstUrl(html, input.group.key, "/events/");
  let eventHtml = "";
  if (eventUrl) eventHtml = (await input.guarded("magic", eventUrl, { method: "GET" })) ?? "";
  const combined = `${html}\n${eventHtml}`;
  const factUrl = firstUrl(combined, input.group.key, "fact-sheet");
  const standingUrl = firstUrl(combined, input.group.key, "final-standings") ?? firstUrl(combined, input.group.key, "standings");
  const factHtml = factUrl ? ((await input.guarded("magic", factUrl, { method: "GET" })) ?? "") : "";
  const standingHtml = standingUrl && !/round-\d+-standings/i.test(standingUrl) ? ((await input.guarded("magic", standingUrl, { method: "GET" })) ?? "") : "";
  const phases = parseSchedulePhases(factHtml);
  const draftNumbers = phases.length ? draftRoundNumbers(phases) : null;
  const standings = parseMagicStandings(standingHtml);

  const meleeId = meleeIdFromText(`${combined}\n${factHtml}`) ?? meleeIdFromStore(input.store, input.group.key, format, eventDay);
  const rounds: LabeledRound[] = [];
  if (meleeId) {
    const meleeHtml = await input.guarded("melee", `${MELEE_ORIGIN}/Tournament/View/${meleeId}`, { method: "GET" });
    const page = meleeHtml ? parseMeleeTournament(meleeHtml) : null;
    const refs = page?.rounds ?? [];
    for (const ref of refs) {
      const body = await input.guarded("melee", `${MELEE_ORIGIN}/Match/GetRoundMatches/${ref.id}`, {
        method: "POST",
        body: "draw=1&start=0&length=300",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Origin: MELEE_ORIGIN,
          Referer: `${MELEE_ORIGIN}/Tournament/View/${meleeId}`,
        },
      });
      if (!body) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        input.result.misses.push({ ref: `${MELEE_ORIGIN}/Match/GetRoundMatches/${ref.id}`, reason: "parse", detail: ref.name });
        continue;
      }
      const round = parseMeleeMatchPage(parsed, ref.name);
      if (!round) {
        input.result.misses.push({ ref: `${MELEE_ORIGIN}/Match/GetRoundMatches/${ref.id}`, reason: "parse", detail: ref.name });
        continue;
      }
      rounds.push(round);
    }
  }

  if (rounds.length === 0) {
    const resultLinks = resultLinksFor(combined, input.group.key, draftNumbers);
    for (const link of resultLinks) {
      const page = await input.guarded("magic", link.url, { method: "GET" });
      if (!page) continue;
      const matches = parseMagicRoundResults(page).map((row) => ({ Player1: row.player, Player2: row.opponent, Result: row.result }));
      if (matches.length === 0) continue;
      rounds.push({ name: `Round ${link.round}`, number: link.round, format: null, matches });
    }
    if (rounds.length === 0) {
      input.result.misses.push({
        ref: eventUrl ?? input.group.urls[0] ?? input.group.key,
        reason: "no-pairings",
        detail: meleeId ? "melee and magic.gg pairings were empty" : "no public melee id; magic.gg pairings were empty",
      });
    }
  }

  const eventName = decks.find((deck) => deck.eventName)?.eventName ?? input.group.key;
  const date = isoDate(eventDay ? `${eventDay}T12:00:00.000Z` : null) ?? new Date(input.now).toISOString();
  const built = buildPremierItem({
    name: eventName,
    date,
    uri: eventUrl,
    format,
    decks,
    standings,
    rounds,
    draftNumbers,
  });
  const players = built.item.Decks.map((deck) => deck.Player);
  const align = (name: string) => matchOfficialName(name, players) ?? alignToDeck(name, players);
  for (const round of built.item.Rounds ?? []) {
    for (const match of round.Matches) {
      match.Player1 = align(match.Player1);
      match.Player2 = align(match.Player2);
    }
  }

  const stored = matchingEvents(input.store, input.group.key, format, built.item.Tournament.Date, meleeId);
  const canonical = pickCanonical(stored);
  const source = (canonical?.id ?? (meleeId ? `melee.gg:premier-${meleeId}` : `magic.gg:${slugFromKey(input.group.key)}`)).split(":")[0]!;
  const id = canonical?.id ?? (meleeId ? `melee.gg:premier-${meleeId}` : `magic.gg:${slugFromKey(input.group.key)}`);
  const stableId = id.slice(id.indexOf(":") + 1);
  const normalized = normalizeCacheItem(source, stableId, built.item, input.allow, input.version, canonical?.sourcePath ?? null, format);
  if (!normalized) {
    input.result.misses.push({ ref: eventUrl ?? id, reason: "parse", detail: "normalize rejected the event" });
    return null;
  }
  if ((normalized.droppedLists ?? 0) > 0) {
    input.result.droppedLists.push({ ref: eventUrl ?? id, dropped: normalized.droppedLists ?? 0 });
  }
  if (canonical) {
    normalized.event.name = /decklist/i.test(canonical.name) ? normalized.event.name : canonical.name;
    normalized.event.date = canonical.date;
    normalized.event.sourcePath = canonical.sourcePath;
    if (!normalized.event.uri) normalized.event.uri = canonical.uri;
  }

  const cacheBoards = canonical ? (input.store?.readBoards(canonical.id) ?? {}) : {};
  const merged = mergeRosterLists(rosterLists(canonical, cacheBoards), rosterLists(normalized.event, normalized.boards));
  for (const name of merged.unmatched) input.result.unmatchedNames.push({ ref: eventUrl ?? id, name });
  const incomingBundle = bundleFromItem(built.item, built.draftIdentified);
  const storedBundle = canonical ? bundleFromStored(canonical, cacheBoards) : null;
  const choice = chooseSides(incomingBundle, storedBundle, Boolean(canonical?.premierLists));
  const replaceLists = !canonical?.premierLists || choice.lists;
  const hadPremierConstructed = rosterLists(normalized.event, normalized.boards).some(
    (row) => row.mainboard.reduce((sum, card) => sum + (card.count > 0 ? card.count : 0), 0) >= 60,
  );
  if (replaceLists) {
    normalized.event.decks = merged.lists.map((row) => ({
      player: row.player,
      archetype: row.archetype || "Unknown",
      colorName: row.colorName,
      rank: row.rank,
    }));
    normalized.event.deckCount = normalized.event.decks.length;
    normalized.boards = Object.fromEntries(
      merged.lists.map((row) => [
        row.player,
        { result: row.result, anchorUri: row.anchorUri, mainboard: row.mainboard, sideboard: row.sideboard },
      ]),
    );
    const alias = (name: string) => merged.aliases.get(name) ?? name;
    if (!choice.matches && canonical && !built.draftIdentified) {
      normalized.event.matches = canonical.matches.map((match) => ({
        player1: alias(match.player1),
        player2: alias(match.player2),
        winner: match.winner,
      }));
    } else {
      normalized.event.matches = normalized.event.matches.map((match) => ({
        player1: alias(match.player1),
        player2: alias(match.player2),
        winner: match.winner,
      }));
    }
    if (hadPremierConstructed) {
      normalized.event.premierLists = true;
      normalized.event.listSource = "magic.gg";
    }
  }
  if (!input.dryRun && input.store) {
    if (replaceLists) {
      input.store.putEvent(normalized.event);
      input.store.writeBoards(normalized.event.id, normalized.boards);
    } else if (choice.matches && canonical) {
      const players = canonical.decks.map((deck) => deck.player);
      canonical.matches = normalized.event.matches.map((match) => ({
        player1: alignToDeck(match.player1, players),
        player2: alignToDeck(match.player2, players),
        winner: match.winner,
      }));
      canonical.premierLists = true;
      canonical.listSource = canonical.listSource ?? "magic.gg";
      input.store.putEvent(canonical);
    }
    const keptId = replaceLists ? normalized.event.id : canonical!.id;
    for (const other of stored) {
      if (other.id !== keptId) input.store.deleteEvent(other.id);
    }
  }

  const saved = replaceLists ? normalized.event : canonical!;
  const top = [...saved.decks].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.player.localeCompare(b.player)).slice(0, 8);
  input.log(
    `  premier ${saved.name}: ${saved.decks.length} decks, ${saved.matches.length} constructed matches, draft rounds ${built.draftRounds.filter((n) => n > 0).join(",") || "none"}`,
  );
  return {
    id: saved.id,
    name: saved.name,
    format: saved.format,
    date: saved.date,
    decks: saved.decks.length,
    matches: saved.matches.length,
    draftRounds: (rounds.some((round) => round.format)
      ? built.draftRounds.filter((round) => round > 0)
      : [...(draftNumbers ?? [])]
    ).sort((a, b) => a - b),
    constructedRounds: (built.item.Rounds ?? []).map((round) => round.RoundName),
    meleeId,
    kept: !canonical || choice.lists || choice.matches ? "incoming" : "stored",
    top: top.map((deck) => ({ rank: deck.rank, player: deck.player, archetype: deck.archetype })),
  };
}

function majorityFormat(decks: readonly ParsedDeck[]): Format | null {
  const counts = new Map<Format, number>();
  for (const deck of decks) {
    const format = detectFormat(deck.format, deck.eventName);
    if (!format) continue;
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  let best: Format | null = null;
  let bestN = 0;
  for (const [format, count] of counts) {
    if (count > bestN) {
      best = format;
      bestN = count;
    }
  }
  return best;
}

function pageHrefs(html: string): string[] {
  const text = decodeJsEscapes(html);
  const hrefs = new Set<string>();
  for (const match of text.matchAll(/href="([^"]+)"/gi)) hrefs.add(match[1]!);
  for (const match of text.matchAll(/["'](\/(?:news|events|decklists)\/[a-z0-9-]+)["']/gi)) hrefs.add(match[1]!);
  return [...hrefs];
}

function firstUrl(html: string, key: string, needle: string): string | null {
  for (const href of pageHrefs(html)) {
    if (!href.toLowerCase().includes(needle.toLowerCase())) continue;
    if (needle === "/events/" && premierKey(href) !== key && !href.toLowerCase().includes(key.replace("worlds:", "world-championship-"))) continue;
    if (needle !== "/events/" && premierKey(href) && premierKey(href) !== key) continue;
    const url = absolute(href, MAGIC_ORIGIN);
    if (url) return url;
  }
  return null;
}

function resultLinksFor(html: string, key: string, draftNumbers: ReadonlySet<number> | null): { round: number; url: string }[] {
  const links: { round: number; url: string }[] = [];
  const seen = new Set<number>();
  for (const href of pageHrefs(html)) {
    const match = href.match(/round-(\d+)-results/i);
    if (!match) continue;
    const round = Number(match[1]);
    if (seen.has(round)) continue;
    if (premierKey(href) && premierKey(href) !== key) continue;
    if (draftNumbers?.has(round)) continue;
    const url = absolute(href, MAGIC_ORIGIN);
    if (!url) continue;
    seen.add(round);
    links.push({ round, url });
  }
  return links.sort((a, b) => a.round - b.round).slice(0, 16);
}

function meleeIdFromStore(store: FactStore | undefined, key: string, format: Format, day: string | null): number | null {
  if (!store) return null;
  for (const ref of store.listEventRefs()) {
    if (ref.format !== format) continue;
    if (premierKey(ref.id) !== key) continue;
    if (day && !datesClose(ref.date, `${day}T12:00:00.000Z`)) continue;
    const id = meleeIdFromText(ref.id);
    if (id) return id;
  }
  return null;
}

function matchingEvents(store: FactStore | undefined, key: string, format: Format, date: string, meleeId: number | null): FactEvent[] {
  if (!store) return [];
  const events: FactEvent[] = [];
  for (const ref of store.listEventRefs()) {
    if (ref.format !== format) continue;
    const sameMelee = meleeId != null && meleeIdFromText(ref.id) === meleeId;
    const sameKey = premierKey(ref.id) === key && datesClose(ref.date, date);
    if (!sameMelee && !sameKey) continue;
    const event = store.readEvent(ref.id);
    if (event) events.push(event);
  }
  return events;
}

function pickCanonical(events: readonly FactEvent[]): FactEvent | null {
  if (events.length === 0) return null;
  return (
    events.find((event) => event.sourcePath) ??
    events.find((event) => /-\d{5,7}-\d{4}-\d{2}-\d{2}/.test(event.id)) ??
    events[0]!
  );
}

function chooseSides(
  incoming: PremierBundle,
  stored: PremierBundle | null,
  storedPremier = false,
): { lists: boolean; matches: boolean } {
  if (!stored) return { lists: true, matches: incoming.matches > 0 };
  // A premier upgrade stays until a later magic.gg pull has more sideboard cards.
  const lists = storedPremier
    ? incoming.sideboards > stored.sideboards
    : incoming.sideboards > stored.sideboards || (incoming.sideboards === stored.sideboards && incoming.lists > stored.lists);
  // A labeled or scheduled constructed set replaces cache rounds that still
  // contain draft pairings, even when the cache counted more rows.
  const matches = incoming.matches > 0 && (incoming.draftIdentified || incoming.matches > stored.matches);
  return { lists, matches };
}

function rosterLists(event: FactEvent | null, boards: Record<string, PlayerBoard>): RosterList[] {
  if (!event) return [];
  return event.decks.map((deck) => {
    const board = boards[deck.player];
    return {
      player: deck.player,
      archetype: deck.archetype,
      colorName: deck.colorName,
      rank: deck.rank,
      result: board?.result ?? null,
      anchorUri: board?.anchorUri ?? null,
      mainboard: board?.mainboard ?? [],
      sideboard: board?.sideboard ?? [],
    };
  });
}

function upgradedPremierKeys(store: FactStore | undefined): Set<string> {
  if (!store) return new Set();
  const keys = new Set<string>();
  for (const ref of store.listEventRefs()) {
    if (!ref.premierLists) continue;
    const key = premierKey(ref.id);
    if (key) keys.add(key);
  }
  return keys;
}

function bundleFromStored(event: FactEvent, boards: Record<string, PlayerBoard> | null): PremierBundle {
  const lists = boards ? Object.values(boards) : [];
  return {
    lists: lists.filter((board) => board.mainboard.length > 0).length || event.decks.length,
    sideboards: lists.reduce((sum, board) => sum + board.sideboard.reduce((cards, card) => cards + card.count, 0), 0),
    matches: event.matches.length,
    ranks: event.decks.filter((deck) => deck.rank != null).length,
    draftIdentified: false,
  };
}

function slugFromKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "premier";
}
