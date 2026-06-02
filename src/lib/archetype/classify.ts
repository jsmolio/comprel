import { loadFormatData, type ArchetypeDef, type FallbackDef } from "../formatdata";
import { colorName, deckColors } from "./colors";
import type { BoardCard } from "../types";

export interface Classification {
  archetype: string; // display name, e.g. "Izzet Murktide"
  base: string; // archetype without color prefix, e.g. "Murktide"
  colorId: string; // canonical WUBRG subset, e.g. "UR"
  colorName: string; // e.g. "Izzet"
}

function evalCondition(type: string, cards: string[], main: Set<string>, side: Set<string>): boolean {
  const inMain = (c: string) => main.has(c);
  const inSide = (c: string) => side.has(c);
  const inEither = (c: string) => main.has(c) || side.has(c);
  switch (type) {
    case "InMainboard":
      return cards.every(inMain);
    case "InSideboard":
      return cards.every(inSide);
    case "InMainOrSideboard":
      return cards.every(inEither);
    case "OneOrMoreInMainboard":
      return cards.some(inMain);
    case "OneOrMoreInSideboard":
      return cards.some(inSide);
    case "OneOrMoreInMainOrSideboard":
      return cards.some(inEither);
    case "TwoOrMoreInMainboard":
      return cards.filter(inMain).length >= 2;
    case "TwoOrMoreInSideboard":
      return cards.filter(inSide).length >= 2;
    case "TwoOrMoreInMainOrSideboard":
      return cards.filter(inEither).length >= 2;
    case "DoesNotContain":
      return !cards.some(inEither);
    case "DoesNotContainMainboard":
      return !cards.some(inMain);
    case "DoesNotContainSideboard":
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
export function classify(format: string, mainboard: BoardCard[], sideboard: BoardCard[]): Classification {
  const data = loadFormatData(format);
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
