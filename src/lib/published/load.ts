import fs from "node:fs";
import path from "node:path";
import type { Snapshot } from "../facts/types";

export const SNAPSHOT_PATH = path.join(process.cwd(), "data", "published", "snapshot.json");

export type LoadedSnapshot =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: string };

const cached = new Map<string, { mtimeMs: number; snapshot: { schemaVersion: number; status: string } }>();

/** Read a published snapshot. Never opens a database connection. */
export function loadPublished<T extends { schemaVersion: number; status: string } = Snapshot>(
  file = SNAPSHOT_PATH,
  label = "data/published/snapshot.json",
): { ok: true; snapshot: T } | { ok: false; reason: string } {
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      reason: `${label} is not in this deployment. No metagame has been published yet.`,
    };
  }
  const mtimeMs = fs.statSync(file).mtimeMs;
  const hit = cached.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return { ok: true, snapshot: hit.snapshot as T };
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { ok: false, reason: `${label} could not be read (${(error as Error).message}).` };
  }
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch (error) {
    return { ok: false, reason: `${label} could not be parsed (${(error as Error).message}).` };
  }
  if (parsed.schemaVersion !== 1 || parsed.status !== "ok") {
    return {
      ok: false,
      reason: `Snapshot schema is not usable by this build (schemaVersion=${String(parsed.schemaVersion)}, status=${String(parsed.status)}).`,
    };
  }
  cached.set(file, { mtimeMs, snapshot: parsed });
  return { ok: true, snapshot: parsed };
}
