import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INPUTS = [
  path.join("src", "lib", "archetype", "classify.ts"),
  path.join("src", "lib", "archetype", "colors.ts"),
  path.join("src", "lib", "formatdata.ts"),
  path.join("data", "mtgoformatdata"),
  path.join("data", "rule-overrides"),
];

function addFile(hash: ReturnType<typeof createHash>, file: string, root: string) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  hash.update(rel);
  hash.update("\0");
  hash.update(fs.readFileSync(file));
  hash.update("\0");
}

function walk(hash: ReturnType<typeof createHash>, dir: string, root: string) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(hash, full, root);
    else if (st.isFile()) addFile(hash, full, root);
  }
}

/** Stable hash of the classifier and the vendored rules. Stored on each event. */
export function classifierVersion(root = process.cwd()): string {
  const hash = createHash("sha256");
  for (const rel of INPUTS) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(hash, full, root);
    else addFile(hash, full, root);
  }
  return hash.digest("hex").slice(0, 16);
}
