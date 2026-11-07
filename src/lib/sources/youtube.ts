import { prisma } from "../db";
import { FORMATS } from "../types";
import { searchYoutube, youtubeEnabled } from "./youtube-search";

export { youtubeEnabled };

/**
 * Legacy Postgres cache. The site does not call this. Static mode searches
 * YouTube on demand without writing, and durable videos come from `pnpm export-db`.
 */
export async function searchArchetypeVideos(format: string, archetype: string, max = 6): Promise<number> {
  const hits = await searchYoutube(format, archetype, max);
  let stored = 0;
  for (const hit of hits) {
    await prisma.video.upsert({
      where: { id: hit.id },
      create: {
        id: hit.id,
        format,
        archetype,
        title: hit.title,
        channelTitle: hit.channelTitle,
        publishedAt: hit.publishedAt ? new Date(hit.publishedAt) : null,
        thumbnail: hit.thumbnail,
      },
      update: { format, archetype, title: hit.title, channelTitle: hit.channelTitle, thumbnail: hit.thumbnail },
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
