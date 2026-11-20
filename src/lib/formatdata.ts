import fs from "node:fs";
import path from "node:path";

// Loads the MTGOFormatData rule set (archetype definitions, fallbacks, and the
// curated card->color map) vendored under data/mtgoformatdata/Formats.
// Licensed MIT by Badaro/Jiliac: https://github.com/Badaro/MTGOFormatData

const VENDORED_DIR = ["data", "mtgoformatdata"];
// Rules ingested from upstream live here so the scheduled publish, which commits
// data/facts, keeps them. Local overrides still win over this tree.
const SYNCED_DIR = ["data", "facts", "v1", "upstream-rules"];
const MARKER_FILE = ["data", "facts", "v1", "rules-sync.json"];
// Our local rule customizations, layered on top of the vendored or synced rules
// so an upstream refresh can never clobber them. Mirror structure:
// data/rule-overrides/<FormatFolder>/Archetypes/<File>.json
function overrideRoot(root: string): string {
  return path.join(root, "data", "rule-overrides");
}

export interface ArchetypeCond {
  Type: string;
  Cards: string[];
}

/** A more-specific sub-archetype of a base archetype (e.g. Eldrazi -> Broodscale). */
export interface ArchetypeVariantDef {
  Name: string;
  IncludeColorInName?: boolean;
  Conditions: ArchetypeCond[];
}

export interface ArchetypeDef {
  Name: string;
  IncludeColorInName?: boolean;
  Conditions: ArchetypeCond[];
  Variants?: ArchetypeVariantDef[];
}

export interface FallbackDef {
  Name: string;
  IncludeColorInName?: boolean;
  CommonCards: string[];
}

export interface FormatData {
  archetypes: ArchetypeDef[];
  fallbacks: FallbackDef[];
  colorLookup: (name: string) => string | undefined;
}

// Our format name -> MTGOFormatData folder. "Standard" tracks the live folder.
const FOLDER: Record<string, string> = {
  Standard: "Standard",
  Pioneer: "Pioneer",
  Modern: "Modern",
  Legacy: "Legacy",
  Vintage: "Vintage",
  Pauper: "Pauper",
};

// The rule files are authored for Newtonsoft, which tolerates trailing commas;
// strip them so the stricter JSON.parse accepts the files.
export function parseLenientJson<T = unknown>(raw: string): T {
  return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as T;
}

function parseLenient<T>(raw: string): T {
  return parseLenientJson<T>(raw);
}

export function syncedRulesRoot(root = process.cwd()): string {
  return path.join(root, ...SYNCED_DIR);
}

export function rulesMarkerPath(root = process.cwd()): string {
  return path.join(root, ...MARKER_FILE);
}

/** Vendored rules, or the last successful upstream sync when that marker is current. */
export function activeRulesRoot(root = process.cwd()): string {
  const vendored = path.join(root, ...VENDORED_DIR);
  const synced = syncedRulesRoot(root);
  const markerFile = rulesMarkerPath(root);
  try {
    if (!fs.existsSync(markerFile) || !fs.existsSync(path.join(synced, "Formats", "card_colors.json"))) return vendored;
    const parsed = JSON.parse(fs.readFileSync(markerFile, "utf8")) as { appliedSha?: unknown; source?: unknown };
    if (parsed.source === "synced" && typeof parsed.appliedSha === "string" && parsed.appliedSha.length > 0) return synced;
  } catch {
    /* A broken marker keeps the vendored copy. */
  }
  return vendored;
}

export function formatFolders(): string[] {
  return Object.keys(FOLDER);
}

function readJson<T>(file: string): T {
  return parseLenient<T>(fs.readFileSync(file, "utf8"));
}

function readJsonDir<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<T>(path.join(dir, f)));
}

// Archetype files keyed by filename, so an override file replaces the base file
// of the same name (and brand-new override files are simply added).
function readArchetypeMap(dir: string): Map<string, ArchetypeDef> {
  const m = new Map<string, ArchetypeDef>();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    m.set(f, readJson<ArchetypeDef>(path.join(dir, f)));
  }
  return m;
}

const colorCache = new Map<string, Map<string, string>>();
function loadGlobalColors(rulesRoot: string): Map<string, string> {
  const file = path.join(rulesRoot, "Formats", "card_colors.json");
  const cached = colorCache.get(file);
  if (cached) return cached;
  const m = new Map<string, string>();
  const raw = readJson<{ Lands?: { Name: string; Color: string }[]; NonLands?: { Name: string; Color: string }[] }>(file);
  for (const e of raw.Lands ?? []) m.set(e.Name, e.Color ?? "");
  for (const e of raw.NonLands ?? []) m.set(e.Name, e.Color ?? "");
  colorCache.set(file, m);
  return m;
}

const cache = new Map<string, FormatData>();

export function clearFormatDataCache(): void {
  cache.clear();
  colorCache.clear();
}

export function hasFormatData(format: string, root = process.cwd()): boolean {
  return format in FOLDER && fs.existsSync(path.join(activeRulesRoot(root), "Formats", FOLDER[format]));
}

export function loadFormatData(format: string, root = process.cwd()): FormatData {
  const rulesRoot = activeRulesRoot(root);
  const cacheKey = `${rulesRoot}\0${format}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const folder = FOLDER[format];
  if (!folder) throw new Error(`No rule data for format "${format}"`);
  const dir = path.join(rulesRoot, "Formats", folder);

  const archMap = readArchetypeMap(path.join(dir, "Archetypes"));
  for (const [file, def] of readArchetypeMap(path.join(overrideRoot(root), folder, "Archetypes"))) {
    archMap.set(file, def); // local override replaces / adds
  }
  const archetypes = [...archMap.values()];
  const fallbacks = readJsonDir<FallbackDef>(path.join(dir, "Fallbacks"));

  // Per-format color overrides layered on top of the global map.
  const colors = new Map(loadGlobalColors(rulesRoot));
  const ovPath = path.join(dir, "color_overrides.json");
  if (fs.existsSync(ovPath)) {
    const ov = readJson<{ Lands?: { Name: string; Color: string }[] | null; NonLands?: { Name: string; Color: string }[] | null }>(ovPath);
    for (const e of ov.Lands ?? []) colors.set(e.Name, e.Color ?? "");
    for (const e of ov.NonLands ?? []) colors.set(e.Name, e.Color ?? "");
  }

  const data: FormatData = { archetypes, fallbacks, colorLookup: (n) => colors.get(n) };
  cache.set(cacheKey, data);
  return data;
}
