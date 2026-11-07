const SEARCH = "https://www.googleapis.com/youtube/v3/search";

export interface YoutubeHit {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string | null;
}

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

/** Live YouTube search. Does not persist results. */
export async function searchYoutube(format: string, archetype: string, max = 6): Promise<YoutubeHit[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const q = `MTG ${format} ${archetype} gameplay`;
  const url = `${SEARCH}?part=snippet&type=video&maxResults=${max}&order=relevance&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { items: YtItem[] };
  const hits: YoutubeHit[] = [];
  for (const item of data.items ?? []) {
    const id = item.id?.videoId;
    if (!id) continue;
    hits.push({
      id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt ?? null,
      thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.high?.url ?? null,
    });
  }
  return hits;
}
