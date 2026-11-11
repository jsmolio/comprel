import type { BoardCard } from "../types";
import { isConstructedSolo } from "./select";
import { matchesCount } from "./sources";
import type { RiftboundBoard, RiftboundFactEvent, RiftboundFactMatch } from "./types";

export type NormalizeResult =
  | { ok: true; event: RiftboundFactEvent; boards: Record<string, RiftboundBoard> }
  | { ok: false; shape: boolean; reason: string };

interface StandingRow {
  player: string;
  name: string;
  legend: string | null;
  rank: number | null;
  hasDeck: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

export function parseStandings(body: unknown): { ok: true; rows: StandingRow[] } | { ok: false } {
  const record = asRecord(body);
  const list = record?.standings;
  if (!Array.isArray(list)) return { ok: false };
  const rows: StandingRow[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const player = idOf(row.playerId);
    if (!player) continue;
    const rank = typeof row.rank === "number" ? row.rank : null;
    rows.push({
      player,
      name: str(row, "username") ?? str(row, "realName") ?? player,
      legend: str(row, "legendName"),
      rank,
      hasDeck: row.hasDeck === true,
    });
  }
  return { ok: true, rows };
}

function cardsOf(section: Record<string, unknown>): BoardCard[] {
  const cards = section.cards;
  if (!Array.isArray(cards)) return [];
  const out: BoardCard[] = [];
  for (const item of cards) {
    const card = asRecord(item);
    if (!card) continue;
    const name = str(card, "name");
    const quantity = typeof card.quantity === "number" ? card.quantity : typeof card.count === "number" ? card.count : 0;
    if (!name || quantity <= 0) continue;
    out.push({ name, count: quantity });
  }
  return out;
}

const ZONE_KEY = {
  legend: "legend",
  champion: "champion",
  battlefield: "battlefield",
  main: "main",
  rune_pool: "runePool",
  sideboard: "sideboard",
} as const;

export function parseDeck(body: unknown): RiftboundBoard | null {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.sections)) return null;
  const board: RiftboundBoard = {
    anchorUri: typeof record.shareSlug === "string" ? `https://boundrift.com/d/${record.shareSlug}` : null,
    legend: [],
    champion: [],
    battlefield: [],
    main: [],
    runePool: [],
    sideboard: [],
  };
  for (const item of record.sections) {
    const section = asRecord(item);
    if (!section) continue;
    const type = str(section, "type");
    if (!type || !(type in ZONE_KEY)) continue;
    const key = ZONE_KEY[type as keyof typeof ZONE_KEY];
    board[key] = cardsOf(section);
  }
  const any = board.legend.length + board.champion.length + board.battlefield.length + board.main.length + board.runePool.length + board.sideboard.length;
  return any > 0 ? board : null;
}

const SKIP_ROUND = /draft|deck.?build|register|check.?in/i;

/** Pairing rounds. UVS uses PLAY_VS_OPPONENT. topdeck.gg uses SWISS and SINGLE_ELIMINATION. */
export function playRoundIds(rounds: { id?: unknown; roundType?: string | null; status?: string | null }[] | null | undefined): number[] {
  const complete = (rounds ?? []).filter(
    (round) => round.status === "COMPLETE" && typeof round.id === "number" && !SKIP_ROUND.test(round.roundType ?? ""),
  );
  const versus = complete.filter((round) => round.roundType === "PLAY_VS_OPPONENT");
  const chosen = versus.length
    ? versus
    : complete.filter((round) => round.roundType === "SWISS" || round.roundType === "SINGLE_ELIMINATION");
  const rows = chosen.length ? chosen : complete;
  return rows.map((round) => round.id as number).slice(0, 24);
}

export function legendsFromMatchBodies(bodies: unknown[]): Map<string, string> {
  const legends = new Map<string, string>();
  for (const body of bodies) {
    const record = asRecord(body);
    const list = record?.matches;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      for (const key of ["player1", "player2"] as const) {
        const player = asRecord(row[key]);
        if (!player) continue;
        const id = idOf(player.playerId);
        const legend = str(player, "legendName");
        if (id && legend && !legends.has(id)) legends.set(id, legend);
      }
    }
  }
  return legends;
}

export function parseMatches(body: unknown, countMatches: boolean): { ok: true; matches: RiftboundFactMatch[] } | { ok: false } {
  if (!countMatches) return { ok: true, matches: [] };
  const record = asRecord(body);
  const list = record?.matches;
  if (!Array.isArray(list)) return { ok: false };
  const matches: RiftboundFactMatch[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row || row.isBye === true) continue;
    const player1 = idOf(row.player1Id);
    const player2 = idOf(row.player2Id);
    if (!player1 || !player2 || player1 === player2) continue;
    const winnerId = idOf(row.winningPlayerId);
    let winner: 0 | 1 | 2 = 0;
    if (row.isIntentionalDraw !== true && winnerId) {
      if (winnerId === player1) winner = 1;
      else if (winnerId === player2) winner = 2;
    }
    matches.push({ player1, player2, winner });
  }
  return { ok: true, matches };
}

export interface NormalizeInput {
  detail: unknown;
  standings: unknown;
  matchBodies: unknown[];
  decks: Record<string, unknown>;
  legendColor?: (legend: string) => string | null;
  minPlayers?: number;
}

export function normalizeEvent(input: NormalizeInput): NormalizeResult {
  const detail = asRecord(input.detail);
  if (!detail || !Array.isArray(detail.rounds)) {
    return { ok: false, shape: true, reason: "event detail shape" };
  }
  const boundriftId = typeof detail.id === "number" ? detail.id : Number(detail.id);
  if (!Number.isFinite(boundriftId)) return { ok: false, shape: true, reason: "event id" };
  const name = str(detail, "nameEn") ?? str(detail, "name") ?? `Event ${boundriftId}`;
  const listed = {
    id: boundriftId,
    name,
    startDatetime: str(detail, "startDatetime"),
    lifecycleStatus: str(detail, "lifecycleStatus"),
    source: str(detail, "source"),
    eventCategory: str(detail, "eventCategory"),
    gameplayFormatName: str(detail, "gameplayFormatName"),
    eventFormat: str(detail, "eventFormat"),
    startingPlayerCount: typeof detail.startingPlayerCount === "number" ? detail.startingPlayerCount : null,
    registeredUserCount: typeof detail.registeredUserCount === "number" ? detail.registeredUserCount : null,
  };
  if (!isConstructedSolo(listed)) return { ok: false, shape: false, reason: "not constructed" };
  const standings = parseStandings(input.standings);
  if (!standings.ok) return { ok: false, shape: true, reason: "standings shape" };
  const source = listed.source ?? "unknown";
  const countMatches = matchesCount(source);
  const matches: RiftboundFactMatch[] = [];
  if (countMatches) {
    for (const body of input.matchBodies) {
      const parsed = parseMatches(body, true);
      if (!parsed.ok) return { ok: false, shape: true, reason: "matches shape" };
      matches.push(...parsed.matches);
    }
  }
  const color = input.legendColor ?? (() => null);
  const legendsOnMatches = legendsFromMatchBodies(input.matchBodies);
  const decks = standings.rows
    .map((row) => ({ ...row, legend: row.legend ?? legendsOnMatches.get(row.player) ?? null }))
    .filter((row) => row.legend)
    .map((row) => ({
      player: row.player,
      name: row.name,
      archetype: row.legend as string,
      colorName: color(row.legend as string),
      rank: row.rank,
    }));
  const boards: Record<string, RiftboundBoard> = {};
  for (const [player, body] of Object.entries(input.decks)) {
    const board = parseDeck(body);
    if (board) boards[player] = board;
  }
  const hasDeck = standings.rows.some((row) => row.hasDeck);
  const date = listed.startDatetime ?? new Date(0).toISOString();
  const playerCount = listed.startingPlayerCount ?? standings.rows.length;
  if ((input.minPlayers ?? 0) > 0 && playerCount < (input.minPlayers ?? 0)) {
    return { ok: false, shape: false, reason: "field too small" };
  }
  const event: RiftboundFactEvent = {
    schemaVersion: 1,
    id: `boundrift:${boundriftId}`,
    boundriftId,
    source,
    name,
    date,
    uri: str(detail, "externalUrl") ?? `https://boundrift.com/events/${boundriftId}`,
    category: listed.eventCategory,
    format: "Constructed",
    playerCount,
    deckCount: decks.length,
    decks,
    matches,
    listsAbsent: source === "playriftbound" || !hasDeck,
  };
  return { ok: true, event, boards };
}

/** Players whose lists we fetch: one per legend, then the next best finishes, capped. */
export function chooseDeckPlayers(
  rows: { player: string; rank: number | null; legend: string | null; hasDeck: boolean }[],
  limit: number,
): string[] {
  const ranked = rows
    .filter((row) => row.hasDeck && row.legend)
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.player.localeCompare(b.player));
  const picked: string[] = [];
  const seenLegend = new Set<string>();
  for (const row of ranked) {
    if (seenLegend.has(row.legend as string)) continue;
    seenLegend.add(row.legend as string);
    picked.push(row.player);
    if (picked.length >= limit) return picked;
  }
  for (const row of ranked) {
    if (picked.includes(row.player)) continue;
    picked.push(row.player);
    if (picked.length >= limit) break;
  }
  return picked;
}
