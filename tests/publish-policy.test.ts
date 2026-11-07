import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSnapshotBody } from "../src/lib/facts/compute";
import { decidePublish } from "../src/lib/facts/publish-policy";
import { FactStore } from "../src/lib/facts/store";

test("cache holes and structural MTGO failure do not publish", () => {
  assert.equal(decidePublish({ discovered: 0, failed: 0, mtgo: "ok", allowIncompleteMtgo: false }).publish, false);
  assert.equal(decidePublish({ discovered: 10, failed: 2, mtgo: "ok", allowIncompleteMtgo: false }).publish, false);
  assert.equal(
    decidePublish({ discovered: 10, failed: 0, mtgo: "unavailable", allowIncompleteMtgo: false }).publish,
    false,
  );
  const allowed = decidePublish({ discovered: 10, failed: 0, mtgo: "unavailable", allowIncompleteMtgo: true });
  assert.equal(allowed.publish, true);
  assert.match(allowed.reason, /MTGO marked unavailable/);
  assert.equal(decidePublish({ discovered: 10, failed: 0, mtgo: "ok", allowIncompleteMtgo: false }).publish, true);
  assert.equal(decidePublish({ discovered: 10, failed: 0, mtgo: "skipped", allowIncompleteMtgo: false }).publish, true);
});

test("a refused publish does not advance the snapshot file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-hold-"));
  const store = new FactStore(root);
  const body = buildSnapshotBody([], new Map(), { videos: [], banEvents: [], cards: {} }, "v");
  store.writeSnapshot(body, "2026-01-01T00:00:00.000Z");
  const before = fs.readFileSync(store.snapshotFile);
  const decision = decidePublish({ discovered: 4, failed: 0, mtgo: "unavailable", allowIncompleteMtgo: false });
  if (decision.publish) {
    store.writeSnapshot({ ...body, eventCount: 99 }, "2026-02-01T00:00:00.000Z");
  }
  assert.equal(decision.publish, false);
  assert.deepEqual(fs.readFileSync(store.snapshotFile), before);
  assert.equal(store.readSnapshot()?.eventCount, 0);
  assert.equal(store.readSnapshot()?.publishedAt, "2026-01-01T00:00:00.000Z");
});

test("scheduled workflow commits only after a successful backfill", () => {
  const yml = fs.readFileSync(".github/workflows/ingest.yml", "utf8");
  assert.doesNotMatch(yml, /code == ['"]2['"]|exit 2|code -eq 2/);
  assert.doesNotMatch(yml, /if:\s*always\(\)/);
  const backfill = yml.indexOf("pnpm backfill --incremental");
  const commit = yml.indexOf("git push");
  assert.ok(backfill > 0 && commit > backfill);
  assert.match(yml, /non-zero backfill exit skips every later step/i);
});
