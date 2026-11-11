export interface RiftboundPublishInput {
  /** The event index itself could not be read. */
  listingAvailable: boolean;
  /** Event payloads whose shape did not match the standings/detail contract. */
  shapeFailures: number;
  /** Detail fetches started this run (skips of stored events do not count). */
  attemptedFetches: number;
  /** Events written this run. */
  ingestedThisRun: number;
  /** Events already stored before this run, still readable. */
  storedEvents: number;
  networkFailures: number;
}

export interface RiftboundPublishDecision {
  publish: boolean;
  structural: boolean;
  reason: string;
}

/**
 * One event failing never blocks a publish. The previous snapshot is held only
 * when BoundRift's event list is unavailable, or every fetched payload has a
 * new shape and nothing from this run can be trusted.
 */
export function decideRiftboundPublish(input: RiftboundPublishInput): RiftboundPublishDecision {
  if (!input.listingAvailable) {
    return { publish: false, structural: true, reason: "BoundRift event list unavailable" };
  }
  const everyPayloadRejected =
    input.attemptedFetches > 0 && input.shapeFailures === input.attemptedFetches && input.ingestedThisRun === 0;
  if (everyPayloadRejected) {
    return {
      publish: false,
      structural: true,
      reason: "BoundRift response shape rejected every event",
    };
  }
  const nothingReadable =
    input.attemptedFetches > 0 &&
    input.ingestedThisRun === 0 &&
    input.storedEvents === 0 &&
    input.networkFailures === input.attemptedFetches;
  if (nothingReadable) {
    return { publish: false, structural: true, reason: "BoundRift event payloads unavailable" };
  }
  const partial = input.shapeFailures > 0 || input.networkFailures > 0;
  return { publish: true, structural: false, reason: partial ? "partial coverage" : "listing available" };
}
