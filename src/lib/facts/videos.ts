import type { FormatSnap, StoredVideo, VideosState } from "./types";

/** search.list costs 100 YouTube quota units. Default project quota is 10,000 units/day. */
export const VIDEO_TOP_PER_FORMAT = 6;
export const VIDEO_FORMAT_COUNT = 6;
/** Hard cap for the whole UTC day, including failed attempts and archetype churn. */
export const VIDEO_DAILY_SEARCH_CAP = VIDEO_TOP_PER_FORMAT * VIDEO_FORMAT_COUNT;
export const VIDEO_MAX_RESULTS = 6;
/** Drop videos published before this many days. Sent as publishedAfter and checked on each result. */
export const VIDEO_MAX_AGE_DAYS = 90;
export const YOUTUBE_SEARCH_UNITS = 100;
/** 36 searches × 100 units. Failed attempts count. No-key runs spend nothing. */
export const VIDEO_DAILY_QUOTA_UNITS = VIDEO_DAILY_SEARCH_CAP * YOUTUBE_SEARCH_UNITS;

export interface VideoTarget {
  format: string;
  archetype: string;
}

export function videoKey(format: string, archetype: string): string {
  return `${format}\u0000${archetype}`;
}

export function selectVideoTargets(formats: FormatSnap[]): VideoTarget[] {
  const targets: VideoTarget[] = [];
  for (const format of formats) {
    const rows = format.slices["30:all"]?.rows ?? [];
    for (const row of rows.slice(0, VIDEO_TOP_PER_FORMAT)) {
      targets.push({ format: format.format, archetype: row.archetype });
    }
  }
  return targets;
}

/** Due when this archetype has not already consumed an attempt on `today`. */
export function isVideoDue(attemptedOn: string | undefined, today: string): boolean {
  return !attemptedOn || attemptedOn < today;
}

export function videoHorizonStart(today: string, maxAgeDays = VIDEO_MAX_AGE_DAYS): string {
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  start.setUTCDate(start.getUTCDate() - maxAgeDays);
  return start.toISOString();
}

export interface VideoHit {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Local check only. Does not call YouTube. Relevance stays the search order. */
export function acceptVideoHit(hit: VideoHit, horizonStartIso: string, today: string): boolean {
  if (!VIDEO_ID.test(hit.id)) return false;
  if (!hit.title?.trim() || !hit.channelTitle?.trim()) return false;
  if (!hit.publishedAt) return false;
  const published = Date.parse(hit.publishedAt);
  const horizon = Date.parse(horizonStartIso);
  if (Number.isNaN(published) || Number.isNaN(horizon) || published < horizon) return false;
  const latest = Date.parse(`${today}T23:59:59.999Z`) + 86_400_000;
  return published <= latest;
}

export type VideoFetchResult = { ok: true; videos: VideoHit[] } | { ok: false; reason: "quota" | "error" };

export interface VideoBooks {
  videos: StoredVideo[];
  /** Last successful search day. */
  refreshedOn: Record<string, string>;
  /** Last attempt day, success or failure. This is the daily budget ledger. */
  attemptedOn: Record<string, string>;
}

export interface VideoRefreshState extends VideoBooks {
  videosState: VideosState;
}

function canon(videos: StoredVideo[]): string {
  return videos
    .map((video) =>
      [video.format, video.archetype, video.id, video.title, video.channelTitle, video.publishedAt ?? "", video.thumbnail ?? ""].join("\u0001"),
    )
    .sort()
    .join("\u0002");
}

function attemptsToday(attemptedOn: Record<string, string>, today: string): number {
  return Object.values(attemptedOn).filter((day) => day === today).length;
}

function toStored(target: VideoTarget, hits: VideoHit[], horizonStart: string, today: string): StoredVideo[] {
  const seen = new Set<string>();
  const out: StoredVideo[] = [];
  for (const hit of hits) {
    if (!acceptVideoHit(hit, horizonStart, today) || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({
      id: hit.id,
      format: target.format,
      archetype: target.archetype,
      title: hit.title.trim(),
      channelTitle: hit.channelTitle.trim(),
      publishedAt: hit.publishedAt,
      thumbnail: hit.thumbnail,
    });
    if (out.length >= VIDEO_MAX_RESULTS) break;
  }
  return out;
}

function outstandingFailure(
  targets: VideoTarget[],
  attemptedOn: Record<string, string>,
  refreshedOn: Record<string, string>,
  today: string,
): boolean {
  return targets.some((target) => {
    const key = videoKey(target.format, target.archetype);
    return attemptedOn[key] === today && refreshedOn[key] !== today;
  });
}

/**
 * At most VIDEO_DAILY_SEARCH_CAP searches per UTC day, persisted in attemptedOn.
 * A failed search consumes that archetype's attempt and the daily budget, and
 * keeps its previous links. The next retry is the next UTC day, not the next
 * 2-hour run. No API key records nothing.
 */
export async function refreshVideoState(
  previous: VideoBooks,
  targets: VideoTarget[],
  today: string,
  hasKey: boolean,
  fetchVideos: (target: VideoTarget) => Promise<VideoFetchResult>,
): Promise<VideoRefreshState & { changed: boolean; searched: number }> {
  if (!hasKey) {
    return {
      videos: previous.videos,
      refreshedOn: previous.refreshedOn,
      attemptedOn: previous.attemptedOn,
      videosState: "no-key",
      changed: false,
      searched: 0,
    };
  }

  let videos = previous.videos.slice();
  const refreshedOn = { ...previous.refreshedOn };
  const attemptedOn = { ...previous.attemptedOn };
  const horizonStart = videoHorizonStart(today);
  let spent = attemptsToday(attemptedOn, today);
  let searched = 0;

  for (const target of targets) {
    if (spent >= VIDEO_DAILY_SEARCH_CAP) break;
    const key = videoKey(target.format, target.archetype);
    if (!isVideoDue(attemptedOn[key], today)) continue;
    attemptedOn[key] = today;
    spent++;
    searched++;
    const result = await fetchVideos(target);
    if (!result.ok) continue;
    videos = videos.filter((video) => videoKey(video.format, video.archetype) !== key);
    videos.push(...toStored(target, result.videos, horizonStart, today));
    refreshedOn[key] = today;
  }

  const failed = outstandingFailure(targets, attemptedOn, refreshedOn, today);
  const caughtUp = targets.every((target) => refreshedOn[videoKey(target.format, target.archetype)] === today);
  if (!failed && caughtUp) {
    const keep = new Set(targets.map((target) => videoKey(target.format, target.archetype)));
    videos = videos.filter((video) => keep.has(videoKey(video.format, video.archetype)));
    for (const key of Object.keys(refreshedOn)) if (!keep.has(key)) delete refreshedOn[key];
    for (const key of Object.keys(attemptedOn)) {
      if (!keep.has(key) && attemptedOn[key] < today) delete attemptedOn[key];
    }
  }

  return {
    videos,
    refreshedOn,
    attemptedOn,
    videosState: failed ? "degraded" : "current",
    changed: canon(videos) !== canon(previous.videos),
    searched,
  };
}
