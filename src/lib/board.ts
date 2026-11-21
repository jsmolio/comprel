import type { BoardCard } from "./types";

/** Collapse surrounding and repeated whitespace so two printings of one card share a name. */
export function cleanCardName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * One row per card on a single board. MTGO emits a separate row for each catalog
 * object (a promo next to a Special Guests printing, or two arts of the same set).
 * Those rows are pieces of one count, so they add. Main and side stay separate
 * because this only looks at the list it is given. First-seen order is kept.
 */
export function mergeBoard(cards: readonly BoardCard[] | null | undefined): BoardCard[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const card of cards ?? []) {
    const name = cleanCardName(card?.name ?? "");
    if (!name) continue;
    const count = typeof card.count === "number" && Number.isFinite(card.count) ? card.count : 0;
    const prev = counts.get(name);
    if (prev == null) {
      order.push(name);
      counts.set(name, count);
    } else {
      counts.set(name, prev + count);
    }
  }
  return order.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}
