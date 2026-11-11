import type { RiftboundCoverage } from "@/lib/riftbound/types";

/** Shown when BoundRift coverage is partial or PlayRiftbound has not published lists. */
export function RiftboundCoverageNote({ coverage }: { coverage?: RiftboundCoverage }) {
  if (!coverage) return null;
  const partial = coverage.boundrift === "partial" || coverage.boundrift === "unavailable";
  const lag = coverage.playriftboundWithoutLists > 0;
  if (!partial && !lag) return null;
  return (
    <p className="max-w-2xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-100/90">
      {coverage.boundrift === "unavailable" && <>BoundRift was unavailable for this publish. </>}
      {coverage.failed > 0 && (
        <>
          BoundRift ingest missed {coverage.failed} event{coverage.failed === 1 ? "" : "s"}.{" "}
        </>
      )}
      {coverage.unattempted > 0 && (
        <>
          The request budget left {coverage.unattempted} event{coverage.unattempted === 1 ? "" : "s"} unattempted.{" "}
        </>
      )}
      {lag && (
        <>
          PlayRiftbound has {coverage.playriftboundWithoutLists} event{coverage.playriftboundWithoutLists === 1 ? "" : "s"} in
          this window with no published decklists, so those fields are absent from list and card views.{" "}
        </>
      )}
      {(coverage.skippedNoLegend ?? 0) > 0 && (
        <>
          {coverage.skippedNoLegend} events named no legend on the standings or pairings, so they are not in the shares.{" "}
        </>
      )}
      Previously stored results for events that were not imported this run are unchanged.
    </p>
  );
}
