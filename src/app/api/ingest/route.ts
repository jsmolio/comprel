import { NextResponse } from "next/server";

// The public ingest route used to write tournaments when no secret was set.
// Publishing is the scheduled workflow only. This route never writes, with or
// without a secret.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "ingest-disabled",
      detail: "Publishing runs in the scheduled GitHub workflow. This endpoint does not accept writes.",
    },
    { status: 410 },
  );
}

export const GET = gone;
export const POST = gone;
