import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSnapshotFile } from "../src/lib/published/guard";
import { loadPublished } from "../src/lib/published/load";

test("a missing snapshot is allowed, and the production undefined token fails the build and names the parse error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-guard-"));
  const missing = path.join(root, "missing.json");
  assert.doesNotThrow(() => assertSnapshotFile(missing));
  const absent = loadPublished(missing);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.match(absent.reason, /not in this deployment/);

  const bad = path.join(root, "snapshot.json");
  fs.writeFileSync(bad, '{"schemaVersion":1,"status":"ok","coverage":{"mtgo":"ok","mtgoMissed":undefined}}\n');
  assert.throws(() => assertSnapshotFile(bad), /could not be parsed/);
  const loaded = loadPublished(bad);
  assert.equal(loaded.ok, false);
  if (!loaded.ok) {
    assert.match(loaded.reason, /could not be parsed/);
    assert.match(loaded.reason, /undefined/);
    assert.doesNotMatch(loaded.reason, /could not be read/);
  }

  fs.mkdirSync(path.join(root, "dir.json"));
  const unreadable = loadPublished(path.join(root, "dir.json"));
  assert.equal(unreadable.ok, false);
  if (!unreadable.ok) assert.match(unreadable.reason, /could not be read/);

  const good = path.join(root, "good.json");
  fs.writeFileSync(good, '{"schemaVersion":1,"status":"nope"}\n');
  assert.throws(() => assertSnapshotFile(good), /schema is not usable/);
});
