/** Counters for one Riftbound ingest pass. Already-stored events are not ingested. */
export interface IngestCounts {
  newlyIngested: number;
  alreadyStored: number;
  skips: { date: string; name: string; reason: string }[];
}

const SOFT_SKIP_REASONS = ["not constructed", "field too small", "too few legends", "no standings", "no rounds"] as const;

export function emptyIngestCounts(): IngestCounts {
  return { newlyIngested: 0, alreadyStored: 0, skips: [] };
}

export function isSoftSkip(reason: string): boolean {
  return (SOFT_SKIP_REASONS as readonly string[]).includes(reason);
}

export function recordAlreadyStored(counts: IngestCounts): void {
  counts.alreadyStored += 1;
}

export function recordIngested(counts: IngestCounts): void {
  counts.newlyIngested += 1;
}

export function recordSkip(
  counts: IngestCounts,
  event: { startDatetime: string | null; name: string },
  reason: string,
): void {
  const date = event.startDatetime?.slice(0, 10) || "undated";
  counts.skips.push({ date, name: event.name, reason });
}

export function ingestCountLine(counts: IngestCounts): string {
  return `${counts.newlyIngested} new, ${counts.alreadyStored} already stored`;
}

export function skipLine(skip: { date: string; name: string; reason: string }): string {
  return `${skip.date} ${skip.name}: ${skip.reason}`;
}
