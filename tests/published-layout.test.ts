import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.join(process.cwd(), "data", "published");
const LIMIT = 20 * 1024 * 1024;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("published snapshots are split and each file stays under 20 MB", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "snapshot.json")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "riftbound", "snapshot.json")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "magic", "index.json")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "riftbound", "index.json")), true);
  const files = walk(ROOT);
  assert.ok(files.length > 2);
  for (const file of files) {
    const size = fs.statSync(file).size;
    assert.ok(size < LIMIT, `${path.relative(process.cwd(), file)} is ${size} bytes`);
  }
});
