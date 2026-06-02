import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resolveFormat } from "@/lib/slug";
import { getArchetypeVideos } from "@/lib/queries";
import { searchArchetypeVideos, youtubeEnabled } from "@/lib/sources/youtube";

// Lazy, cache-on-first-view video lookup for a single archetype. The archetype
// page calls this only when it has no cached videos, so YouTube quota is spent
// just for decks people actually open. Results are persisted to the DB, so the
// next viewer (and the next page render) is served from cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = resolveFormat(searchParams.get("format") ?? "");
  const archetype = (searchParams.get("archetype") ?? "").trim();
  if (!format || !archetype) {
    return NextResponse.json({ videos: [], status: "bad-request" }, { status: 400 });
  }

  // Only fetch for archetypes that actually exist in our data — prevents
  // arbitrary queries from burning the YouTube quota.
  const known = await prisma.archetypeStat.findFirst({ where: { format, archetype }, select: { id: true } });
  if (!known) {
    return NextResponse.json({ videos: [], status: "unknown-archetype" });
  }

  let videos = await getArchetypeVideos(format, archetype);
  if (videos.length === 0 && youtubeEnabled()) {
    try {
      await searchArchetypeVideos(format, archetype);
      videos = await getArchetypeVideos(format, archetype);
    } catch (e) {
      return NextResponse.json({ videos, status: "error", error: (e as Error).message }, { status: 502 });
    }
  }

  const status = videos.length > 0 ? "ok" : youtubeEnabled() ? "empty" : "disabled";
  return NextResponse.json({ videos, status });
}
