import type { SnapshotCoverage } from "./types";

export interface PublishDecisionInput {
  discovered: number;
  failed: number;
  /** Structural MTGO failure. Transient scrape errors are "ok" at this gate; they do not block. */
  mtgo: SnapshotCoverage["mtgo"];
  /**
   * Scheduled publish must leave this false. Set only when the public cache
   * ingest is complete and a missing same-day MTGO scrape should be recorded
   * on the snapshot instead of holding the previous one.
   */
  allowIncompleteMtgo: boolean;
}

export interface PublishDecision {
  publish: boolean;
  reason: string;
}

/**
 * Last-good rule. A snapshot is replaced only when the cache file list was
 * fully ingested and MTGO did not fail structurally, unless the caller opted
 * into publishing a cache-complete snapshot that says MTGO was unavailable.
 */
export function decidePublish(input: PublishDecisionInput): PublishDecision {
  if (input.discovered <= 0) {
    return { publish: false, reason: "no cache files discovered" };
  }
  if (input.failed > 0) {
    return { publish: false, reason: `${input.failed} cache file(s) failed; previous snapshot kept` };
  }
  if (input.mtgo === "unavailable" && !input.allowIncompleteMtgo) {
    return {
      publish: false,
      reason: "MTGO scrape failed structurally; previous snapshot kept",
    };
  }
  return { publish: true, reason: input.mtgo === "unavailable" ? "cache complete; MTGO marked unavailable" : "cache complete" };
}
