import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_DAILY_SEARCH_CAP,
  acceptVideoHit,
  isVideoDue,
  refreshVideoState,
  selectVideoTargets,
  videoHorizonStart,
  videoKey,
  type VideoBooks,
  type VideoHit,
  type VideoTarget,
} from "../src/lib/facts/videos";
import type { FormatSnap, StoredVideo } from "../src/lib/facts/types";

const today = "2026-11-07";
const horizon = videoHorizonStart(today);
const domain: VideoTarget = { format: "Modern", archetype: "Domain" };
const energy: VideoTarget = { format: "Modern", archetype: "Energy" };

function video(archetype: string, id: string, publishedAt = "2026-11-01T00:00:00Z"): StoredVideo {
  return { id, format: "Modern", archetype, title: id, channelTitle: "channel", publishedAt, thumbnail: null };
}

function books(videos: StoredVideo[], attemptedOn: Record<string, string> = {}, refreshedOn: Record<string, string> = {}): VideoBooks {
  return { videos, attemptedOn, refreshedOn };
}

function hit(id: string, publishedAt: string): VideoHit {
  return { id, title: `Title ${id}`, channelTitle: "channel", publishedAt, thumbnail: null };
}

test("attempt day, not success, decides whether today retries", () => {
  assert.equal(isVideoDue(undefined, today), true);
  assert.equal(isVideoDue("2026-11-06", today), true);
  assert.equal(isVideoDue(today, today), false);
});

test("successful search replaces that archetype and drops links that left the top set", async () => {
  const seen: string[] = [];
  const result = await refreshVideoState(
    books([video("Domain", "dQw4w9WgXcQ"), video("Fringe", "abcdefghijk")]),
    [domain],
    today,
    true,
    async (target) => {
      seen.push(target.archetype);
      return { ok: true, videos: [hit("jNQXAC9IVRw", "2026-11-07T00:00:00Z")] };
    },
  );
  assert.deepEqual(seen, ["Domain"]);
  assert.deepEqual(result.videos.map((item) => item.id), ["jNQXAC9IVRw"]);
  assert.equal(result.refreshedOn[videoKey("Modern", "Domain")], today);
  assert.equal(result.attemptedOn[videoKey("Modern", "Domain")], today);
  assert.equal(result.videosState, "current");
  assert.equal(result.searched, 1);
});

test("a failed search is not retried the same UTC day and stays degraded", async () => {
  let calls = 0;
  const previous = books([video("Domain", "dQw4w9WgXcQ")]);
  const fetchVideos = async () => {
    calls++;
    return { ok: false as const, reason: "quota" as const };
  };
  const first = await refreshVideoState(previous, [domain], today, true, fetchVideos);
  const second = await refreshVideoState(
    { videos: first.videos, attemptedOn: first.attemptedOn, refreshedOn: first.refreshedOn },
    [domain],
    today,
    true,
    fetchVideos,
  );
  assert.equal(calls, 1);
  assert.equal(first.videos[0]?.id, "dQw4w9WgXcQ");
  assert.deepEqual(second.videos, first.videos);
  assert.equal(second.videosState, "degraded");
  assert.equal(second.searched, 0);
  assert.equal(second.refreshedOn[videoKey("Modern", "Domain")], undefined);
});

test("partial success retries neither archetype until the next UTC day", async () => {
  let calls: string[] = [];
  const fetchVideos = async (target: VideoTarget) => {
    calls.push(target.archetype);
    return target.archetype === "Domain"
      ? { ok: false as const, reason: "error" as const }
      : { ok: true as const, videos: [hit("jNQXAC9IVRw", "2026-11-02T00:00:00Z")] };
  };
  const first = await refreshVideoState(books([video("Domain", "dQw4w9WgXcQ"), video("Energy", "abcdefghijk")]), [domain, energy], today, true, fetchVideos);
  calls = [];
  const second = await refreshVideoState(
    { videos: first.videos, attemptedOn: first.attemptedOn, refreshedOn: first.refreshedOn },
    [domain, energy],
    today,
    true,
    fetchVideos,
  );
  assert.deepEqual(calls, []);
  assert.equal(second.searched, 0);
  assert.ok(second.videos.some((item) => item.id === "dQw4w9WgXcQ"));
  assert.ok(second.videos.some((item) => item.id === "jNQXAC9IVRw"));
  assert.equal(second.videosState, "degraded");
  const nextDay = await refreshVideoState(
    { videos: second.videos, attemptedOn: second.attemptedOn, refreshedOn: second.refreshedOn },
    [domain],
    "2026-11-08",
    true,
    async () => ({ ok: true, videos: [hit("M7lc1UVf-VE", "2026-11-08T00:00:00Z")] }),
  );
  assert.equal(nextDay.searched, 1);
  assert.equal(nextDay.videos.find((item) => item.archetype === "Domain")?.id, "M7lc1UVf-VE");
  assert.equal(nextDay.videosState, "current");
});

test("membership churn cannot exceed the daily search cap", async () => {
  const attemptedOn: Record<string, string> = {};
  for (let i = 0; i < VIDEO_DAILY_SEARCH_CAP; i++) attemptedOn[`Seed\u0000A${i}`] = today;
  let calls = 0;
  const result = await refreshVideoState(books([video("Domain", "dQw4w9WgXcQ")], attemptedOn), [domain], today, true, async () => {
    calls++;
    return { ok: true, videos: [] };
  });
  assert.equal(calls, 0);
  assert.equal(result.searched, 0);
  assert.equal(result.videos[0]?.id, "dQw4w9WgXcQ");
  assert.equal(result.videosState, "current");
});

test("no key does not consume an attempt", async () => {
  let calls = 0;
  const previous = books([video("Domain", "dQw4w9WgXcQ")]);
  const result = await refreshVideoState(previous, [domain], today, false, async () => {
    calls++;
    return { ok: true, videos: [] };
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.attemptedOn, {});
  assert.deepEqual(result.videos, previous.videos);
  assert.equal(result.videosState, "no-key");
});

test("a failed search does not delete archetypes outside the current top set", async () => {
  const result = await refreshVideoState(
    books([video("Domain", "dQw4w9WgXcQ"), video("Fringe", "abcdefghijk")]),
    [domain, energy],
    today,
    true,
    async (target) => (target.archetype === "Domain" ? { ok: false, reason: "error" } : { ok: true, videos: [] }),
  );
  assert.ok(result.videos.some((item) => item.id === "abcdefghijk"));
  assert.ok(result.videos.some((item) => item.id === "dQw4w9WgXcQ"));
  assert.equal(result.videosState, "degraded");
});

test("an empty successful search clears that archetype", async () => {
  const result = await refreshVideoState(books([video("Domain", "dQw4w9WgXcQ")]), [domain], today, true, async () => ({
    ok: true,
    videos: [],
  }));
  assert.deepEqual(result.videos, []);
  assert.equal(result.videosState, "current");
});

test("out-of-window and invalid hits are dropped and an all-invalid search clears old links", async () => {
  const old = new Date(Date.parse(horizon) - 86_400_000).toISOString();
  assert.equal(acceptVideoHit(hit("dQw4w9WgXcQ", "2026-11-01T00:00:00Z"), horizon, today), true);
  assert.equal(acceptVideoHit(hit("dQw4w9WgXcQ", old), horizon, today), false);
  assert.equal(acceptVideoHit(hit("short", "2026-11-01T00:00:00Z"), horizon, today), false);
  assert.equal(acceptVideoHit(hit("dQw4w9WgXcQ", "not-a-date"), horizon, today), false);
  assert.equal(acceptVideoHit({ ...hit("dQw4w9WgXcQ", "2026-11-01T00:00:00Z"), title: "  " }, horizon, today), false);
  const result = await refreshVideoState(books([video("Domain", "abcdefghijk")]), [domain], today, true, async () => ({
    ok: true,
    videos: [hit("dQw4w9WgXcQ", old), hit("bad id", "2026-11-01T00:00:00Z")],
  }));
  assert.deepEqual(result.videos, []);
  assert.equal(result.videosState, "current");
  assert.equal(result.refreshedOn[videoKey("Modern", "Domain")], today);
});

test("targets are the top decks in the 30-day all-sources slice", () => {
  const format = {
    format: "Modern",
    slices: { "30:all": { rows: Array.from({ length: 8 }, (_, i) => ({ archetype: `A${i}`, deckCount: 10 - i })) } },
  } as unknown as FormatSnap;
  const targets = selectVideoTargets([format]);
  assert.equal(targets.length, 6);
  assert.equal(VIDEO_DAILY_SEARCH_CAP, 36);
  assert.deepEqual(targets.map((target) => target.archetype), ["A0", "A1", "A2", "A3", "A4", "A5"]);
});
