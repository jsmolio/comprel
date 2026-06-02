/* eslint-disable @next/next/no-img-element */
import { cardCategory, CATEGORY_ORDER } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";

export interface CardInfo {
  imageUrl: string | null;
  typeLine: string | null;
  manaCost: string | null;
  priceUsd: string | null;
}
export type CardMap = Map<string, CardInfo>;

function CardLine({ card, info }: { card: BoardCard; info?: CardInfo }) {
  return (
    <li className="group relative flex gap-2 text-sm leading-6">
      <span className="w-5 shrink-0 tabular-nums text-neutral-500">{card.count}</span>
      <span className="cursor-default text-neutral-200 group-hover:text-emerald-400">{card.name}</span>
      {info?.imageUrl && (
        <span className="pointer-events-none absolute left-6 top-6 z-30 hidden group-hover:block">
          <img src={info.imageUrl} alt={card.name} width={223} className="rounded-xl shadow-2xl ring-1 ring-black/60" />
        </span>
      )}
    </li>
  );
}

function deckPrice(cards: BoardCard[], cardMap: CardMap): number {
  let total = 0;
  for (const c of cards) {
    const p = Number(cardMap.get(c.name)?.priceUsd);
    if (!Number.isNaN(p)) total += p * c.count;
  }
  return total;
}

export function DeckList({
  mainboard,
  sideboard,
  cardMap,
}: {
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  cardMap: CardMap;
}) {
  const groups = new Map<string, BoardCard[]>();
  for (const c of mainboard) {
    const cat = cardCategory(cardMap.get(c.name)?.typeLine);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }
  for (const list of groups.values()) list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const mainCount = mainboard.reduce((n, c) => n + c.count, 0);
  const sideCount = sideboard.reduce((n, c) => n + c.count, 0);
  const price = deckPrice(mainboard, cardMap) + deckPrice(sideboard, cardMap);
  const orderedCats = CATEGORY_ORDER.filter((c) => groups.has(c));

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-neutral-400">
        <span>{mainCount} mainboard</span>
        <span>{sideCount} sideboard</span>
        {price > 0 && <span className="text-neutral-300">≈ ${price.toFixed(0)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {orderedCats.map((cat) => {
          const list = groups.get(cat)!;
          const n = list.reduce((s, c) => s + c.count, 0);
          return (
            <div key={cat} className="break-inside-avoid">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {cat} ({n})
              </h4>
              <ul>
                {list.map((c) => (
                  <CardLine key={c.name} card={c} info={cardMap.get(c.name)} />
                ))}
              </ul>
            </div>
          );
        })}
        {sideboard.length > 0 && (
          <div className="break-inside-avoid">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-500/80">Sideboard ({sideCount})</h4>
            <ul>
              {[...sideboard]
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
                .map((c) => (
                  <CardLine key={c.name} card={c} info={cardMap.get(c.name)} />
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
