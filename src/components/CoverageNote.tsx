import type { SnapshotCoverage } from "@/lib/facts/types";

/** Shown only when the published snapshot records a source gap. Absent when coverage is fine. */
export function CoverageNote({ coverage }: { coverage?: SnapshotCoverage }) {
  if (!coverage) return null;
  const stale = coverage.cacheLagDays != null && coverage.cacheLagDays > 2;
  const mtgoDown = coverage.mtgo === "unavailable";
  const mtgoPartial = coverage.mtgo === "partial";
  const budgetLeft = coverage.mtgoUnattemptedEvents
    ? coverage.mtgoUnattemptedEvents.filter((event) => event.reason === "budget").length
    : (coverage.mtgoUnattempted ?? 0);
  if (!stale && !mtgoDown && !mtgoPartial) return null;
  return (
    <p className="max-w-2xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-100/90">
      {mtgoPartial && (
        <>
          {(coverage.mtgoMissed ?? 0) > 0 && (
            <>
              Same-day MTGO scrape missed {coverage.mtgoMissed} event
              {coverage.mtgoMissed === 1 ? "" : "s"}.{" "}
            </>
          )}
          {budgetLeft > 0 && (
            <>
              The scrape budget left {budgetLeft} event{budgetLeft === 1 ? "" : "s"} unattempted.{" "}
            </>
          )}
          Previously stored results for events that were not imported this run are unchanged.{" "}
        </>
      )}
      {mtgoDown && (
        <>
          Same-day MTGO scrape was unavailable. Matchups and shares use the public tournament cache
          {coverage.newestFolderDate ? ` through ${coverage.newestFolderDate}` : ""}.{" "}
        </>
      )}
      {stale && coverage.cacheLagDays != null && (
        <>
          Newest cached tournament day is {coverage.newestFolderDate ?? "unknown"}, {coverage.cacheLagDays} days behind
          the publish clock.
        </>
      )}
    </p>
  );
}
