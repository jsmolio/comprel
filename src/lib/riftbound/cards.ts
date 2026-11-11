import { colorNameFromDomains, domainLabel } from "./domains";
import type { RiftboundCardSnap } from "./types";

interface CatalogCard {
  slug?: string;
  name?: string;
  types?: string[];
  domains?: string[];
}

interface CatalogPrinting {
  cardId?: string;
  language?: string;
  images?: { imageId?: string }[];
  canonicalRank?: number;
}

interface PriceRow {
  tcgplayer?: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  legend: "Legend",
  unit: "Unit",
  rune: "Rune",
  spell: "Spell",
  gear: "Gear",
  battlefield: "Battlefield",
};

export function imageUrlFor(imageId: string | null | undefined): string | null {
  if (!imageId) return null;
  return `https://openrift.app/media/cards/${imageId}-400w.webp`;
}

export function typeLineFor(types: readonly string[] | undefined): string | null {
  if (!types?.length) return null;
  return types.map((type) => TYPE_LABEL[type] ?? type).join(" ");
}

/**
 * Index the OpenRift catalog by card name. Prices are TCGplayer cents.
 * Image files stay on OpenRift; this only keeps the hotlink.
 */
export function indexCatalog(
  catalog: unknown,
  prices: unknown,
): { byName: Map<string, RiftboundCardSnap>; legendColors: Map<string, string> } {
  const byName = new Map<string, RiftboundCardSnap>();
  const legendColors = new Map<string, string>();
  const root = catalog && typeof catalog === "object" ? (catalog as { cards?: Record<string, CatalogCard>; printings?: Record<string, CatalogPrinting> }) : null;
  const cards = root?.cards ?? {};
  const printings = root?.printings ?? {};
  const priceRoot = prices && typeof prices === "object" ? (prices as { prices?: Record<string, PriceRow> }).prices ?? {} : {};

  const bestImage = new Map<string, { rank: number; imageId: string | null }>();
  const bestPrice = new Map<string, number>();
  for (const [printingId, printing] of Object.entries(printings)) {
    if (!printing.cardId || (printing.language && printing.language !== "EN")) continue;
    const imageId = printing.images?.find((image) => image.imageId)?.imageId ?? null;
    const rank = printing.canonicalRank ?? 999;
    const current = bestImage.get(printing.cardId);
    if (imageId && (!current || rank < current.rank)) bestImage.set(printing.cardId, { rank, imageId });
    const cents = priceRoot[printingId]?.tcgplayer;
    if (typeof cents === "number" && cents >= 0) {
      const prev = bestPrice.get(printing.cardId);
      if (prev == null || cents < prev) bestPrice.set(printing.cardId, cents);
    }
  }

  for (const [cardId, card] of Object.entries(cards)) {
    if (!card.name) continue;
    const domains = (card.domains ?? []).map((domain) => domainLabel(domain)).filter((domain): domain is NonNullable<typeof domain> => domain != null);
    const cents = bestPrice.get(cardId);
    const snap: RiftboundCardSnap = {
      imageUrl: imageUrlFor(bestImage.get(cardId)?.imageId),
      typeLine: typeLineFor(card.types),
      priceUsd: cents == null ? null : (cents / 100).toFixed(2),
      slug: card.slug ?? null,
      domains: domains.map(String),
    };
    const key = card.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, snap);
    if (card.types?.includes("legend")) {
      const color = colorNameFromDomains(card.domains ?? []);
      if (color) legendColors.set(card.name, color);
    }
  }
  return { byName, legendColors };
}

function foldName(value: string): string {
  return value.replace(/[’']/g, "'").trim().toLowerCase();
}

/**
 * Standings use "Champion, Title". OpenRift legend cards are usually just the title
 * ("Daughter of the Void", sometimes "Wuju Bladesman, Starter").
 */
export function legendColorFor(standingName: string, legendColors: Map<string, string> | null | undefined): string | null {
  if (!legendColors || legendColors.size === 0) return null;
  const folded = new Map<string, { name: string; color: string }>();
  for (const [name, color] of legendColors) folded.set(foldName(name), { name, color });
  const exact = folded.get(foldName(standingName));
  if (exact) return exact.color;
  const title = standingName.includes(",") ? standingName.split(",").slice(1).join(",").trim() : standingName;
  const titled = folded.get(foldName(title));
  if (titled) return titled.color;
  const needle = foldName(title);
  let best: { color: string; length: number } | null = null;
  for (const [name, entry] of folded) {
    if (name === needle || name.startsWith(`${needle},`) || name.startsWith(`${needle} `)) {
      if (!best || entry.name.length > best.length) best = { color: entry.color, length: entry.name.length };
    }
  }
  return best?.color ?? null;
}

export function stubsFor(names: readonly string[], byName: Map<string, RiftboundCardSnap>): Record<string, RiftboundCardSnap> {
  const out: Record<string, RiftboundCardSnap> = {};
  for (const name of names) {
    const snap = byName.get(name.toLowerCase());
    if (snap) out[name] = snap;
  }
  return out;
}
