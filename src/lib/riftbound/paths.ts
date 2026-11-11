import path from "node:path";
export type { RiftboundSnapshot } from "./types";

export const RIFTBOUND_SNAPSHOT_PATH = path.join(process.cwd(), "data", "published", "riftbound", "snapshot.json");
export const RIFTBOUND_SNAPSHOT_LABEL = "data/published/riftbound/snapshot.json";
