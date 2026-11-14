import { cardCategory, CATEGORY_ORDER } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";
import { CardPreview } from "./CardPreview";

export interface CardInfo {
  imageUrl: string | null;
  typeLine: string | null;
  manaCost: string | null;
  priceUsd: string | null;
}
export type CardMap = Map<string, CardInfo>;

function CardLine({ card, info, href }: { card: BoardCard; info?: CardInfo; href?: string | null }) {
  return (
    <li className="flex gap-2 text-sm leading-6">
      <CardPreview name={card.name} count={card.count} imageUrl={info?.imageUrl ?? null} href={href} />
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

export interface DeckSectionView {
  key: string;
  label: string;
  cards: BoardCard[];
  /** Group this zone by card category. The main deck does; runes and the sideboard do not. */
  categorize?: boolean;
}

export function DeckList({
  mainboard,
  sideboard,
  cardMap,
  sections,
  categoryOf = cardCategory,
  categoryOrder = CATEGORY_ORDER,
  cardHref,
}: {
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  cardMap: CardMap;
  sections?: DeckSectionView[];
  categoryOf?: (typeLine: string | null | undefined) => string;
  categoryOrder?: readonly string[];
  cardHref?: (name: string) => string | null;
}) {
  if (sections) {
    return (
      <ZonedDeck sections={sections} cardMap={cardMap} categoryOf={categoryOf} categoryOrder={categoryOrder} cardHref={cardHref} />
    );
  }
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

function ZonedDeck({
  sections,
  cardMap,
  categoryOf,
  categoryOrder,
  cardHref,
}: {
  sections: DeckSectionView[];
  cardMap: CardMap;
  categoryOf: (typeLine: string | null | undefined) => string;
  categoryOrder: readonly string[];
  cardHref?: (name: string) => string | null;
}) {
  const all = sections.flatMap((section) => section.cards);
  const price = deckPrice(all, cardMap);
  const summary = sections
    .map((section) => `${section.cards.reduce((n, card) => n + card.count, 0)} ${section.label.toLowerCase()}`)
    .join(" · ");
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
        <span>{summary}</span>
        {price > 0 && <span className="text-neutral-300">≈ ${price.toFixed(0)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {sections.map((section) => {
          if (section.categorize) {
            const groups = new Map<string, BoardCard[]>();
            for (const card of section.cards) {
              const cat = categoryOf(cardMap.get(card.name)?.typeLine);
              const list = groups.get(cat);
              if (list) list.push(card);
              else groups.set(cat, [card]);
            }
            for (const list of groups.values()) list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
            const ordered = categoryOrder.filter((cat) => groups.has(cat));
            const rest = [...groups.keys()].filter((cat) => !ordered.includes(cat));
            return [...ordered, ...rest].map((cat) => {
              const list = groups.get(cat)!;
              const n = list.reduce((sum, card) => sum + card.count, 0);
              return (
                <div key={`${section.key}-${cat}`} className="break-inside-avoid">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {cat} ({n})
                  </h4>
                  <ul>
                    {list.map((card) => (
                      <CardLine key={card.name} card={card} info={cardMap.get(card.name)} href={cardHref?.(card.name)} />
                    ))}
                  </ul>
                </div>
              );
            });
          }
          if (section.cards.length === 0) return null;
          const n = section.cards.reduce((sum, card) => sum + card.count, 0);
          const accent = section.key === "sideboard";
          return (
            <div key={section.key} className="break-inside-avoid">
              <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${accent ? "text-amber-500/80" : "text-neutral-500"}`}>
                {section.label} ({n})
              </h4>
              <ul>
                {[...section.cards]
                  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
                  .map((card) => (
                    <CardLine key={card.name} card={card} info={cardMap.get(card.name)} href={cardHref?.(card.name)} />
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
