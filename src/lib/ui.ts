// Small presentation helpers shared across components.

/** Win-rate -> heatmap color (red at 0%, neutral at 50%, green at 100%). */
export function winrateColor(p: number, alpha = 1): string {
  const hue = Math.round(p * 120); // 0 = red, 120 = green
  return `hsl(${hue} 60% 32% / ${alpha})`;
}

export function pct(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/** Build the page query string that carries both the window and source filters. */
export function pageQuery(windowDays: number, source: string): string {
  return `?window=${windowDays}&source=${source}`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** Coarse card category from a Scryfall type line, for grouping decklists. */
export function cardCategory(typeLine: string | null | undefined): string {
  const t = typeLine ?? "";
  if (/\bLand\b/.test(t)) return "Lands";
  if (/\bCreature\b/.test(t)) return "Creatures";
  if (/\bPlaneswalker\b/.test(t)) return "Planeswalkers";
  if (/\b(Instant|Sorcery)\b/.test(t)) return "Spells";
  if (/\b(Artifact|Enchantment|Battle)\b/.test(t)) return "Artifacts & Enchantments";
  return "Other";
}

export const CATEGORY_ORDER = [
  "Creatures",
  "Planeswalkers",
  "Spells",
  "Artifacts & Enchantments",
  "Lands",
  "Other",
];
