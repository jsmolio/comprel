import { prisma } from "../db";
import { FORMATS } from "../types";

// YouTube Data API v3 search. Pulls gameplay / sideboard-guide videos per
// archetype by keyword. Degrades gracefully (no-op) when YOUTUBE_API_KEY is
// unset. https://developers.google.com/youtube/v3/docs/search/list

const SEARCH = "https://www.googleapis.com/youtube/v3/search";

interface YtItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: { medium?: { url: string }; high?: { url: string } };
  };
}

export function youtubeEnabled(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/** Search + cache up to `max` videos for one archetype. Returns count stored. */
export async function searchArchetypeVideos(format: string, archetype: string, max = 6): Promise<number> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return 0;

  const q = `MTG ${format} ${archetype} gameplay`;
  const url = `${SEARCH}?part=snippet&type=video&maxResults=${max}&order=relevance&q=${encodeURIComponent(q)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { items: YtItem[] };

  let stored = 0;
  for (const it of data.items ?? []) {
    const id = it.id?.videoId;
    if (!id) continue;
    const thumbnail = it.snippet.thumbnails?.medium?.url ?? it.snippet.thumbnails?.high?.url ?? null;
    await prisma.video.upsert({
      where: { id },
      create: {
        id,
        format,
        archetype,
        title: it.snippet.title,
        channelTitle: it.snippet.channelTitle,
        publishedAt: new Date(it.snippet.publishedAt),
        thumbnail,
      },
      update: { format, archetype, title: it.snippet.title, channelTitle: it.snippet.channelTitle, thumbnail },
    });
    stored++;
  }
  return stored;
}

/** Refresh videos for the most-played archetypes in each format. */
export async function refreshVideos(opts: { perFormatTop?: number; log?: (m: string) => void } = {}): Promise<number> {
  const top = opts.perFormatTop ?? 8;
  const log = opts.log ?? (() => {});
  if (!youtubeEnabled()) {
    log("YOUTUBE_API_KEY not set — skipping video refresh.");
    return 0;
  }

  let total = 0;
  for (const format of FORMATS) {
    const archs = await prisma.archetypeStat.findMany({
      where: { format, windowDays: 30, source: "all" },
      orderBy: { deckCount: "desc" },
      take: top,
      select: { archetype: true },
    });
    for (const a of archs) {
      try {
        total += await searchArchetypeVideos(format, a.archetype);
      } catch (e) {
        log(`  ! ${format}/${a.archetype}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 150)); // pace API usage
    }
    log(`  ${format}: refreshed ${archs.length} archetypes`);
  }
  return total;
}
