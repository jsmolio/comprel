import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classifierVersion } from "../facts/classifier-version";
import { reclassifyStoredDecks, type ArchetypeDelta, type ReclassifyStoredResult } from "../facts/reclassify-stored";
import { FactStore } from "../facts/store";
import { unknownConditionTypes } from "./classify";
import {
  activeRulesRoot,
  clearFormatDataCache,
  formatFolders,
  parseLenientJson,
  rulesMarkerPath,
  syncedRulesRoot,
} from "../formatdata";

const execFileAsync = promisify(execFile);

const UPSTREAM_REPO = "Badaro/MTGOFormatData";
const COMMIT_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/main`;
const MIN_COLOR_ENTRIES = 1000;
const MIN_STANDARD_ARCHETYPES = 40;

export interface RulesMarker {
  schemaVersion: 1;
  appliedSha: string;
  source: "vendored" | "synced";
  /** Hash of the upstream format files only. */
  contentHash: string;
  /**
   * Hash of those format files plus local overrides. A matching upstream commit
   * with a different combined hash means an override changed and stored lists
   * should be relabeled. Missing on markers written before this field existed.
   */
  combinedHash: string;
}

export interface RulesSyncResult {
  status: "unchanged" | "updated" | "failed";
  /** Upstream commit that was checked, when the lookup succeeded. */
  sha: string | null;
  /** Commit whose rules are in effect after this run. */
  appliedSha: string | null;
  error?: string;
  decksReclassified: number;
  decksChanged: number;
  decksSkipped: number;
  eventsUpdated: number;
  deltas: ArchetypeDelta[];
}

export interface RulesSyncOptions {
  root?: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  reclassify?: (store: FactStore, version: string) => ReclassifyStoredResult;
}

function emptyCounts(): Pick<RulesSyncResult, "decksReclassified" | "decksChanged" | "decksSkipped" | "eventsUpdated" | "deltas"> {
  return { decksReclassified: 0, decksChanged: 0, decksSkipped: 0, eventsUpdated: 0, deltas: [] };
}

function readMarker(root: string): RulesMarker | null {
  const file = rulesMarkerPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RulesMarker>;
    if (parsed.schemaVersion !== 1 || typeof parsed.appliedSha !== "string") return null;
    if (parsed.source !== "vendored" && parsed.source !== "synced") return null;
    return {
      schemaVersion: 1,
      appliedSha: parsed.appliedSha,
      source: parsed.source,
      contentHash: typeof parsed.contentHash === "string" ? parsed.contentHash : "",
      combinedHash: typeof parsed.combinedHash === "string" ? parsed.combinedHash : "",
    };
  } catch {
    return null;
  }
}

function writeMarker(root: string, marker: RulesMarker) {
  const file = rulesMarkerPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(marker)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "comprel-rules-sync",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function clip(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

function listManaged(formatsDir: string): string[] {
  const rels: string[] = [];
  const colors = path.join(formatsDir, "card_colors.json");
  if (fs.existsSync(colors) && fs.statSync(colors).isFile()) rels.push("card_colors.json");
  for (const format of formatFolders()) {
    const base = path.join(formatsDir, format);
    if (!fs.existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".json")) rels.push(path.relative(formatsDir, full).replaceAll("\\", "/"));
      }
    };
    walk(base);
  }
  return rels;
}

function hashFormats(formatsDir: string): string {
  const hash = createHash("sha256");
  for (const rel of listManaged(formatsDir).sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(formatsDir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hashTree(dir: string): string {
  const hash = createHash("sha256");
  const rels: string[] = [];
  const walk = (current: string) => {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (fs.statSync(full).isFile()) rels.push(path.relative(dir, full).replaceAll("\\", "/"));
    }
  };
  walk(dir);
  for (const rel of rels.sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Upstream format files plus `data/rule-overrides`. Local override edits change this. */
export function combinedRulesHash(root = process.cwd()): string {
  return combinedHashOf(path.join(activeRulesRoot(root), "Formats"), root);
}

function combinedHashOf(formatsDir: string, root: string): string {
  const hash = createHash("sha256");
  hash.update(hashFormats(formatsDir));
  hash.update("\0overrides\0");
  hash.update(hashTree(path.join(root, "data", "rule-overrides")));
  return hash.digest("hex");
}

function formatsEqual(left: string, right: string): boolean {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  const rels = new Set([...listManaged(left), ...listManaged(right)]);
  for (const rel of rels) {
    const a = path.join(left, rel);
    const b = path.join(right, rel);
    if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
    if (!fs.readFileSync(a).equals(fs.readFileSync(b))) return false;
  }
  return true;
}

function validateFormats(formatsDir: string) {
  const colorsPath = path.join(formatsDir, "card_colors.json");
  if (!fs.existsSync(colorsPath)) throw new Error("archive is missing Formats/card_colors.json");
  const colors = parseLenientJson<{ Lands?: unknown; NonLands?: unknown }>(fs.readFileSync(colorsPath, "utf8"));
  const entries =
    (Array.isArray(colors.Lands) ? colors.Lands.length : 0) + (Array.isArray(colors.NonLands) ? colors.NonLands.length : 0);
  if (entries < MIN_COLOR_ENTRIES) throw new Error(`card_colors.json has ${entries} entries`);

  for (const format of formatFolders()) {
    const archetypes = path.join(formatsDir, format, "Archetypes");
    if (!fs.existsSync(archetypes)) throw new Error(`archive is missing ${format} archetypes`);
    const files = fs.readdirSync(archetypes).filter((name) => name.endsWith(".json"));
    if (format === "Standard" && files.length < MIN_STANDARD_ARCHETYPES) {
      throw new Error(`Standard archetype files: ${files.length}`);
    }
  }

  const unknown: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      let parsed: unknown;
      try {
        parsed = parseLenientJson(fs.readFileSync(full, "utf8"));
      } catch (error) {
        throw new Error(`${path.relative(formatsDir, full)}: ${(error as Error).message}`);
      }
      for (const type of unknownConditionTypes(parsed)) unknown.push(`${path.relative(formatsDir, full)}: ${type}`);
    }
  };
  for (const format of formatFolders()) walk(path.join(formatsDir, format));
  if (unknown.length) throw new Error(`unrecognized condition type ${unknown.slice(0, 4).join("; ")}`);
}

function findFormatsDir(extracted: string): string {
  if (fs.existsSync(path.join(extracted, "Formats", "card_colors.json"))) return path.join(extracted, "Formats");
  for (const name of fs.readdirSync(extracted)) {
    const nested = path.join(extracted, name, "Formats");
    if (fs.existsSync(path.join(nested, "card_colors.json"))) return nested;
  }
  throw new Error("archive has no Formats/card_colors.json");
}

async function downloadArchive(fetchImpl: typeof fetch, sha: string, dest: string) {
  const urls = [
    `https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${sha}`,
    `https://github.com/${UPSTREAM_REPO}/archive/${sha}.tar.gz`,
  ];
  let last = "archive download failed";
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "comprel-rules-sync" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        last = `archive HTTP ${res.status}`;
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 1000) {
        last = "archive was too small";
        continue;
      }
      fs.writeFileSync(dest, bytes);
      return;
    } catch (error) {
      last = clip(error);
    }
  }
  throw new Error(last);
}

function installSynced(root: string, formatsDir: string): string | null {
  const staging = `${syncedRulesRoot(root)}.staging-${process.pid}`;
  const dest = syncedRulesRoot(root);
  const backup = `${dest}.bak-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "Formats"), { recursive: true });
  fs.cpSync(formatsDir, path.join(staging, "Formats"), { recursive: true });
  let saved: string | null = null;
  try {
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(dest)) {
      fs.renameSync(dest, backup);
      saved = backup;
    }
    fs.renameSync(staging, dest);
  } catch (error) {
    if (!fs.existsSync(dest) && fs.existsSync(backup)) fs.renameSync(backup, dest);
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return saved;
}

function rollbackSynced(root: string, backup: string | null) {
  const dest = syncedRulesRoot(root);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  if (backup && fs.existsSync(backup)) fs.renameSync(backup, dest);
}

function applyCounts(result: ReclassifyStoredResult): Pick<RulesSyncResult, "decksReclassified" | "decksChanged" | "decksSkipped" | "eventsUpdated" | "deltas"> {
  return {
    decksReclassified: result.decksReclassified,
    decksChanged: result.decksChanged,
    decksSkipped: result.decksSkipped,
    eventsUpdated: result.eventsUpdated,
    deltas: result.deltas,
  };
}

/**
 * One private diagnostic row. The site does not read this; the ingest summary does.
 */
export function rulesSyncEvents(result: RulesSyncResult): { ref: string; reason: string; detail?: string }[] {
  const parts: string[] = [];
  if (result.appliedSha) parts.push(`applied ${result.appliedSha}`);
  if (result.error) parts.push(result.error);
  if (result.deltas.length) {
    const shown = result.deltas.slice(0, 12).map((row) => `${row.archetype} ${row.before}->${row.after}`);
    const extra = result.deltas.length - shown.length;
    parts.push(shown.join(", ") + (extra > 0 ? `, +${extra} more` : ""));
  }
  if (result.status === "updated") {
    parts.push(`${result.decksChanged} stored lists changed, ${result.decksSkipped} kept without a stored list`);
  }
  const detail = parts.join("; ");
  return [{ ref: result.sha ?? UPSTREAM_REPO, reason: result.status, ...(detail ? { detail } : {}) }];
}

/**
 * Cheap upstream check for the formats we classify. A matching commit is a no-op
 * when the combined rules hash also matches. A matching commit whose combined
 * hash differs (a local override changed) reclassifies stored lists and leaves
 * the synced tree in place. A new commit replaces the synced rule tree, then
 * local overrides still apply, then stored lists are reclassified. Fetch and
 * parse failures keep the current rules and do not throw.
 */
export async function syncUpstreamRules(opts: RulesSyncOptions = {}): Promise<RulesSyncResult> {
  const root = opts.root ?? process.cwd();
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const log = opts.log ?? (() => {});
  const reclassify = opts.reclassify ?? reclassifyStoredDecks;
  const marker = readMarker(root);
  let sha: string | null = null;
  try {
    const res = await fetchImpl(COMMIT_URL, { headers: authHeaders(), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`commit lookup HTTP ${res.status}`);
    const body = (await res.json()) as { sha?: unknown };
    if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) throw new Error("commit lookup returned no sha");
    sha = body.sha;
    if (marker?.appliedSha === sha) {
      const combinedHash = combinedRulesHash(root);
      if (marker.combinedHash === combinedHash) {
        log(`  rules sync: unchanged ${sha.slice(0, 12)}`);
        return { status: "unchanged", sha, appliedSha: sha, ...emptyCounts() };
      }
      try {
        clearFormatDataCache();
        const version = classifierVersion(root);
        const counted = applyCounts(reclassify(new FactStore(root), version));
        writeMarker(root, {
          schemaVersion: 1,
          appliedSha: sha,
          source: marker.source,
          contentHash: marker.contentHash,
          combinedHash,
        });
        log(
          `  rules sync: local overrides changed under ${sha.slice(0, 12)}; ${counted.decksChanged} stored lists changed, ${counted.decksSkipped} kept without a stored list`,
        );
        return { status: "updated", sha, appliedSha: sha, ...counted };
      } catch (error) {
        const message = clip(error);
        log(`  rules sync: kept current labels (${message})`);
        return { status: "failed", sha, appliedSha: marker.appliedSha, error: message, ...emptyCounts() };
      }
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-rules-"));
    const archive = path.join(tmp, "rules.tar.gz");
    try {
      await downloadArchive(fetchImpl, sha, archive);
      await execFileAsync("tar", ["-xzf", archive, "-C", tmp], { timeout: 60_000 });
      const formatsDir = findFormatsDir(tmp);
      validateFormats(formatsDir);
      const contentHash = hashFormats(formatsDir);
      const currentDir = path.join(activeRulesRoot(root), "Formats");
      if (formatsEqual(formatsDir, currentDir)) {
        writeMarker(root, {
          schemaVersion: 1,
          appliedSha: sha,
          source: marker?.source ?? "vendored",
          contentHash,
          combinedHash: combinedHashOf(formatsDir, root),
        });
        log(`  rules sync: ${sha.slice(0, 12)} matches the rules already loaded`);
        return { status: "unchanged", sha, appliedSha: sha, ...emptyCounts() };
      }

      const markerFile = rulesMarkerPath(root);
      const previousMarker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile) : null;
      const backup = installSynced(root, formatsDir);
      let marked = false;
      try {
        writeMarker(root, {
          schemaVersion: 1,
          appliedSha: sha,
          source: "synced",
          contentHash,
          combinedHash: combinedHashOf(formatsDir, root),
        });
        marked = true;
        clearFormatDataCache();
        const version = classifierVersion(root);
        const counted = applyCounts(reclassify(new FactStore(root), version));
        if (backup) fs.rmSync(backup, { recursive: true, force: true });
        log(
          `  rules sync: updated ${sha.slice(0, 12)}; ${counted.decksChanged} stored lists changed, ${counted.decksSkipped} kept without a stored list`,
        );
        return { status: "updated", sha, appliedSha: sha, ...counted };
      } catch (error) {
        if (marked) {
          if (previousMarker) fs.writeFileSync(markerFile, previousMarker);
          else if (fs.existsSync(markerFile)) fs.rmSync(markerFile);
        }
        rollbackSynced(root, backup);
        clearFormatDataCache();
        throw error;
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (error) {
    const message = clip(error);
    log(`  rules sync: kept current rules (${message})`);
    return { status: "failed", sha, appliedSha: marker?.appliedSha ?? null, error: message, ...emptyCounts() };
  }
}
