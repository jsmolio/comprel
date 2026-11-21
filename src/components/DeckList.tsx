import { mergeBoard } from "@/lib/board";
import { typeLinesFor, type DeckFileLabel } from "@/lib/deck-export";
import { cardCategory, CATEGORY_ORDER } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";
import { CardPreview } from "./CardPreview";
import { DeckExport } from "./DeckExport";

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
  exportMeta,
}: {
  mainboard: BoardCard[];
  sideboard: BoardCard[];
  cardMap: CardMap;
  sections?: DeckSectionView[];
  categoryOf?: (typeLine: string | null | undefined) => string;
  categoryOrder?: readonly string[];
  cardHref?: (name: string) => string | null;
  /** When set on a mainboard/sideboard list, show Arena, MTGO, and plain-text export. */
  exportMeta?: DeckFileLabel;
}) {
  if (sections) {
    return (
      <ZonedDeck sections={sections} cardMap={cardMap} categoryOf={categoryOf} categoryOrder={categoryOrder} cardHref={cardHref} />
    );
  }
  const main = mergeBoard(mainboard);
  const side = mergeBoard(sideboard);
  const groups = new Map<string, BoardCard[]>();
  for (const c of main) {
    const cat = cardCategory(cardMap.get(c.name)?.typeLine);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }
  for (const list of groups.values()) list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const mainCount = main.reduce((n, c) => n + c.count, 0);
  const sideCount = side.reduce((n, c) => n + c.count, 0);
  const price = deckPrice(main, cardMap) + deckPrice(side, cardMap);
  const orderedCats = CATEGORY_ORDER.filter((c) => groups.has(c));

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
          <span>{mainCount} mainboard</span>
          <span>{sideCount} sideboard</span>
          {price > 0 && <span className="text-neutral-300">≈ ${price.toFixed(0)}</span>}
        </div>
        {exportMeta && (
          <DeckExport
            mainboard={main}
            sideboard={side}
            typeLines={typeLinesFor([...main, ...side], (name) => cardMap.get(name)?.typeLine)}
            label={exportMeta}
          />
        )}
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
        {side.length > 0 && (
          <div className="break-inside-avoid">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-500/80">Sideboard ({sideCount})</h4>
            <ul>
              {[...side]
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
  const merged = sections.map((section) => ({ ...section, cards: mergeBoard(section.cards) }));
  const all = merged.flatMap((section) => section.cards);
  const price = deckPrice(all, cardMap);
  const summary = merged
    .map((section) => `${section.cards.reduce((n, card) => n + card.count, 0)} ${section.label.toLowerCase()}`)
    .join(" · ");
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
        <span>{summary}</span>
        {price > 0 && <span className="text-neutral-300">≈ ${price.toFixed(0)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {merged.map((section) => {
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
