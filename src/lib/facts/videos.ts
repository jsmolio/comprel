import type { FormatSnap, StoredVideo, VideosState } from "./types";
import type { Format } from "../types";

/** search.list costs 100 YouTube quota units. Default project quota is 10,000 units/day. */
export const VIDEO_TOP_PER_FORMAT = 6;
export const VIDEO_MAX_RESULTS = 6;
/** One successful search per archetype per UTC day. The 2-hour ingest does not search again that day. */
export const YOUTUBE_SEARCH_UNITS = 100;

export interface VideoTarget {
  format: Format;
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

export function isVideoDue(refreshedOn: string | undefined, today: string): boolean {
  return !refreshedOn || refreshedOn < today;
}

export interface VideoHit {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string | null;
}

export type VideoFetchResult = { ok: true; videos: VideoHit[] } | { ok: false; reason: "quota" | "error" };

export interface VideoRefreshState {
  videos: StoredVideo[];
  refreshedOn: Record<string, string>;
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

function toStored(target: VideoTarget, hits: VideoHit[]): StoredVideo[] {
  const seen = new Set<string>();
  const out: StoredVideo[] = [];
  for (const hit of hits) {
    if (!hit.id || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({
      id: hit.id,
      format: target.format,
      archetype: target.archetype,
      title: hit.title,
      channelTitle: hit.channelTitle,
      publishedAt: hit.publishedAt,
      thumbnail: hit.thumbnail,
    });
    if (out.length >= VIDEO_MAX_RESULTS) break;
  }
  return out;
}

/**
 * Replace a due archetype's links only after a successful search.
 * A failed or quota-blocked search keeps that archetype's previous links.
 * Archetypes that fell out of the top set are removed only when every search
 * attempted in this run succeeded.
 */
export async function refreshVideoState(
  previous: { videos: StoredVideo[]; refreshedOn: Record<string, string> },
  targets: VideoTarget[],
  today: string,
  hasKey: boolean,
  fetchVideos: (target: VideoTarget) => Promise<VideoFetchResult>,
): Promise<VideoRefreshState & { changed: boolean }> {
  if (!hasKey) {
    return {
      videos: previous.videos,
      refreshedOn: previous.refreshedOn,
      videosState: "no-key",
      changed: false,
    };
  }

  let videos = previous.videos.slice();
  const refreshedOn = { ...previous.refreshedOn };
  let failed = false;
  const attempted = new Set<string>();

  for (const target of targets) {
    const key = videoKey(target.format, target.archetype);
    if (!isVideoDue(refreshedOn[key], today)) continue;
    attempted.add(key);
    const result = await fetchVideos(target);
    if (!result.ok) {
      failed = true;
      continue;
    }
    videos = videos.filter((video) => videoKey(video.format, video.archetype) !== key);
    videos.push(...toStored(target, result.videos));
    refreshedOn[key] = today;
  }

  if (!failed) {
    const keep = new Set(targets.map((target) => videoKey(target.format, target.archetype)));
    videos = videos.filter((video) => keep.has(videoKey(video.format, video.archetype)));
    for (const key of Object.keys(refreshedOn)) {
      if (!keep.has(key)) delete refreshedOn[key];
    }
  }

  const changed = canon(videos) !== canon(previous.videos);
  return {
    videos,
    refreshedOn,
    videosState: failed ? "degraded" : "current",
    changed,
  };
}
