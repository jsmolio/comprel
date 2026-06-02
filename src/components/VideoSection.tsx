"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/ui";

export interface VideoItem {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  publishedAt: string | Date | null;
}

export function VideoSection({
  format,
  archetype,
  initialVideos,
  enabled,
}: {
  format: string;
  archetype: string;
  initialVideos: VideoItem[];
  enabled: boolean;
}) {
  const [videos, setVideos] = useState<VideoItem[]>(initialVideos);
  const [loading, setLoading] = useState(false);
  // "settled" = we already have results or have finished a lazy fetch; prevents
  // refetching while the user stays on the page.
  const settled = useRef(initialVideos.length > 0);

  useEffect(() => {
    if (settled.current || !enabled) return;
    settled.current = true;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/videos?format=${encodeURIComponent(format)}&archetype=${encodeURIComponent(archetype)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => setVideos(d.videos ?? []))
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [format, archetype, enabled]);

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `MTG ${format} ${archetype} gameplay`,
  )}`;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Gameplay videos</h2>
          <p className="text-sm text-neutral-500">Matches and tech for this archetype from content creators.</p>
        </div>
        <a href={searchUrl} target="_blank" rel="noreferrer" className="text-sm text-emerald-500 hover:text-emerald-400">
          Search YouTube ↗
        </a>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
              <div className="aspect-video w-full animate-pulse bg-neutral-800" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-800" />
                <div className="h-2 w-1/3 animate-pulse rounded bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
          {enabled
            ? "No gameplay videos found for this archetype yet — try the search link above."
            : "Video search is off. Set YOUTUBE_API_KEY to enable on-demand video lookup, or use the search link above."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.id}`}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40 transition-colors hover:border-neutral-700"
            >
              {v.thumbnail && (
                <img src={v.thumbnail} alt={v.title} className="aspect-video w-full object-cover" loading="lazy" />
              )}
              <div className="p-3">
                <h3 className="line-clamp-2 text-sm font-medium text-neutral-200 group-hover:text-emerald-400">{v.title}</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  {v.channelTitle}
                  {v.publishedAt ? ` · ${fmtDate(v.publishedAt)}` : ""}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
