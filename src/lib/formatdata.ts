import fs from "node:fs";
import path from "node:path";

// Loads the MTGOFormatData rule set (archetype definitions, fallbacks, and the
// curated card->color map) vendored under data/mtgoformatdata/Formats.
// Licensed MIT by Badaro/Jiliac: https://github.com/Badaro/MTGOFormatData

const ROOT = path.join(process.cwd(), "data", "mtgoformatdata", "Formats");
// Our local rule customizations, layered on top of the vendored rules so a
// refresh of data/mtgoformatdata can never clobber them. Mirror structure:
// data/rule-overrides/<FormatFolder>/Archetypes/<File>.json
const OVERRIDE_ROOT = path.join(process.cwd(), "data", "rule-overrides");

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
function parseLenient<T>(raw: string): T {
  return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as T;
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

let globalColors: Map<string, string> | null = null;
function loadGlobalColors(): Map<string, string> {
  if (globalColors) return globalColors;
  const m = new Map<string, string>();
  const raw = readJson<{ Lands?: { Name: string; Color: string }[]; NonLands?: { Name: string; Color: string }[] }>(
    path.join(ROOT, "card_colors.json"),
  );
  for (const e of raw.Lands ?? []) m.set(e.Name, e.Color ?? "");
  for (const e of raw.NonLands ?? []) m.set(e.Name, e.Color ?? "");
  globalColors = m;
  return m;
}

const cache = new Map<string, FormatData>();

export function hasFormatData(format: string): boolean {
  return format in FOLDER && fs.existsSync(path.join(ROOT, FOLDER[format]));
}

export function loadFormatData(format: string): FormatData {
  const cached = cache.get(format);
  if (cached) return cached;

  const folder = FOLDER[format];
  if (!folder) throw new Error(`No rule data for format "${format}"`);
  const dir = path.join(ROOT, folder);

  const archMap = readArchetypeMap(path.join(dir, "Archetypes"));
  for (const [file, def] of readArchetypeMap(path.join(OVERRIDE_ROOT, folder, "Archetypes"))) {
    archMap.set(file, def); // local override replaces / adds
  }
  const archetypes = [...archMap.values()];
  const fallbacks = readJsonDir<FallbackDef>(path.join(dir, "Fallbacks"));

  // Per-format color overrides layered on top of the global map.
  const colors = new Map(loadGlobalColors());
  const ovPath = path.join(dir, "color_overrides.json");
  if (fs.existsSync(ovPath)) {
    const ov = readJson<{ Lands?: { Name: string; Color: string }[] | null; NonLands?: { Name: string; Color: string }[] | null }>(ovPath);
    for (const e of ov.Lands ?? []) colors.set(e.Name, e.Color ?? "");
    for (const e of ov.NonLands ?? []) colors.set(e.Name, e.Color ?? "");
  }

  const data: FormatData = { archetypes, fallbacks, colorLookup: (n) => colors.get(n) };
  cache.set(format, data);
  return data;
}
