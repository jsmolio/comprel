import type { CardSnap } from "./types";

const COLLECTION = "https://api.scryfall.com/cards/collection";
const HEADERS = { "User-Agent": "comprel/0.1", Accept: "application/json", "Content-Type": "application/json" };

interface ScryCard {
  name: string;
  type_line?: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: { name?: string; type_line?: string; image_uris?: { normal?: string; large?: string } }[];
  prices?: { usd?: string | null };
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe");

const queryName = (n: string) => (n.includes(" // ") ? n.split(" // ")[0].trim() : n);

/**
 * Fill display fields for the names on kept lists. On any failure the previous
 * card map is returned unchanged so a Scryfall blip cannot publish a half-updated set.
 * Only image, type line, and price are kept. Oracle text and the other Scryfall
 * fields the database used to store are not emitted.
 */
export async function enrichCardSnaps(
  names: string[],
  previous: Record<string, CardSnap>,
  log: (message: string) => void = () => {},
): Promise<Record<string, CardSnap>> {
  const missing = [...new Set(names)].filter((name) => name && !previous[name]);
  if (missing.length === 0) return previous;
  const next: Record<string, CardSnap> = { ...previous };
  try {
    for (let i = 0; i < missing.length; i += 75) {
      const batch = missing.slice(i, i + 75);
      const res = await fetch(COLLECTION, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name: queryName(name) })) }),
      });
      if (!res.ok) throw new Error(`scryfall ${res.status}`);
      const data = (await res.json()) as { data: ScryCard[] };
      const byName = new Map<string, ScryCard>();
      for (const card of data.data ?? []) {
        byName.set(norm(card.name), card);
        for (const face of card.card_faces ?? []) if (face.name) byName.set(norm(face.name), card);
      }
      for (const name of batch) {
        const card = byName.get(norm(name));
        if (!card) continue;
        const face = card.card_faces?.find((f) => f.name && norm(f.name) === norm(name));
        const image = face?.image_uris ?? card.image_uris ?? card.card_faces?.[0]?.image_uris;
        next[name] = {
          imageUrl: image?.normal ?? image?.large ?? null,
          typeLine: face?.type_line ?? card.type_line ?? card.card_faces?.[0]?.type_line ?? null,
          priceUsd: card.prices?.usd ?? null,
        };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (error) {
    log(`  ! card images unchanged: ${(error as Error).message}`);
    return previous;
  }
  return next;
}

export function cardNamesFromBoards(boards: Map<string, Record<string, { mainboard: { name: string }[]; sideboard: { name: string }[] }>>): string[] {
  const names = new Set<string>();
  for (const players of boards.values()) {
    for (const board of Object.values(players)) {
      for (const card of board.mainboard) names.add(card.name);
      for (const card of board.sideboard) names.add(card.name);
    }
  }
  return [...names];
}
