import assert from "node:assert/strict";
import test from "node:test";
import { isVideoDue, refreshVideoState, selectVideoTargets, videoKey, type VideoTarget } from "../src/lib/facts/videos";
import type { FormatSnap, StoredVideo } from "../src/lib/facts/types";

const today = "2026-11-07";
const domain: VideoTarget = { format: "Modern", archetype: "Domain" };
const energy: VideoTarget = { format: "Modern", archetype: "Energy" };

function video(archetype: string, id: string, publishedAt = "2026-11-01T00:00:00Z"): StoredVideo {
  return {
    id,
    format: "Modern",
    archetype,
    title: id,
    channelTitle: "channel",
    publishedAt,
    thumbnail: null,
  };
}

test("a fresh archetype is not searched again the same UTC day", () => {
  assert.equal(isVideoDue(undefined, today), true);
  assert.equal(isVideoDue("2026-11-06", today), true);
  assert.equal(isVideoDue(today, today), false);
});

test("successful search replaces that archetype and drops links that left the top set", async () => {
  const seen: string[] = [];
  const result = await refreshVideoState(
    { videos: [video("Domain", "old"), video("Fringe", "fringe")], refreshedOn: {} },
    [domain],
    today,
    true,
    async (target) => {
      seen.push(target.archetype);
      return { ok: true, videos: [{ id: "new", title: "New", channelTitle: "c", publishedAt: "2026-11-07T00:00:00Z", thumbnail: null }] };
    },
  );
  assert.deepEqual(seen, ["Domain"]);
  assert.deepEqual(result.videos.map((item) => item.id), ["new"]);
  assert.equal(result.refreshedOn[videoKey("Modern", "Domain")], today);
  assert.equal(result.videosState, "current");
  assert.equal(result.changed, true);
});

test("quota failure keeps the previous links and does not mark them refreshed", async () => {
  const previous = [video("Domain", "keep")];
  const result = await refreshVideoState(
    { videos: previous, refreshedOn: { [videoKey("Modern", "Domain")]: "2026-11-01" } },
    [domain],
    today,
    true,
    async () => ({ ok: false, reason: "quota" }),
  );
  assert.deepEqual(result.videos, previous);
  assert.equal(result.refreshedOn[videoKey("Modern", "Domain")], "2026-11-01");
  assert.equal(result.videosState, "degraded");
  assert.equal(result.changed, false);
});

test("a failed search does not delete archetypes outside the current top set", async () => {
  const result = await refreshVideoState(
    { videos: [video("Domain", "keep"), video("Fringe", "still")], refreshedOn: {} },
    [domain, energy],
    today,
    true,
    async (target) => (target.archetype === "Domain" ? { ok: false, reason: "error" } : { ok: true, videos: [] }),
  );
  assert.ok(result.videos.some((item) => item.id === "still"));
  assert.ok(result.videos.some((item) => item.id === "keep"));
  assert.equal(result.videosState, "degraded");
});

test("no key does not search and keeps saved links", async () => {
  let calls = 0;
  const previous = [video("Domain", "keep")];
  const result = await refreshVideoState({ videos: previous, refreshedOn: {} }, [domain], today, false, async () => {
    calls++;
    return { ok: true, videos: [] };
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.videos, previous);
  assert.equal(result.videosState, "no-key");
  assert.equal(result.changed, false);
});

test("an empty successful search clears that archetype", async () => {
  const result = await refreshVideoState(
    { videos: [video("Domain", "old")], refreshedOn: {} },
    [domain],
    today,
    true,
    async () => ({ ok: true, videos: [] }),
  );
  assert.deepEqual(result.videos, []);
  assert.equal(result.refreshedOn[videoKey("Modern", "Domain")], today);
  assert.equal(result.videosState, "current");
});

test("an already-refreshed archetype is not fetched", async () => {
  let calls = 0;
  const previous = [video("Domain", "keep")];
  const result = await refreshVideoState(
    { videos: previous, refreshedOn: { [videoKey("Modern", "Domain")]: today } },
    [domain],
    today,
    true,
    async () => {
      calls++;
      return { ok: true, videos: [] };
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(result.videos, previous);
  assert.equal(result.changed, false);
  assert.equal(result.videosState, "current");
});

test("targets are the top decks in the 30-day all-sources slice", () => {
  const format = {
    format: "Modern",
    slices: {
      "30:all": {
        rows: Array.from({ length: 8 }, (_, i) => ({ archetype: `A${i}`, deckCount: 10 - i })),
      },
    },
  } as unknown as FormatSnap;
  const targets = selectVideoTargets([format]);
  assert.equal(targets.length, 6);
  assert.deepEqual(targets.map((target) => target.archetype), ["A0", "A1", "A2", "A3", "A4", "A5"]);
});
