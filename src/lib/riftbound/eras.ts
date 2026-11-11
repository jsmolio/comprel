import fs from "node:fs";
import path from "node:path";

export interface EraDef {
  id: string;
  name: string;
  /** Inclusive YYYY-MM-DD. */
  start: string;
  /** Exclusive YYYY-MM-DD. */
  end: string;
}

export interface BanDef {
  date: string;
  card: string;
  kind: "card" | "battlefield" | string;
  printedName?: string;
}

export interface EraFile {
  minPlayers: number;
  eras: EraDef[];
  bans: BanDef[];
}

export const ALL_ERA = "all";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function eraContains(era: EraDef, iso: string): boolean {
  const day = iso.slice(0, 10);
  if (!DATE.test(day) || !DATE.test(era.start) || !DATE.test(era.end)) return false;
  return day >= era.start && day < era.end;
}

export function erasForDate(eras: readonly EraDef[], iso: string): EraDef[] {
  return eras.filter((era) => eraContains(era, iso));
}

export function loadEraFile(root = process.cwd()): EraFile {
  const file = path.join(root, "data", "riftbound", "eras.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as EraFile;
  if (!Array.isArray(parsed.eras) || parsed.eras.length === 0) {
    throw new Error("data/riftbound/eras.json has no eras");
  }
  for (const era of parsed.eras) {
    if (!era.id || !era.name || !DATE.test(era.start) || !DATE.test(era.end) || era.start >= era.end) {
      throw new Error(`Invalid era window for ${era.id ?? "(missing id)"}`);
    }
  }
  return {
    minPlayers: parsed.minPlayers > 0 ? parsed.minPlayers : 8,
    eras: parsed.eras,
    bans: parsed.bans ?? [],
  };
}
