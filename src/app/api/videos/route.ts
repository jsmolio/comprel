import { NextResponse, type NextRequest } from "next/server";
import { snapshotHasArchetype, archetypeVideos } from "@/lib/queries";
import { loadPublished } from "@/lib/published/load";
import { resolveFormat } from "@/lib/slug";
import { searchYoutube, youtubeEnabled } from "@/lib/sources/youtube-search";

// Videos baked into the snapshot (from a read-only DB export) are returned as-is.
// If none are cached and YOUTUBE_API_KEY is set, this searches YouTube and
// returns the hits without writing them anywhere. There is no database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = resolveFormat(searchParams.get("format") ?? "");
  const archetype = (searchParams.get("archetype") ?? "").trim();
  if (!format || !archetype) {
    return NextResponse.json({ videos: [], status: "bad-request" }, { status: 400 });
  }

  const loaded = loadPublished();
  if (!loaded.ok) {
    return NextResponse.json({ videos: [], status: "no-snapshot" });
  }
  if (!snapshotHasArchetype(loaded.snapshot, format, archetype)) {
    return NextResponse.json({ videos: [], status: "unknown-archetype" });
  }

  const cached = archetypeVideos(loaded.snapshot, format, archetype);
  if (cached.length > 0) {
    return NextResponse.json({ videos: cached, status: "ok", persisted: true });
  }
  if (!youtubeEnabled()) {
    return NextResponse.json({ videos: [], status: "disabled", persisted: false });
  }
  try {
    const videos = await searchYoutube(format, archetype);
    return NextResponse.json({
      videos,
      status: videos.length > 0 ? "ok" : "empty",
      persisted: false,
    });
  } catch (e) {
    return NextResponse.json({ videos: [], status: "error", error: (e as Error).message, persisted: false }, { status: 502 });
  }
}
