import type { RawCacheItem, RawDeck, RawDeckItem, RawRound, RawStanding, RawTournament } from "../types";

/**
 * Parsers for magic.gg premier decklist pages and public Melee tournament
 * pages. Draft rounds are decided from the event (a round format label, a
 * round name, or the event's own published schedule), never from a fixed
 * Pro Tour round-number list.
 */

// "limited" must not match "Unlimited". Word boundaries keep Vintage Unlimited constructed.
const LIMITED = /\b(?:draft|sealed|limited|booster)\b/i;
const PREMIER_NAME = /pro\s*tour|world\s+championship/i;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function isLimitedRoundLabel(value: string | null | undefined): boolean {
  return Boolean(value && LIMITED.test(value));
}

export function isPremierName(value: string | null | undefined): boolean {
  return Boolean(value && PREMIER_NAME.test(value.replace(/[-_]+/g, " ")));
}

/** Stable identity for one Pro Tour or World Championship, or null. */
export function premierKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/[-_]+/g, " ");
  const worlds = text.match(/world\s+championship\s+(\d+)/i);
  if (worlds) return `worlds:${worlds[1]}`;
  if (!/pro\s*tour/i.test(text)) return null;
  const slug = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/decklists?/g, " ")
    .replace(/\b(standard|modern|pioneer|legacy|vintage|pauper|historic)\b/g, " ")
    .replace(/\b(a l|m z|a k|l z)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pro tour|magic|the|gathering|of|in|at|and|usa|netherlands|japan)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return slug ? `protour:${slug}` : "protour";
}

export function foldName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Schütz, Stefan" and "Stefan Schütz" match. "Alex Kans" matches "Alexander Kans". */
export function namesMatch(a: string, b: string): boolean {
  const left = foldName(a);
  const right = foldName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const lt = left.split(" ");
  const rt = right.split(" ");
  if (lt.slice().sort().join(" ") === rt.slice().sort().join(" ")) return true;
  if (lt.length < 2 || rt.length < 2) return false;
  if (lt[lt.length - 1] !== rt[rt.length - 1]) return false;
  const lf = lt[0]!;
  const rf = rt[0]!;
  return lf.startsWith(rf) || rf.startsWith(lf);
}

export function displayName(value: string): string {
  const text = decodeBasicEntities(value).replace(/\s+/g, " ").trim();
  const comma = text.match(/^([^,]+),\s*(.+)$/);
  if (!comma) return text;
  return `${comma[2]} ${comma[1]}`.replace(/\s+/g, " ").trim();
}

/** Nuxt payloads store links as `\u002Fnews\u002F...` inside a script string. */
export function decodeJsEscapes(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/");
}

export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _;
    });
}

export function parseHumanDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return parseHumanDate(value);
  return new Date(time).toISOString();
}

export interface RobotsRules {
  crawlDelaySec: number;
  disallowed: string[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: { agent: string; delay: number; disallow: string[] }[] = [];
  let current: { agent: string; delay: number; disallow: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const agent = line.match(/^user-agent:\s*(.+)$/i);
    if (agent) {
      current = { agent: agent[1]!.trim(), delay: 0, disallow: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    const delay = line.match(/^crawl-delay:\s*(\d+(?:\.\d+)?)/i);
    if (delay) current.delay = Number(delay[1]);
    const disallow = line.match(/^disallow:\s*(.*)$/i);
    if (disallow && disallow[1]!.trim()) current.disallow.push(disallow[1]!.trim());
  }
  const star = groups.find((group) => group.agent === "*") ?? groups[0];
  return { crawlDelaySec: star?.delay ?? 0, disallowed: star?.disallow ?? [] };
}

/** True when the path is not blocked. An empty Disallow list allows the path. */
export function robotsAllow(disallowed: readonly string[], url: string): boolean {
  let path = url;
  try {
    path = new URL(url, "https://example.test").pathname;
  } catch {
    return false;
  }
  const lower = path.toLowerCase();
  return !disallowed.some((rule) => {
    if (!rule) return false;
    if (rule === "/") return true;
    return lower.startsWith(rule.toLowerCase());
  });
}

export interface DiscoveredPremierLink {
  url: string;
  title: string;
  /** UTC day from the link text, when the index prints one. */
  day: string | null;
  key: string;
}

/** Pro Tour and World Championship decklist links from a magic.gg index page. */
export function discoverPremierLinks(html: string, origin = "https://magic.gg"): DiscoveredPremierLink[] {
  const found = new Map<string, DiscoveredPremierLink>();
  const add = (href: string, title: string) => {
    if (!/\/decklists\/|\/news\//i.test(href)) return;
    if (!/decklist/i.test(`${href} ${title}`)) return;
    const key = premierKey(`${title} ${href}`);
    if (!key) return;
    let url = href;
    try {
      url = new URL(href, origin).toString();
    } catch {
      return;
    }
    const day = parseHumanDate(title);
    const prev = found.get(url);
    if (prev && prev.day && !day) return;
    found.set(url, { url, title: title.replace(/\s+/g, " ").trim() || url, day, key });
  };

  for (const match of html.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decodeBasicEntities(match[2]!.replace(/<[^>]+>/g, " "));
    add(decodeBasicEntities(match[1]!), title);
  }
  for (const match of html.matchAll(/\/(?:decklists|news)\/((?:pro-tour|magic-world-championship|world-championship)[a-z0-9-]*decklists[a-z0-9-]*)/gi)) {
    add(match[0]!, match[1]!.replace(/-/g, " "));
  }
  return [...found.values()];
}

export interface ParsedDeck {
  player: string;
  format: string | null;
  eventName: string | null;
  eventDay: string | null;
  mainboard: RawDeckItem[];
  sideboard: RawDeckItem[];
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? decodeBasicEntities(match[1]!) : null;
}

function parseBoard(body: string): RawDeckItem[] {
  const cards: RawDeckItem[] = [];
  for (const line of decodeBasicEntities(body).split(/\n|<br\s*\/?>/i)) {
    const match = line.replace(/<[^>]+>/g, " ").trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const name = match[2]!.replace(/\s+/g, " ").trim();
    const count = Number(match[1]);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    cards.push({ Count: count, CardName: name });
  }
  return cards;
}

/** `<deck-list>` blocks from a magic.gg decklist article. */
export function parseMagicDecklists(html: string): ParsedDeck[] {
  const decks: ParsedDeck[] = [];
  for (const match of html.matchAll(/<deck-list\b([^>]*)>([\s\S]*?)<\/deck-list>/gi)) {
    const main = match[2]!.match(/<main-deck>([\s\S]*?)<\/main-deck>/i);
    const side = match[2]!.match(/<side-board>([\s\S]*?)<\/side-board>/i);
    const mainboard = parseBoard(main?.[1] ?? "");
    if (mainboard.length === 0) continue;
    const player = displayName(attr(match[1]!, "deck-title") ?? "");
    if (!player) continue;
    decks.push({
      player,
      format: attr(match[1]!, "format"),
      eventName: attr(match[1]!, "event-name"),
      eventDay: parseHumanDate(attr(match[1]!, "event-date")),
      mainboard,
      sideboard: parseBoard(side?.[1] ?? ""),
    });
  }
  return decks;
}

export interface ParsedRow {
  player: string;
  opponent: string;
  result: string;
}

/** One results table row. The score is oriented to the player in the first column. */
export function parseMagicResultRow(player: string, opponent: string, result: string): ParsedRow | null {
  const left = displayName(player);
  const right = displayName(opponent);
  if (!left || !right) return null;
  const text = decodeBasicEntities(result).replace(/\s+/g, " ").trim();
  if (/bye/i.test(text)) return null;
  const won = text.match(/^(.+?)\s+won\s+(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/i);
  if (won) {
    const winner = displayName(won[1]!);
    const high = Number(won[2]);
    const low = Number(won[3]);
    const draws = won[4] ? Number(won[4]) : 0;
    const winnerIsLeft = namesMatch(winner, left);
    const winnerIsRight = namesMatch(winner, right);
    if (!winnerIsLeft && !winnerIsRight) return null;
    const p1 = winnerIsLeft ? high : low;
    const p2 = winnerIsLeft ? low : high;
    return { player: left, opponent: right, result: `${p1}-${p2}-${draws}` };
  }
  if (/draw/i.test(text)) {
    const nums = text.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
    const resultText = nums ? `${nums[1]}-${nums[2]}-${nums[3] ?? "0"}` : "0-0-3";
    return { player: left, opponent: right, result: resultText };
  }
  return null;
}

export function parseMagicRoundResults(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (!/opponent/i.test(table[1]!) || !/result/i.test(table[1]!)) continue;
    for (const tr of table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        decodeBasicEntities(cell[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      );
      if (cells.length < 3) continue;
      const parsed = parseMagicResultRow(cells[0]!, cells[cells.length - 2]!, cells[cells.length - 1]!);
      if (parsed) rows.push(parsed);
    }
  }
  return rows;
}

export interface ParsedStanding {
  rank: number;
  player: string;
  points: number;
}

export function parseMagicStandings(html: string): ParsedStanding[] {
  const standings: ParsedStanding[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (!/rank/i.test(table[1]!) || !/first name/i.test(table[1]!)) continue;
    for (const tr of table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        decodeBasicEntities(cell[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      );
      if (cells.length < 4) continue;
      const rank = Number(cells[0]);
      const points = Number(cells[1]);
      const player = `${cells[2]} ${cells[3]}`.replace(/\s+/g, " ").trim();
      if (!player || !Number.isFinite(rank) || rank <= 0) continue;
      standings.push({ rank, player, points: Number.isFinite(points) ? points : 0 });
    }
  }
  return standings;
}

export interface SchedulePhase {
  rounds: number;
  limited: boolean;
  label: string;
}

/**
 * Round counts from a fact sheet.
 * "Three (3) rounds of Booster Draft, followed by four (4) rounds of Standard Constructed"
 * becomes draft rounds 1-3 and constructed rounds 4-7, then the next day continues.
 */
export function parseSchedulePhases(text: string): SchedulePhase[] {
  const plain = decodeBasicEntities(text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const phases: SchedulePhase[] = [];
  const re = /\((\d+)\)\s*rounds?\s+of\s+([\s\S]*?)(?=\(\d+\)\s*rounds?\s+of|\bfourteen\b|\bplayoff\b|\bstructure\b|$)/gi;
  for (const match of plain.matchAll(re)) {
    const rounds = Number(match[1]);
    let label = match[2]!.replace(/\s+/g, " ").trim();
    label = label.split(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)[0] ?? label;
    label = label.split(/,|followed by/i)[0] ?? label;
    label = label.replace(/[.,;:]+$/, "").trim();
    if (!rounds || rounds > 24 || label.length < 3) continue;
    phases.push({ rounds, limited: isLimitedRoundLabel(label), label });
  }
  return phases;
}

/** Round numbers whose schedule phase is draft, sealed, or limited. */
export function draftRoundNumbers(phases: readonly SchedulePhase[]): Set<number> {
  const draft = new Set<number>();
  let cursor = 1;
  for (const phase of phases) {
    for (let i = 0; i < phase.rounds; i++) {
      if (phase.limited) draft.add(cursor);
      cursor++;
    }
  }
  return draft;
}

export interface LabeledRound {
  name: string;
  number: number | null;
  /** Format printed on the round, such as "Draft" or "Standard". Null when the source did not say. */
  format: string | null;
  matches: { Player1: string; Player2: string; Result: string }[];
}

/**
 * Drop draft rounds.
 * A format label wins over the schedule, so a round the sheet calls draft is
 * kept when the pairing data says it was constructed.
 */
export function isDraftRound(
  round: { name: string; number: number | null; format: string | null },
  draftNumbers: ReadonlySet<number> | null,
): boolean {
  if (round.format) return isLimitedRoundLabel(round.format);
  if (isLimitedRoundLabel(round.name)) return true;
  return round.number != null && Boolean(draftNumbers?.has(round.number));
}

export function constructedRounds(rounds: readonly LabeledRound[], draftNumbers: ReadonlySet<number> | null): LabeledRound[] {
  return rounds.filter((round) => !isDraftRound(round, draftNumbers) && round.matches.length > 0);
}

export function toRawRounds(rounds: readonly LabeledRound[]): RawRound[] {
  return rounds.map((round) => ({
    RoundName: round.name,
    Matches: round.matches.map((match) => ({ ...match })),
  }));
}

export interface MeleeRoundRef {
  id: string;
  name: string;
}

export interface MeleePage {
  id: number | null;
  name: string | null;
  date: string | null;
  rounds: MeleeRoundRef[];
}

export function parseMeleeTournament(html: string): MeleePage {
  const idMatch = html.match(/id="tournament-id"[^>]*value="(\d+)"/i) ?? html.match(/\/Tournament\/View\/(\d+)/i);
  const nameMatch = html.match(/<h3\b[^>]*>[\s\S]*?<\/i>\s*([^<]+)<\/h3>/i) ?? html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
  const dateMatch = html.match(/data-value="(\d{4}-\d{2}-\d{2}T[^"]+)"/i);
  const rounds: MeleeRoundRef[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
    const id = attr(match[1]!, "data-id");
    const name = attr(match[1]!, "data-name");
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    rounds.push({ id, name });
  }
  const name = nameMatch ? decodeBasicEntities(nameMatch[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;
  return {
    id: idMatch ? Number(idMatch[1]) : null,
    name: name || null,
    date: isoDate(dateMatch?.[1] ?? null),
    rounds,
  };
}

interface MeleeCompetitor {
  SortOrder?: number;
  GameWins?: number | null;
  Team?: { Players?: { DisplayName?: string | null }[] | null } | null;
}

interface MeleeMatchRow {
  Competitors?: MeleeCompetitor[] | null;
  RoundNumber?: number | null;
  RoundDescription?: string | null;
  Format?: string | null;
  FormatDescription?: string | null;
  GameDraws?: number | null;
  ResultString?: string | null;
}

export function parseMeleeMatchPage(body: unknown, fallbackName: string): LabeledRound | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data.filter((row): row is MeleeMatchRow => Boolean(row) && typeof row === "object");
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const matches: LabeledRound["matches"] = [];
  for (const row of rows) {
    const competitors = [...(row.Competitors ?? [])].sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0));
    const names = competitors
      .map((competitor) => competitor.Team?.Players?.[0]?.DisplayName?.trim() ?? "")
      .filter(Boolean);
    if (names.length < 2) continue;
    const p1 = competitors[0]?.GameWins;
    const p2 = competitors[1]?.GameWins;
    const draws = row.GameDraws ?? 0;
    let result: string | null = null;
    if (typeof p1 === "number" && typeof p2 === "number") result = `${p1}-${p2}-${draws}`;
    else if (row.ResultString) {
      const parsed = parseMagicResultRow(names[0]!, names[1]!, row.ResultString);
      result = parsed?.result ?? null;
    }
    if (!result) continue;
    matches.push({ Player1: names[0]!, Player2: names[1]!, Result: result });
  }
  if (matches.length === 0) return null;
  const number = typeof first.RoundNumber === "number" ? first.RoundNumber : null;
  return {
    name: first.RoundDescription?.trim() || fallbackName || (number != null ? `Round ${number}` : "Round"),
    number,
    format: first.Format?.trim() || first.FormatDescription?.trim() || null,
    matches,
  };
}

export function meleeIdFromText(value: string | null | undefined): number | null {
  if (!value) return null;
  const view = value.match(/tournament\/view\/(\d+)/i);
  if (view) return Number(view[1]);
  const dated = value.match(/-(\d{5,7})-\d{4}-\d{2}-\d{2}\b/);
  return dated ? Number(dated[1]) : null;
}

export function datesClose(a: string | null | undefined, b: string | null | undefined, days = 5): boolean {
  if (!a || !b) return true;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(left - right) <= days * 86_400_000;
}

export interface PremierBundle {
  lists: number;
  /** Sideboard card copies, so a list with a real sideboard beats an empty one. */
  sideboards: number;
  matches: number;
  ranks: number;
  /** True when draft rounds were removed using this event's labels or schedule. */
  draftIdentified: boolean;
}

/** Card copies on one board. Non-positive counts do not add. */
export function cardCopies(cards: { Count: number }[] | null | undefined): number {
  return (cards ?? []).reduce((sum, card) => sum + (card.Count > 0 ? card.Count : 0), 0);
}

/** Constructed main decks are 60 cards. A shorter list in these formats is a draft (or partial) list. */
export const CONSTRUCTED_MIN_MAIN = 60;

export function bundleFromItem(item: RawCacheItem, draftIdentified: boolean): PremierBundle {
  const decks = item.Decks ?? [];
  return {
    lists: decks.filter((deck) => cardCopies(deck.Mainboard) > 0).length,
    sideboards: decks.reduce((sum, deck) => sum + cardCopies(deck.Sideboard), 0),
    matches: (item.Rounds ?? []).reduce((sum, round) => sum + (round.Matches?.length ?? 0), 0),
    ranks: (item.Standings ?? []).filter((row) => row.Rank > 0).length,
    draftIdentified,
  };
}

/**
 * Prefer the bundle with more sideboard cards, then more lists, then a
 * match set whose draft rounds were identified from the event, then more
 * constructed matches, then more ranks. A tie keeps the existing bundle.
 */
export function incomingIsFuller(incoming: PremierBundle, stored: PremierBundle): boolean {
  if (incoming.sideboards !== stored.sideboards) return incoming.sideboards > stored.sideboards;
  if (incoming.lists !== stored.lists) return incoming.lists > stored.lists;
  if (incoming.draftIdentified !== stored.draftIdentified) return incoming.draftIdentified;
  if (incoming.matches !== stored.matches) return incoming.matches > stored.matches;
  if (incoming.ranks !== stored.ranks) return incoming.ranks > stored.ranks;
  return false;
}

export function placeLabel(rank: number): string {
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th";
  return `${rank}${suffix} Place`;
}

export function alignToDeck(name: string, players: readonly string[]): string {
  return players.find((player) => namesMatch(player, name)) ?? name;
}

export function buildPremierItem(input: {
  name: string;
  date: string;
  uri: string | null;
  format: string | null;
  decks: ParsedDeck[];
  standings: ParsedStanding[];
  rounds: LabeledRound[];
  draftNumbers: ReadonlySet<number> | null;
}): { item: RawCacheItem; draftIdentified: boolean; draftRounds: number[] } {
  const players = input.decks.map((deck) => deck.player);
  const byPlayer = new Map<string, ParsedDeck>();
  for (const deck of input.decks) {
    const prev = byPlayer.get(deck.player);
    if (!prev || deck.sideboard.length > prev.sideboard.length || deck.mainboard.length > prev.mainboard.length) {
      byPlayer.set(deck.player, deck);
    }
  }
  const unique = [...byPlayer.values()];
  const rankByPlayer = new Map<string, ParsedStanding>();
  for (const standing of input.standings) {
    const player = alignToDeck(standing.player, players);
    if (!rankByPlayer.has(player)) rankByPlayer.set(player, { ...standing, player });
  }
  const decks = unique.map((deck) => {
    const standing = rankByPlayer.get(deck.player);
    return {
      Player: deck.player,
      Result: standing ? placeLabel(standing.rank) : null,
      Mainboard: deck.mainboard,
      Sideboard: deck.sideboard,
    };
  });
  const standings: RawStanding[] = [...rankByPlayer.values()].map((standing) => ({
    Rank: standing.rank,
    Player: standing.player,
    Points: standing.points,
    Wins: 0,
    Losses: 0,
    Draws: 0,
    OMWP: 0,
    GWP: 0,
    OGWP: 0,
  }));
  const labeled = input.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({
      Player1: alignToDeck(match.Player1, players),
      Player2: alignToDeck(match.Player2, players),
      Result: match.Result,
    })),
  }));
  const draftIdentified = labeled.some((round) => round.format != null) || input.draftNumbers != null;
  const kept = constructedRounds(labeled, input.draftNumbers);
  const draftRounds = labeled.filter((round) => isDraftRound(round, input.draftNumbers)).map((round) => round.number ?? -1);
  return {
    item: {
      Tournament: {
        Name: input.name,
        Date: input.date,
        Uri: input.uri,
        Formats: input.format,
      },
      Decks: decks,
      Standings: standings,
      Rounds: toRawRounds(kept),
    },
    draftIdentified,
    draftRounds,
  };
}

export function roundNumberFromName(name: string): number | null {
  const match = name.match(/\bround\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

/** Draft round numbers from schedule prose, or null when the text has no round structure. */
export function draftNumbersFromText(text: string | null | undefined): Set<number> | null {
  if (!text?.trim()) return null;
  const phases = parseSchedulePhases(text);
  if (phases.length === 0) return null;
  return draftRoundNumbers(phases);
}

/** Schedule text carried on the cache item itself, when a source included one. */
export function draftNumbersFromCacheItem(item: RawCacheItem): Set<number> | null {
  const tournament = item.Tournament as RawTournament;
  return draftNumbersFromText([tournament?.Schedule, tournament?.Description].filter(Boolean).join("\n"));
}

/**
 * Keep constructed rounds.
 * A format label and a limited round name apply to every event. Numbered draft
 * rounds apply only when this event's schedule (or an explicit set) says so.
 */
export function constructedCacheRounds(
  rounds: readonly RawRound[] | null | undefined,
  draftNumbers: ReadonlySet<number> | null,
): RawRound[] {
  const labeled: LabeledRound[] = (rounds ?? []).map((round) => ({
    name: round.RoundName ?? "",
    number: roundNumberFromName(round.RoundName ?? ""),
    format: round.Format?.trim() || null,
    matches: round.Matches ?? [],
  }));
  return toRawRounds(constructedRounds(labeled, draftNumbers));
}

export interface ConstructedCacheSelection {
  decks: RawDeck[];
  rounds: RawRound[];
  droppedLists: number;
}

/**
 * Drop main decks under 60 cards and draft rounds.
 * `draftNumbers` omitted reads a schedule on the item. Pass null when the
 * event has no schedule, so only round names and format labels are used.
 */
export function selectConstructedCache(
  item: RawCacheItem,
  draftNumbers?: ReadonlySet<number> | null,
): ConstructedCacheSelection {
  const numbers = draftNumbers === undefined ? draftNumbersFromCacheItem(item) : draftNumbers;
  const decks: RawDeck[] = [];
  let droppedLists = 0;
  for (const deck of item.Decks ?? []) {
    if (cardCopies(deck.Mainboard) < CONSTRUCTED_MIN_MAIN) {
      droppedLists++;
      continue;
    }
    decks.push(deck);
  }
  return { decks, rounds: constructedCacheRounds(item.Rounds, numbers), droppedLists };
}

const MAGIC_ORIGIN = "https://magic.gg";

function absoluteMagic(href: string): string | null {
  try {
    return new URL(href, MAGIC_ORIGIN).toString();
  } catch {
    return null;
  }
}

function htmlHrefs(html: string): string[] {
  const text = decodeJsEscapes(html);
  const hrefs = new Set<string>();
  for (const match of text.matchAll(/href="([^"]+)"/gi)) hrefs.add(decodeBasicEntities(match[1]!));
  for (const match of text.matchAll(/["'](\/(?:news|events|decklists)\/[a-z0-9-]+)["']/gi)) hrefs.add(match[1]!);
  return [...hrefs];
}

/** True when `found` names the same premier event as `wanted`. Extra URL words are ignored. */
function samePremier(found: string, wanted: string): boolean {
  if (found === wanted) return true;
  if (found.startsWith("worlds:") || wanted.startsWith("worlds:")) return false;
  const have = new Set(found.replace(/^protour:/, "").split(/\s+/).filter(Boolean));
  const need = wanted.replace(/^protour:/, "").split(/\s+/).filter(Boolean);
  return need.length > 0 && need.every((token) => have.has(token));
}

/** Fact-sheet URL for this premier event, or null. */
export function findFactSheetUrl(html: string, key: string): string | null {
  let fallback: string | null = null;
  for (const href of htmlHrefs(html)) {
    if (!/fact-sheet/i.test(href)) continue;
    const url = absoluteMagic(href);
    if (!url) continue;
    const sheetKey = premierKey(href);
    if (!sheetKey || sheetKey === key || samePremier(sheetKey, key)) return url;
    fallback ??= url;
  }
  return fallback;
}

/** Event page URL whose identity matches `key`. */
export function findPremierEventUrl(html: string, key: string): string | null {
  for (const href of htmlHrefs(html)) {
    if (!/\/events\//i.test(href)) continue;
    const eventKey = premierKey(href);
    const worldsSlug = key.startsWith("worlds:") ? `world-championship-${key.slice("worlds:".length)}` : "";
    if (eventKey !== key && !(worldsSlug && href.toLowerCase().includes(worldsSlug))) continue;
    const url = absoluteMagic(href);
    if (url) return url;
  }
  return null;
}

/**
 * Draft round numbers for one premier event, from magic.gg's fact sheet.
 * The sheet is this event's schedule. A miss returns null and does not guess
 * a Pro Tour round list. Repeated labels share one index fetch and one result.
 */
export function createPremierDraftLookup(fetchText: (url: string) => Promise<string | null>) {
  let indexPromise: Promise<string | null> | null = null;
  const cache = new Map<string, Promise<Set<number> | null>>();
  return (label: string): Promise<Set<number> | null> => {
    const key = premierKey(label);
    if (!key) return Promise.resolve(null);
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async (): Promise<Set<number> | null> => {
      try {
        indexPromise ??= fetchText(`${MAGIC_ORIGIN}/decklists`);
        const index = await indexPromise;
        if (!index) return null;
        const link = discoverPremierLinks(index).find((item) => item.key === key || samePremier(item.key, key));
        if (!link) return null;
        const page = await fetchText(link.url);
        if (!page) return null;
        const direct = findFactSheetUrl(page, key);
        if (direct) {
          const sheet = await fetchText(direct);
          return sheet ? draftNumbersFromText(sheet) : null;
        }
        const eventUrl = findPremierEventUrl(page, key);
        if (!eventUrl) return null;
        const eventHtml = await fetchText(eventUrl);
        if (!eventHtml) return null;
        const factUrl = findFactSheetUrl(eventHtml, key);
        if (!factUrl) return null;
        const sheet = await fetchText(factUrl);
        return sheet ? draftNumbersFromText(sheet) : null;
      } catch {
        return null;
      }
    })();
    cache.set(key, pending);
    return pending;
  };
}
