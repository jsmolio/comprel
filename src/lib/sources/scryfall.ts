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
  card_faces?: { mana_cost?: string; oracle_text?: string; image_uris?: ScryImageUris }[];
  prices?: { usd?: string | null };
}

function images(c: ScryCard): ScryImageUris {
  return c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {};
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
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    try {
      const res = await fetch(COLLECTION, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
      if (!res.ok) {
        log(`    ! scryfall ${res.status} on batch ${i / 75}`);
        await sleep(200);
        continue;
      }
      const data = (await res.json()) as { data: ScryCard[] };
      for (const c of data.data) {
        const img = images(c);
        await prisma.card.upsert({
          where: { name: c.name },
          create: {
            name: c.name,
            scryfallId: c.id,
            imageUrl: img.normal ?? img.large ?? null,
            artCrop: img.art_crop ?? null,
            manaCost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? null,
            cmc: c.cmc ?? null,
            typeLine: c.type_line ?? null,
            colors: (c.colors ?? []).join(""),
            oracleText: c.oracle_text ?? c.card_faces?.[0]?.oracle_text ?? null,
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
