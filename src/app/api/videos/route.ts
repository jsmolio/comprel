import { NextResponse, type NextRequest } from "next/server";
import { snapshotHasArchetype, archetypeVideos } from "@/lib/queries";
import { loadPublished } from "@/lib/published/load";
import { resolveFormat } from "@/lib/slug";

// Snapshot only. YouTube searches happen in the scheduled publisher, not on
// page views, so visitors cannot spend the project quota.
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

  const videos = archetypeVideos(loaded.snapshot, format, archetype);
  return NextResponse.json({
    videos,
    status: videos.length > 0 ? "ok" : "empty",
    persisted: true,
    videosState: loaded.snapshot.videosState ?? "current",
  });
}
