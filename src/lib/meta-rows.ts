/** Named archetypes shown before the disclosure on a format page. */
export const META_PREVIEW_COUNT = 10;

/** Share below this, and any "* Unknown" bucket, folds into Other. */
export const META_TAIL_SHARE = 0.005;

export function isMetaTail(row: { metaShare: number; archetype: string }): boolean {
  return row.metaShare < META_TAIL_SHARE || row.archetype.endsWith("Unknown");
}

export function partitionMetaRows<T extends { metaShare: number; archetype: string }>(
  rows: readonly T[],
  previewCount = META_PREVIEW_COUNT,
): { kept: T[]; tail: T[]; preview: T[]; rest: T[] } {
  const kept = rows.filter((row) => !isMetaTail(row));
  const tail = rows.filter((row) => isMetaTail(row));
  const count = Math.max(0, previewCount);
  return { kept, tail, preview: kept.slice(0, count), rest: kept.slice(count) };
}
