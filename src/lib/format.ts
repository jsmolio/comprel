import type { Format } from "./types";

// Maps free-text (tournament name + source filename) to one of our tracked
// constructed formats, or null when it's a format we don't surface
// (Limited, Commander, Historic, Alchemy, Pauper-EDH, etc.).
const PATTERNS: [RegExp, Format][] = [
  [/\bpauper\b/i, "Pauper"],
  [/\bvintage\b/i, "Vintage"],
  [/\blegacy\b/i, "Legacy"],
  [/\bmodern\b/i, "Modern"],
  [/\bpioneer\b/i, "Pioneer"],
  [/\bexplorer\b/i, "Pioneer"], // Explorer shares Pioneer's card pool; consolidate.
  [/\bstandard\b/i, "Standard"],
];

// Formats we explicitly exclude even if a keyword coincidentally matches.
const EXCLUDE = /\b(draft|sealed|limited|cube|commander|edh|brawl|historic|alchemy|premodern|oathbreaker|pre-?modern|two-?headed)\b/i;

export function detectFormat(...parts: (string | null | undefined)[]): Format | null {
  const text = parts.filter(Boolean).join(" ");
  if (!text) return null;
  if (EXCLUDE.test(text) && !/\bpauper\b/i.test(text)) return null;
  for (const [re, fmt] of PATTERNS) {
    if (re.test(text)) return fmt;
  }
  return null;
}
