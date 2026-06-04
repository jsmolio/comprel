import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { detectFormat } from "../format";
import { classify } from "../archetype/classify";
import { parseDeckResult, parseMatchResult, isByePlayer } from "../result";
import type { BoardCard, Format, RawCacheItem, RawDeck, RawStanding } from "../types";

// Ingests normalized tournament JSON from the open, actively-maintained
// fbettega/MTG_decklistcache dataset (successor to the now-archived
// Badaro/MTGODecklistCache). Discovery uses the git-trees API (a handful of
// calls); file bodies come from raw.githubusercontent.com, which is not subject
// to the API rate limit. https://github.com/fbettega/MTG_decklistcache

export const REPO = "fbettega/MTG_decklistcache";
const API = "https://api.github.com";

// Repo source folder -> friendly label stored on each tournament/deck.
export const SOURCE_LABELS: Record<string, string> = {
  MTGmelee: "melee.gg",
  MTGO: "mtgo.com",
  Topdeck: "topdeck.gg",
  Manatrader: "manatraders.com",
  CardsRealm: "cardsrealm.com",
};

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

interface RemoteFile {
  source: string;
  fullPath: string; // Tournaments/<source>/<YYYY>/<MM>/<DD>/<file>.json
  rawUrl: string;
  date: Date;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": "comprel-ingest",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function getTree(sha: string, recursive = false): Promise<TreeEntry[]> {
  const url = `${API}/repos/${REPO}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`;
  const data = await ghJson<{ tree: TreeEntry[]; truncated: boolean }>(url);
  return data.tree;
}

function childSha(tree: TreeEntry[], name: string): string | undefined {
  return tree.find((e) => e.path === name && e.type === "tree")?.sha;
}

/** Discover the most recent `dayFolders` days of tournament files for a source. */
async function listRecentFiles(branch: string, source: string, dayFolders: number): Promise<RemoteFile[]> {
  const root = await getTree(branch);
  const tournamentsSha = childSha(root, "Tournaments");
  if (!tournamentsSha) return [];
  const tournaments = await getTree(tournamentsSha);
  const sourceSha = childSha(tournaments, source);
  if (!sourceSha) return [];

  const years = (await getTree(sourceSha))
    .filter((e) => e.type === "tree" && /^\d{4}$/.test(e.path))
    .sort((a, b) => b.path.localeCompare(a.path));
  if (years.length === 0) return [];

  // Scan the two most recent years so a window can cross the Jan boundary.
  const files: RemoteFile[] = [];
  for (const year of years.slice(0, 2)) {
    const entries = await getTree(year.sha, true); // paths relative: MM/DD/file.json
    for (const e of entries) {
      if (e.type !== "blob" || !e.path.endsWith(".json")) continue;
      const m = e.path.match(/^(\d{2})\/(\d{2})\//);
      if (!m) continue;
      const fullPath = `Tournaments/${source}/${year.path}/${e.path}`;
      files.push({
        source,
        fullPath,
        rawUrl: `https://raw.githubusercontent.com/${REPO}/${branch}/${fullPath.split("/").map(encodeURIComponent).join("/")}`,
        date: new Date(`${year.path}-${m[1]}-${m[2]}T00:00:00Z`),
      });
    }
  }

  // Keep files belonging to the latest `dayFolders` distinct day directories.
  const days = [...new Set(files.map((f) => f.date.getTime()))].sort((a, b) => b - a).slice(0, dayFolders);
  const keep = new Set(days);
  return files.filter((f) => keep.has(f.date.getTime()));
}

function toBoard(items: { Count: number; CardName: string }[] | null | undefined): BoardCard[] {
  return (items ?? []).map((i) => ({ name: i.CardName, count: i.Count }));
}

function recordForDeck(deck: RawDeck, standings: Map<string, RawStanding>) {
  const s = standings.get(deck.Player);
  if (s) return { wins: s.Wins, losses: s.Losses, draws: s.Draws, rank: s.Rank };
  const parsed = parseDeckResult(deck.Result);
  return { wins: parsed.wins, losses: parsed.losses, draws: parsed.draws, rank: parsed.rank };
}

/**
 * Normalize one CacheItem (tournament + decks + rounds + standings) into the DB.
 * Shared by the cache importer and any source that can produce this shape
 * (e.g. another normalized source). `stableId` must be unique within `source`.
 * Pass `formatHint` when the source already knows the format.
 */
export async function importCacheItem(
  source: string,
  stableId: string,
  item: RawCacheItem,
  allow: Set<Format>,
  formatHint?: Format,
  keepBoardsSince?: number,
) {
  // Prefer the cache's explicit Formats field, then fall back to name/filename.
  const format = formatHint ?? detectFormat(item.Tournament?.Formats, item.Tournament?.Name, stableId);
  if (!format || !allow.has(format)) return { imported: false as const };

  const date = new Date(item.Tournament.Date);
  const id = `${source}:${stableId}`;
  const standings = new Map((item.Standings ?? []).map((s) => [s.Player, s]));
  const rounds = item.Rounds ?? [];
  const hasPairings = rounds.some((r) => (r.Matches ?? []).length > 0);
  // Decklists are only stored for recent events (to bound DB size); older decks
  // keep their classified archetype + record but drop the card lists. Aggregation
  // never reads the lists, so this does NOT affect meta share / win rates.
  const keepBoards = keepBoardsSince === undefined || date.getTime() >= keepBoardsSince;

  const decks = (item.Decks ?? []).map((d) => {
    const main = toBoard(d.Mainboard);
    const side = toBoard(d.Sideboard);
    const cls = classify(format, main, side); // classify on the full list regardless
    const rec = recordForDeck(d, standings);
    return {
      tournamentId: id,
      format,
      player: d.Player,
      result: d.Result ?? null,
      rank: rec.rank,
      anchorUri: d.AnchorUri ?? null,
      archetype: cls.archetype,
      colorId: cls.colorId,
      colorName: cls.colorName,
      wins: rec.wins,
      losses: rec.losses,
      draws: rec.draws,
      mainboard: (keepBoards ? main : []) as unknown as Prisma.InputJsonValue,
      sideboard: (keepBoards ? side : []) as unknown as Prisma.InputJsonValue,
      date,
    };
  });

  const matches = rounds.flatMap((round) =>
    (round.Matches ?? [])
      .filter((m) => !isByePlayer(m.Player1) && !isByePlayer(m.Player2))
      .map((m) => {
        const o = parseMatchResult(m.Result);
        if (!o) return null;
        return {
          tournamentId: id,
          format,
          roundName: round.RoundName ?? null,
          player1: m.Player1,
          player2: m.Player2,
          p1GameWins: o.p1,
          p2GameWins: o.p2,
          draws: o.draws,
          winner: o.winner,
          date,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  );

  // Idempotent upsert: replace this tournament's decks/matches on every run.
  await prisma.$transaction([
    prisma.tournament.upsert({
      where: { id },
      create: { id, source, name: item.Tournament.Name, date, format, uri: item.Tournament.Uri ?? null, hasPairings, deckCount: decks.length },
      update: { name: item.Tournament.Name, date, format, uri: item.Tournament.Uri ?? null, hasPairings, deckCount: decks.length },
    }),
    prisma.deck.deleteMany({ where: { tournamentId: id } }),
    prisma.match.deleteMany({ where: { tournamentId: id } }),
    prisma.deck.createMany({ data: decks }),
    prisma.match.createMany({ data: matches }),
  ]);

  return { imported: true as const, format, decks: decks.length, matches: matches.length };
}

export interface ImportOptions {
  sources?: string[];
  dayFolders?: number;
  formats?: Format[];
  /** Skip tournament files already in the DB (cheap incremental runs). */
  skipExisting?: boolean;
  /** Always re-import files from the most recent N days even if known (catches late decklist additions). */
  reprocessRecentDays?: number;
  /** Store decklists only for events within the last N days (older decks keep stats, drop card lists). */
  keepBoardsSinceDays?: number;
  log?: (msg: string) => void;
}

export interface ImportSummary {
  files: number;
  skipped: number;
  tournaments: number;
  decks: number;
  matches: number;
  byFormat: Record<string, number>;
}

export async function importMtgoCache(opts: ImportOptions = {}): Promise<ImportSummary> {
  const sources = opts.sources ?? ["MTGmelee", "MTGO", "Topdeck", "Manatrader", "CardsRealm"];
  const dayFolders = opts.dayFolders ?? 12;
  const allow = new Set<Format>(opts.formats ?? ["Standard", "Pioneer", "Modern", "Legacy", "Vintage", "Pauper"]);
  const log = opts.log ?? (() => {});
  const keepBoardsSince = opts.keepBoardsSinceDays ? Date.now() - opts.keepBoardsSinceDays * 86_400_000 : undefined;

  const branch = (await ghJson<{ default_branch: string }>(`${API}/repos/${REPO}`)).default_branch;
  log(`cache default branch: ${branch}`);

  const summary: ImportSummary = { files: 0, skipped: 0, tournaments: 0, decks: 0, matches: 0, byFormat: {} };

  const existingIds = opts.skipExisting
    ? new Set((await prisma.tournament.findMany({ select: { id: true } })).map((t) => t.id))
    : new Set<string>();
  const reprocessDays = opts.reprocessRecentDays ?? 1;

  for (const source of sources) {
    const label = SOURCE_LABELS[source] ?? source;
    let files: RemoteFile[] = [];
    try {
      files = await listRecentFiles(branch, source, dayFolders);
    } catch (e) {
      log(`  ! ${source}: discovery failed (${(e as Error).message})`);
      continue;
    }
    const maxDate = Math.max(0, ...files.map((f) => f.date.getTime()));
    const reprocessCutoff = maxDate - reprocessDays * 86_400_000;
    log(`  ${source}: ${files.length} files across latest ${dayFolders} days`);

    for (const f of files) {
      const base = f.fullPath.split("/").pop()!.replace(/\.json$/i, "");
      // Incremental: skip known files, but always re-check the most recent days.
      if (opts.skipExisting && existingIds.has(`${label}:${base}`) && f.date.getTime() < reprocessCutoff) {
        summary.skipped++;
        continue;
      }
      summary.files++;
      try {
        const res = await fetch(f.rawUrl, { headers: { "User-Agent": "comprel-ingest" } });
        if (!res.ok) {
          log(`    ! fetch ${res.status}: ${f.fullPath}`);
          continue;
        }
        const item = (await res.json()) as RawCacheItem;
        const out = await importCacheItem(label, base, item, allow, undefined, keepBoardsSince);
        if (out.imported) {
          summary.tournaments++;
          summary.decks += out.decks;
          summary.matches += out.matches;
          summary.byFormat[out.format] = (summary.byFormat[out.format] ?? 0) + out.decks;
        }
      } catch (e) {
        log(`    ! import error ${f.fullPath}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 40)); // be polite to raw.githubusercontent
    }
  }

  return summary;
}
