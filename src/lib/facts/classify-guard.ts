import { classify, type Classification } from "../archetype/classify";
import type { BoardCard } from "../types";

/**
 * Classify only a payload that was just fetched from the source.
 * A missing fetch must not fall through to empty boards: those classify as
 * "Unknown" and would wipe a good label after decklists were pruned.
 */
export function classifyFetched(
  format: string,
  mainboard: BoardCard[] | null | undefined,
  sideboard: BoardCard[] | null | undefined,
  fetched: boolean,
): Classification | null {
  if (!fetched) return null;
  return classify(format, mainboard ?? [], sideboard ?? []);
}
