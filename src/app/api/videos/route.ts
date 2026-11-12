import { NextResponse, type NextRequest } from "next/server";
import { archetypeVideos } from "@/lib/queries";
import { loadMagicIndex } from "@/lib/published/magic";
import { loadRiftboundIndex } from "@/lib/published/riftbound";
import { slugify, resolveFormat } from "@/lib/slug";
import { RIFTBOUND_VIDEO_FORMAT } from "@/lib/riftbound/types";

// Snapshot only. YouTube searches happen in the scheduled publisher, not on
// page views, so visitors cannot spend the project quota.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("game") === "riftbound") {
    const legend = (searchParams.get("archetype") ?? searchParams.get("legend") ?? "").trim();
    const loaded = loadRiftboundIndex();
    if (!legend) return NextResponse.json({ videos: [], status: "bad-request" }, { status: 400 });
    if (!loaded.ok) return NextResponse.json({ videos: [], status: "no-snapshot" });
    const names = loaded.snapshot.legends;
    const archetype = names.find((name) => name === legend) ?? names.find((name) => slugify(name) === legend);
    if (!archetype) return NextResponse.json({ videos: [], status: "unknown-archetype" });
    const videos = loaded.snapshot.videos
      .filter((video) => video.format === RIFTBOUND_VIDEO_FORMAT && video.archetype === archetype)
      .map((video) => ({
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        thumbnail: video.thumbnail,
        publishedAt: video.publishedAt,
      }));
    return NextResponse.json({
      videos,
      status: videos.length > 0 ? "ok" : "empty",
      persisted: true,
      videosState: loaded.snapshot.videosState ?? "no-key",
    });
  }
  const format = resolveFormat(searchParams.get("format") ?? "");
  const archetype = (searchParams.get("archetype") ?? "").trim();
  if (!format || !archetype) {
    return NextResponse.json({ videos: [], status: "bad-request" }, { status: 400 });
  }

  const loaded = loadMagicIndex();
  if (!loaded.ok) {
    return NextResponse.json({ videos: [], status: "no-snapshot" });
  }
  const names = loaded.snapshot.formats.find((row) => row.format === format)?.archetypes ?? [];
  if (!names.includes(archetype)) {
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
