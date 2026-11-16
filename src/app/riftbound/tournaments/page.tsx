import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EraToggle } from "@/components/EraToggle";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { RecentTournaments } from "@/components/RecentTournaments";
import { SourceToggle } from "@/components/SourceToggle";
import { WindowToggle } from "@/components/WindowToggle";
import { loadRiftboundIndex, loadRiftboundMetaView } from "@/lib/published/riftbound";
import { loadRiftboundTournamentIndex } from "@/lib/published/tournaments";
import { ALL_ERA } from "@/lib/riftbound/eras";
import { normalizeEra, normalizeRiftboundSource, normalizeRiftboundWindow } from "@/lib/riftbound/read";
import { RIFTBOUND_SOURCE_LABELS, RIFTBOUND_SOURCES } from "@/lib/riftbound/sources";
import { slugify } from "@/lib/slug";
import { filterRiftboundTournaments } from "@/lib/tournaments/riftbound";
import { presentTournaments } from "@/lib/tournaments/present";
import { pageQuery } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Riftbound tournaments — compREL",
};

export default async function RiftboundTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; source?: string; era?: string }>;
}) {
  const index = loadRiftboundIndex();
  if (!index.ok) {
    return (
      <MissingSnapshot
        reason={index.reason}
        note="Build the first Riftbound snapshot with pnpm backfill --game=riftbound --days=90."
      />
    );
  }
  const sp = await searchParams;
  const windowDays = normalizeRiftboundWindow(sp.window);
  const source = normalizeRiftboundSource(sp.source);
  const era = normalizeEra(sp.era, index.snapshot.eras);
  const loaded = loadRiftboundMetaView(windowDays, source, era);
  if (!loaded.ok) {
    return (
      <MissingSnapshot
        reason={loaded.reason}
        note="Build the first Riftbound snapshot with pnpm backfill --game=riftbound --days=90."
      />
    );
  }
  const tournaments = loadRiftboundTournamentIndex();
  if (!tournaments.available) notFound();
  const extra = era === ALL_ERA ? undefined : { era };
  const query = pageQuery(windowDays, source, extra);
  const eraDef = era === ALL_ERA ? null : (index.snapshot.eras.find((item) => item.id === era) ?? null);
  const filtered = filterRiftboundTournaments(tournaments.events, source, loaded.snapshot.anchor, windowDays, eraDef);
  const cards = presentTournaments(filtered, {
    eventHref: (event) => `/riftbound/tournaments/${event.slug}${query}`,
    archetypeHref: (archetype) => `/riftbound/${slugify(archetype)}${query}`,
    formatLabel: "Constructed",
  });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          <Link href={`/riftbound${query}`} className="hover:text-neutral-300">
            Riftbound
          </Link>
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Riftbound tournaments</h1>
        <p className="text-sm text-neutral-500">
          Newest events in this window, with their top finishes. Open a decklist to see the cards.
        </p>
        <EraToggle basePath="/riftbound/tournaments" windowDays={windowDays} source={source} era={era} eras={index.snapshot.eras} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SourceToggle
          basePath="/riftbound/tournaments"
          windowDays={windowDays}
          source={source}
          extra={extra}
          filters={RIFTBOUND_SOURCES}
          labels={RIFTBOUND_SOURCE_LABELS}
        />
        <WindowToggle basePath="/riftbound/tournaments" windowDays={windowDays} source={source} extra={extra} />
      </div>
      <RecentTournaments events={cards} intro={false} />
    </div>
  );
}
