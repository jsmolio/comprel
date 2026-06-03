import { prisma } from "../db";
import type { BoardCard } from "../types";

// Enriches cards from Scryfall's official, keyless API. We use the bulk
// collection endpoint (75 names/request) and only fetch cards we don't already
// have, to respect Scryfall's rate guidance. https://scryfall.com/docs/api

const COLLECTION = "https://api.scryfall.com/cards/collection";
const HEADERS = { "User-Agent": "comprel/0.1", Accept: "application/json", "Content-Type": "application/json" };

interface ScryImageUris {
  normal?: string;
  large?: string;
  art_crop?: string;
}
interface ScryCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  colors?: string[];
  oracle_text?: string;
  rarity?: string;
  set?: string;
  image_uris?: ScryImageUris;
  card_faces?: { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; image_uris?: ScryImageUris }[];
  prices?: { usd?: string | null };
}

function images(c: ScryCard): ScryImageUris {
  return c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {};
}

// Normalize for matching Scryfall's canonical names back to decklist names:
// case-insensitive, accent- and ligature-folded (Æther → aether, Lim-Dûl → lim-dul).
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe");

// Split / room / aftermath cards are written "A // B" in decklists, but Scryfall's
// collection endpoint matches them only by a half name — so we query the first half.
const queryName = (n: string) => (n.includes(" // ") ? n.split(" // ")[0].trim() : n);

/** The face whose name matches `name` (for back-face references), else undefined. */
function faceFor(c: ScryCard, name: string) {
  return c.card_faces?.find((f) => f.name && norm(f.name) === norm(name));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch + upsert the given card names (those not already cached). */
export async function enrichCards(names: string[], log: (m: string) => void = () => {}): Promise<number> {
  const unique = [...new Set(names)].filter(Boolean);
  const existing = new Set(
    (await prisma.card.findMany({ where: { name: { in: unique } }, select: { name: true } })).map((c) => c.name),
  );
  const missing = unique.filter((n) => !existing.has(n));
  if (missing.length === 0) return 0;

  let enriched = 0;
  let notFound = 0;
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    try {
      const res = await fetch(COLLECTION, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name: queryName(name) })) }),
      });
      if (!res.ok) {
        log(`    ! scryfall ${res.status} on batch ${i / 75}`);
        await sleep(200);
        continue;
      }
      const data = (await res.json()) as { data: ScryCard[]; not_found?: unknown[] };
      notFound += data.not_found?.length ?? 0;
      // Index returned cards by every name a decklist might use — the full card
      // name AND each face name. Transform / MDFC / flip cards are listed by their
      // FRONT-FACE name (e.g. "Sorin of House Markov"), but Scryfall returns the
      // combined "Front // Back" name. We must store under the name the decklist
      // (and therefore the UI lookup) actually uses, or the card shows no image.
      const byName = new Map<string, ScryCard>();
      for (const c of data.data) {
        byName.set(norm(c.name), c);
        for (const f of c.card_faces ?? []) if (f.name) byName.set(norm(f.name), c);
      }
      for (const name of batch) {
        const c = byName.get(norm(name));
        if (!c) continue; // unmatched (token, typo, etc.) — counted in not_found
        const face = faceFor(c, name);
        const img = face?.image_uris ?? images(c);
        await prisma.card.upsert({
          where: { name }, // key by the decklist's own name, not Scryfall's combined name
          create: {
            name,
            scryfallId: c.id,
            imageUrl: img.normal ?? img.large ?? null,
            artCrop: img.art_crop ?? null,
            manaCost: c.mana_cost ?? face?.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? null,
            cmc: c.cmc ?? null,
            typeLine: c.type_line ?? face?.type_line ?? c.card_faces?.[0]?.type_line ?? null,
            colors: (c.colors ?? []).join(""),
            oracleText: c.oracle_text ?? face?.oracle_text ?? c.card_faces?.[0]?.oracle_text ?? null,
            rarity: c.rarity ?? null,
            setCode: c.set ?? null,
            priceUsd: c.prices?.usd ?? null,
          },
          update: {},
        });
        enriched++;
      }
    } catch (e) {
      log(`    ! scryfall error: ${(e as Error).message}`);
    }
    await sleep(100); // Scryfall asks for ~100ms between requests
  }
  if (notFound) log(`  ${notFound} names had no Scryfall match`);
  return enriched;
}

/** Collect every distinct card name across stored decks and enrich the new ones. */
export async function enrichCardsFromDb(log: (m: string) => void = () => {}): Promise<number> {
  const decks = await prisma.deck.findMany({ select: { mainboard: true, sideboard: true } });
  const names = new Set<string>();
  for (const d of decks) {
    for (const c of (d.mainboard as unknown as BoardCard[]) ?? []) names.add(c.name);
    for (const c of (d.sideboard as unknown as BoardCard[]) ?? []) names.add(c.name);
  }
  log(`  ${names.size} distinct cards referenced`);
  return enrichCards([...names], log);
}
