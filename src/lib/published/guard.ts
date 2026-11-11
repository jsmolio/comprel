import fs from "node:fs";

/**
 * Fail a build when a snapshot file is present but unusable.
 * A missing file is the explicit "not published yet" state and is allowed.
 */
export function assertSnapshotFile(file: string, label = "data/published/snapshot.json"): void {
  if (!fs.existsSync(file)) return;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Refusing to build: ${label} could not be read (${(error as Error).message}).`);
  }
  let parsed: { schemaVersion?: unknown; status?: unknown };
  try {
    parsed = JSON.parse(text) as { schemaVersion?: unknown; status?: unknown };
  } catch (error) {
    throw new Error(`Refusing to build: ${label} could not be parsed (${(error as Error).message}).`);
  }
  if (!parsed || parsed.schemaVersion !== 1 || parsed.status !== "ok") {
    throw new Error(
      `Refusing to build: snapshot schema is not usable (schemaVersion=${String(parsed?.schemaVersion)}, status=${String(parsed?.status)}).`,
    );
  }
}
