import { loadFormatData, type ArchetypeDef, type FallbackDef } from "../formatdata";
import { colorName, deckColors } from "./colors";
import type { BoardCard } from "../types";

export interface Classification {
  archetype: string; // display name, e.g. "Izzet Murktide"
  base: string; // archetype without color prefix, e.g. "Murktide"
  colorId: string; // canonical WUBRG subset, e.g. "UR"
  colorName: string; // e.g. "Izzet"
}

/** Condition types the classifier implements. Matching is case-insensitive. */
export const CONDITION_TYPES = [
  "InMainboard",
  "InSideboard",
  "InMainOrSideboard",
  "OneOrMoreInMainboard",
  "OneOrMoreInSideboard",
  "OneOrMoreInMainOrSideboard",
  "TwoOrMoreInMainboard",
  "TwoOrMoreInSideboard",
  "TwoOrMoreInMainOrSideboard",
  "DoesNotContain",
  "DoesNotContainMainboard",
  "DoesNotContainSideboard",
] as const;

const CONDITION_TYPE_SET = new Set<string>(CONDITION_TYPES.map((type) => type.toLowerCase()));

export function knownConditionType(type: string): boolean {
  return CONDITION_TYPE_SET.has(type.trim().toLowerCase());
}

/** Condition types in a parsed rule file that this classifier would ignore. */
export function unknownConditionTypes(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) unknownConditionTypes(item, found);
    return found;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.Type === "string" && "Cards" in obj && !knownConditionType(obj.Type)) found.push(obj.Type);
  for (const nested of Object.values(obj)) unknownConditionTypes(nested, found);
  return found;
}

export function conditionMatches(type: string, cards: string[], mainNames: readonly string[], sideNames: readonly string[] = []): boolean {
  return evalCondition(type, cards, new Set(mainNames), new Set(sideNames));
}

function evalCondition(type: string, cards: string[], main: Set<string>, side: Set<string>): boolean {
  const inMain = (c: string) => main.has(c);
  const inSide = (c: string) => side.has(c);
  const inEither = (c: string) => main.has(c) || side.has(c);
  switch (type.trim().toLowerCase()) {
    case "inmainboard":
      return cards.every(inMain);
    case "insideboard":
      return cards.every(inSide);
    case "inmainorsideboard":
      return cards.every(inEither);
    case "oneormoreinmainboard":
      return cards.some(inMain);
    case "oneormoreinsideboard":
      return cards.some(inSide);
    case "oneormoreinmainorsideboard":
      return cards.some(inEither);
    case "twoormoreinmainboard":
      return cards.filter(inMain).length >= 2;
    case "twoormoreinsideboard":
      return cards.filter(inSide).length >= 2;
    case "twoormoreinmainorsideboard":
      return cards.filter(inEither).length >= 2;
    case "doesnotcontain":
      return !cards.some(inEither);
    case "doesnotcontainmainboard":
      return !cards.some(inMain);
    case "doesnotcontainsideboard":
      return !cards.some(inSide);
    default:
      return false; // unknown condition type -> treat as unmet
  }
}

function conditionsMet(
  conditions: { Type: string; Cards: string[] }[] | undefined,
  main: Set<string>,
  side: Set<string>,
): boolean {
  return (conditions ?? []).every((c) => evalCondition(c.Type, c.Cards ?? [], main, side));
}

/**
 * Classify a decklist into an archetype using the MTGOFormatData rules:
 *   1. the most specific matching archetype definition (most conditions), else
 *   2. the fallback bucket sharing the most signature cards, else
 *   3. an "Unknown" bucket, still labeled by derived color identity.
 */
export function classify(format: string, mainboard: BoardCard[], sideboard: BoardCard[], root = process.cwd()): Classification {
  const data = loadFormatData(format, root);
  const main = new Set(mainboard.map((c) => c.name));
  const side = new Set(sideboard.map((c) => c.name));
  const colorId = deckColors(mainboard, data.colorLookup);
  const cName = colorName(colorId);

  let best: ArchetypeDef | null = null;
  for (const a of data.archetypes) {
    if (conditionsMet(a.Conditions, main, side)) {
      if (!best || (a.Conditions?.length ?? 0) > (best.Conditions?.length ?? 0)) best = a;
    }
  }
  if (best) {
    // Resolve to the most specific matching variant (e.g. Eldrazi -> Broodscale,
    // GenericTron -> Eldrazi Tron). Falls back to the base archetype.
    let chosen: { Name: string; IncludeColorInName?: boolean } = best;
    let chosenConds = -1;
    for (const v of best.Variants ?? []) {
      if (conditionsMet(v.Conditions, main, side) && (v.Conditions?.length ?? 0) > chosenConds) {
        chosenConds = v.Conditions?.length ?? 0;
        chosen = v;
      }
    }
    return {
      base: chosen.Name,
      colorId,
      colorName: cName,
      archetype: chosen.IncludeColorInName ? `${cName} ${chosen.Name}` : chosen.Name,
    };
  }

  let fb: FallbackDef | null = null;
  let fbHits = 0;
  for (const f of data.fallbacks) {
    const hits = (f.CommonCards ?? []).filter((c) => main.has(c) || side.has(c)).length;
    if (hits > fbHits) {
      fbHits = hits;
      fb = f;
    }
  }
  if (fb && fbHits > 0) {
    return {
      base: fb.Name,
      colorId,
      colorName: cName,
      archetype: fb.IncludeColorInName ? `${cName} ${fb.Name}` : fb.Name,
    };
  }

  return { base: "Unknown", colorId, colorName: cName, archetype: `${cName} Unknown` };
}
