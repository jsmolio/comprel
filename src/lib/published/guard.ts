import fs from "node:fs";
import path from "node:path";

/**
 * Fail a build when a snapshot file is present but unusable.
 * A missing file is the explicit "not published yet" state and is allowed.
 */
export function assertSnapshotFile(file: string, label = file): void {
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

/**
 * A missing directory is "not published yet". A directory without a usable
 * index, or with any unusable JSON part, fails the build.
 */
export function assertPublishedTree(dir: string, label: string): void {
  if (!fs.existsSync(dir)) return;
  const index = path.join(dir, "index.json");
  if (!fs.existsSync(index)) {
    throw new Error(`Refusing to build: ${label}/index.json is missing.`);
  }
  const files: string[] = [];
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".json")) files.push(full);
    }
  };
  walk(dir);
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    assertSnapshotFile(file, `${label}/${rel}`);
  }
}
