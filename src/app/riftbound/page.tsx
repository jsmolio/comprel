import { DomainPips } from "@/components/DomainPips";
import { EraToggle } from "@/components/EraToggle";
import { MatchupMatrix } from "@/components/MatchupMatrix";
import { MetaShareTable } from "@/components/MetaShareTable";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { RiftboundCoverageNote } from "@/components/RiftboundCoverageNote";
import { SourceToggle } from "@/components/SourceToggle";
import { WindowToggle } from "@/components/WindowToggle";
import { loadPublished } from "@/lib/published/load";
import { ALL_ERA } from "@/lib/riftbound/eras";
import {
  normalizeEra,
  normalizeRiftboundSource,
  normalizeRiftboundWindow,
  riftboundMatrix,
  riftboundRows,
  riftboundTotal,
} from "@/lib/riftbound/read";
import { RIFTBOUND_SOURCE_LABELS, RIFTBOUND_SOURCES } from "@/lib/riftbound/sources";
import { RIFTBOUND_SNAPSHOT_PATH, type RiftboundSnapshot } from "@/lib/riftbound/paths";
import { fmtDate } from "@/lib/ui";

export const metadata = {
  title: "Riftbound metagame — compREL",
  description: "Riftbound constructed metagame share, legend matchups, and tournament lists.",
};

export default async function RiftboundPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; source?: string; era?: string }>;
}) {
  const loaded = loadPublished<RiftboundSnapshot>(RIFTBOUND_SNAPSHOT_PATH, "data/published/riftbound/snapshot.json");
  if (!loaded.ok) {
    return (
      <MissingSnapshot
        reason={loaded.reason}
        note="Build the first Riftbound snapshot with pnpm backfill --game=riftbound --days=90. That command is not run by loading this page. Magic's snapshot is separate."
      />
    );
  }
  const snapshot = loaded.snapshot;
  const sp = await searchParams;
  const windowDays = normalizeRiftboundWindow(sp.window);
  const source = normalizeRiftboundSource(sp.source);
  const era = normalizeEra(sp.era, snapshot.eras);
  const extra = era === ALL_ERA ? undefined : { era };
  const rows = riftboundRows(snapshot, windowDays, source, era);
  const matrix = riftboundMatrix(snapshot, windowDays, source, era, 12);
  const identity = (row: { colorName: string | null }) => <DomainPips colorName={row.colorName} />;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Riftbound metagame</h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          Constructed share and head-to-head win rates computed from BoundRift standings and pairings. A legend is the
          archetype. Set eras replace Magic&apos;s format tabs. Chinese events count toward share and are left out of win
          rate and the matchup matrix. Mirror matches are excluded.
        </p>
        <RiftboundCoverageNote coverage={snapshot.coverage} />
        <EraToggle basePath="/riftbound" windowDays={windowDays} source={source} era={era} eras={snapshot.eras} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {riftboundTotal(snapshot, windowDays, source, era)} decks · {rows.length} legends · latest data{" "}
          {fmtDate(snapshot.latest)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle
            basePath="/riftbound"
            windowDays={windowDays}
            source={source}
            extra={extra}
            filters={RIFTBOUND_SOURCES}
            labels={RIFTBOUND_SOURCE_LABELS}
          />
          <WindowToggle basePath="/riftbound" windowDays={windowDays} source={source} extra={extra} />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-400">
          No legends in this era, window, and source yet.
        </p>
      ) : (
        <>
          <section>
            <MetaShareTable
              rows={rows}
              formatSlug="riftbound"
              windowDays={windowDays}
              source={source}
              extra={extra}
              linkRoot="/riftbound"
              nameColumn="Legend"
              tailNoun="legends"
              renderIdentity={identity}
            />
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Head-to-head matchups</h2>
              <p className="text-sm text-neutral-500">
                Win rates between the top {matrix.archetypes.length} legends, from round-by-round pairings. Mirrors are
                excluded. Chinese events have no match results, so they are not in this matrix.
              </p>
            </div>
            <MatchupMatrix
              matrix={matrix}
              formatSlug="riftbound"
              windowDays={windowDays}
              source={source}
              extra={extra}
              linkRoot="/riftbound"
              renderIdentity={identity}
            />
          </section>
        </>
      )}
    </div>
  );
}
