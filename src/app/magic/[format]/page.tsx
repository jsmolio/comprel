import { notFound } from "next/navigation";
import { matchupMatrix, metaBreakdown, normalizeSource, normalizeWindow } from "@/lib/queries";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { loadMagicFormatView, loadMagicIndex } from "@/lib/published/magic";
import { loadMagicTournamentIndex } from "@/lib/published/tournaments";
import { resolveFormat, slugify } from "@/lib/slug";
import { FormatTabs } from "@/components/FormatTabs";
import { WindowToggle } from "@/components/WindowToggle";
import { SourceToggle } from "@/components/SourceToggle";
import { MetaShareTable } from "@/components/MetaShareTable";
import { MatchupMatrix } from "@/components/MatchupMatrix";
import { RecentTournaments } from "@/components/RecentTournaments";
import { fmtDate, pageQuery } from "@/lib/ui";
import { presentTournaments } from "@/lib/tournaments/present";
import { filterMagicTournaments } from "@/lib/tournaments/magic";
import { TOURNAMENT_PREVIEW } from "@/lib/tournaments/select";

export default async function FormatPage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string }>;
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const { format: formatSlug } = await params;
  const index = loadMagicIndex();
  if (!index.ok) return <MissingSnapshot reason={index.reason} />;

  const format = resolveFormat(formatSlug);
  if (!format) notFound();

  const sp = await searchParams;
  const windowDays = normalizeWindow(sp.window);
  const source = normalizeSource(sp.source);
  const loaded = loadMagicFormatView(format, windowDays, source);
  if (!loaded.ok) return <MissingSnapshot reason={loaded.reason} />;
  const slug = format.toLowerCase();
  const basePath = `/magic/${slug}`;

  const breakdown = metaBreakdown(loaded.snapshot, format, windowDays, source);
  const matrix = matchupMatrix(loaded.snapshot, format, windowDays, source, 12);
  const tournaments = loadMagicTournamentIndex(format);
  const query = pageQuery(windowDays, source);
  const anchor = loaded.snapshot.formats[0]?.anchor ?? null;
  const filtered = tournaments.available
    ? filterMagicTournaments(tournaments.events, source, anchor, windowDays)
    : [];
  const shown = filtered.slice(0, TOURNAMENT_PREVIEW);
  const cards = presentTournaments(shown, {
    eventHref: (event) => `${basePath}/tournaments/${event.slug}${query}`,
    archetypeHref: (archetype) => `${basePath}/${slugify(archetype)}${query}`,
    formatLabel: format,
  });

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
          No decks in this window and source.
        </p>
      ) : (
        <section>
          <MetaShareTable rows={breakdown.rows} formatSlug={slug} windowDays={windowDays} source={source} />
        </section>
      )}

      {tournaments.available && (
        <section aria-labelledby="recent-tournaments">
          <RecentTournaments
            events={cards}
            moreHref={filtered.length > shown.length ? `${basePath}/tournaments${query}` : null}
            moreLabel={filtered.length > shown.length ? `See all ${filtered.length} tournaments` : null}
          />
        </section>
      )}

      {breakdown.rows.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Head-to-head matchups</h2>
            <p className="text-sm text-neutral-500">
              Win rates between the top {matrix.archetypes.length} archetypes, from round-by-round pairings.
            </p>
          </div>
          <MatchupMatrix matrix={matrix} formatSlug={slug} windowDays={windowDays} source={source} />
        </section>
      )}
    </div>
  );
}
