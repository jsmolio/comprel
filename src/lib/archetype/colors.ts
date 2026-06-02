import type { BoardCard } from "../types";

const ORDER = "WUBRG";

// WUBRG-subset (canonical order) -> human guild/shard/wedge name.
export const COLOR_NAMES: Record<string, string> = {
  "": "Colorless",
  W: "Mono-White",
  U: "Mono-Blue",
  B: "Mono-Black",
  R: "Mono-Red",
  G: "Mono-Green",
  WU: "Azorius",
  WB: "Orzhov",
  WR: "Boros",
  WG: "Selesnya",
  UB: "Dimir",
  UR: "Izzet",
  UG: "Simic",
  BR: "Rakdos",
  BG: "Golgari",
  RG: "Gruul",
  WUB: "Esper",
  WUR: "Jeskai",
  WUG: "Bant",
  WBR: "Mardu",
  WBG: "Abzan",
  WRG: "Naya",
  UBR: "Grixis",
  UBG: "Sultai",
  URG: "Temur",
  BRG: "Jund",
  WUBR: "Yore",
  WUBG: "Witch",
  WURG: "Ink",
  WBRG: "Dune",
  UBRG: "Glint",
  WUBRG: "Five-Color",
};

/** Reduce an arbitrary set of color letters to a canonical WUBRG-ordered string. */
export function canonicalColors(letters: Iterable<string>): string {
  const set = new Set<string>();
  for (const l of letters) if (ORDER.includes(l)) set.add(l);
  return [...ORDER].filter((c) => set.has(c)).join("");
}

export function colorName(canon: string): string {
  if (canon in COLOR_NAMES) return COLOR_NAMES[canon];
  if (canon.length === 4) return "Four-Color";
  return canon || "Colorless";
}

// Inverse of COLOR_NAMES, for turning a stored color name back into WUBRG pips.
const NAME_TO_COLOR_ID: Record<string, string> = Object.fromEntries(
  Object.entries(COLOR_NAMES)
    .filter(([id]) => id !== "")
    .map(([id, name]) => [name, id]),
);

export function colorNameToId(name: string | null | undefined): string {
  if (!name) return "";
  return NAME_TO_COLOR_ID[name] ?? "";
}

/**
 * Derive a deck's color identity from its mainboard using a curated card->color
 * lookup. A color counts when its total weighted card count clears `threshold`,
 * which filters out single-card splashes from flipping the name.
 */
export function deckColors(
  mainboard: BoardCard[],
  lookup: (name: string) => string | undefined,
  threshold = 3,
): string {
  const counts: Record<string, number> = {};
  for (const { name, count } of mainboard) {
    const cs = lookup(name);
    if (!cs) continue;
    for (const c of cs) counts[c] = (counts[c] ?? 0) + count;
  }
  let letters = [...ORDER].filter((c) => (counts[c] ?? 0) >= threshold);
  if (letters.length === 0) letters = [...ORDER].filter((c) => (counts[c] ?? 0) > 0);
  return canonicalColors(letters);
}
