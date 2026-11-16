import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormatTabs } from "@/components/FormatTabs";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { RecentTournaments } from "@/components/RecentTournaments";
import { SourceToggle } from "@/components/SourceToggle";
import { WindowToggle } from "@/components/WindowToggle";
import { loadMagicFormatView, loadMagicIndex } from "@/lib/published/magic";
import { loadMagicTournamentIndex } from "@/lib/published/tournaments";
import { normalizeSource, normalizeWindow } from "@/lib/queries";
import { resolveFormat, slugify } from "@/lib/slug";
import { filterMagicTournaments } from "@/lib/tournaments/magic";
import { presentTournaments } from "@/lib/tournaments/present";
import { pageQuery } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Recent tournaments — compREL",
};

export default async function MagicTournamentsPage({
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
  const query = pageQuery(windowDays, source);
  const tournaments = loadMagicTournamentIndex(format);
  if (!tournaments.available) notFound();
  const filtered = filterMagicTournaments(
    tournaments.events,
    source,
    loaded.snapshot.formats[0]?.anchor ?? null,
    windowDays,
  );
  const cards = presentTournaments(filtered, {
    eventHref: (event) => `${basePath}/tournaments/${event.slug}${query}`,
    archetypeHref: (archetype) => `${basePath}/${slugify(archetype)}${query}`,
    formatLabel: format,
  });

  return (
    <div className="space-y-8">
      <FormatTabs active={slug} windowDays={windowDays} source={source} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs text-neutral-500">
            <Link href={`${basePath}${query}`} className="hover:text-neutral-300">
              {format}
            </Link>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{format} tournaments</h1>
          <p className="text-sm text-neutral-500">
            Newest events in this window, with their top finishes. Open a decklist to see the cards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle basePath={`${basePath}/tournaments`} windowDays={windowDays} source={source} />
          <WindowToggle basePath={`${basePath}/tournaments`} windowDays={windowDays} source={source} />
        </div>
      </div>
      <RecentTournaments events={cards} intro={false} />
    </div>
  );
}
