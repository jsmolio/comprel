import { NextResponse, type NextRequest } from "next/server";
import { snapshotHasArchetype, archetypeVideos } from "@/lib/queries";
import { loadPublished } from "@/lib/published/load";
import { findLegend, legendNames } from "@/lib/riftbound/read";
import { RIFTBOUND_SNAPSHOT_LABEL, RIFTBOUND_SNAPSHOT_PATH } from "@/lib/riftbound/paths";
import type { RiftboundSnapshot } from "@/lib/riftbound/types";
import { RIFTBOUND_VIDEO_FORMAT } from "@/lib/riftbound/types";
import { resolveFormat } from "@/lib/slug";

// Snapshot only. YouTube searches happen in the scheduled publisher, not on
// page views, so visitors cannot spend the project quota.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("game") === "riftbound") {
    const legend = (searchParams.get("archetype") ?? searchParams.get("legend") ?? "").trim();
    const loaded = loadPublished<RiftboundSnapshot>(RIFTBOUND_SNAPSHOT_PATH, RIFTBOUND_SNAPSHOT_LABEL);
    if (!legend) return NextResponse.json({ videos: [], status: "bad-request" }, { status: 400 });
    if (!loaded.ok) return NextResponse.json({ videos: [], status: "no-snapshot" });
    const archetype = legendNames(loaded.snapshot).find((name) => name === legend) ?? findLegend(loaded.snapshot, legend);
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
