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
  assert.equal(decidePublish({ discovered: 10, failed: 0, mtgo: "partial", allowIncompleteMtgo: false }).publish, true);
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

test("scheduled workflow commits a successful game without blocking on the other", () => {
  const yml = fs.readFileSync(".github/workflows/ingest.yml", "utf8");
  assert.doesNotMatch(yml, /code == ['"]2['"]|exit 2|code -eq 2/);
  assert.doesNotMatch(yml, /if:\s*always\(\)/);
  assert.match(yml, /cron: "0 \*\/2 \* \* \*"/);
  assert.match(yml, /timeout-minutes:\s*30/);
  assert.match(yml, /cancel-in-progress:\s*false/);
  assert.match(yml, /fail-fast:\s*false/);
  assert.match(yml, /pnpm backfill --incremental/);
  assert.match(yml, /pnpm backfill --incremental --game=riftbound/);
  assert.match(yml, /continue-on-error:\s*true/);
  assert.match(yml, /matrix\.game == 'magic'/);
  assert.match(yml, /needs:\s*ingest/);
  assert.match(yml, /Both game publishes failed/);
  assert.equal(yml.split("git push").length - 1, 1);
  const magic = yml.indexOf("game: magic");
  const rift = yml.indexOf("game: riftbound");
  const commit = yml.indexOf("git push");
  assert.ok(magic > 0 && rift > magic && commit > rift);
});
