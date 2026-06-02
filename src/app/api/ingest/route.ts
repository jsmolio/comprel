import { NextResponse, type NextRequest } from "next/server";
import { importMtgoCache } from "@/lib/sources/mtgodecklistcache";
import { computeAllAggregates } from "@/lib/analytics/aggregate";
import { enrichCardsFromDb } from "@/lib/sources/scryfall";

// Incremental ingest endpoint for schedulers (Vercel Cron, GitHub Actions, a
// local cron curling it, etc.). Guarded by INGEST_TOKEN / CRON_SECRET when set.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds (subject to hosting plan limits)

function authorized(req: NextRequest): boolean {
  const token = process.env.INGEST_TOKEN || process.env.CRON_SECRET;
  if (!token) return true; // no token configured → allow (local/dev)
  return req.headers.get("authorization") === `Bearer ${token}`;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const startedAt = Date.now();
    const summary = await importMtgoCache({ skipExisting: true, dayFolders: 5 });
    await computeAllAggregates();
    const enriched = await enrichCardsFromDb();
    return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, enriched, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// Vercel Cron issues GET; allow POST for manual triggers too.
export const GET = handle;
export const POST = handle;
