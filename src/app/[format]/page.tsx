import { notFound } from "next/navigation";
import { getMatchupMatrix, getMetaBreakdown, normalizeSource, normalizeWindow } from "@/lib/queries";
import { resolveFormat } from "@/lib/slug";
import { FormatTabs } from "@/components/FormatTabs";
import { WindowToggle } from "@/components/WindowToggle";
import { SourceToggle } from "@/components/SourceToggle";
import { MetaShareTable } from "@/components/MetaShareTable";
import { MatchupMatrix } from "@/components/MatchupMatrix";
import { fmtDate } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function FormatPage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string }>;
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const { format: formatSlug } = await params;
  const format = resolveFormat(formatSlug);
  if (!format) notFound();

  const sp = await searchParams;
  const windowDays = normalizeWindow(sp.window);
  const source = normalizeSource(sp.source);
  const slug = format.toLowerCase();
  const basePath = `/${slug}`;

  const [breakdown, matrix] = await Promise.all([
    getMetaBreakdown(format, windowDays, source),
    getMatchupMatrix(format, windowDays, source, 12),
  ]);

  return (
    <div className="space-y-8">
      <FormatTabs active={slug} windowDays={windowDays} source={source} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{format} metagame</h1>
          <p className="text-sm text-neutral-500">
            {breakdown.totalDecks} decks · {breakdown.rows.length} archetypes · latest data {fmtDate(breakdown.latest)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle basePath={basePath} windowDays={windowDays} source={source} />
          <WindowToggle basePath={basePath} windowDays={windowDays} source={source} />
        </div>
      </div>

      {breakdown.rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-400">
          No decks in this window/source. Run <code className="text-neutral-200">pnpm ingest</code> to populate data.
        </p>
      ) : (
        <>
          <section>
            <MetaShareTable rows={breakdown.rows} formatSlug={slug} windowDays={windowDays} source={source} />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Head-to-head matchups</h2>
              <p className="text-sm text-neutral-500">
                Win rates between the top {matrix.archetypes.length} archetypes, from round-by-round pairings.
              </p>
            </div>
            <MatchupMatrix matrix={matrix} formatSlug={slug} windowDays={windowDays} source={source} />
          </section>
        </>
      )}
    </div>
  );
}
