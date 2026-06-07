import Link from "next/link";
import { notFound } from "next/navigation";
import { getArchetypeDetail, getArchetypeVideos, getBanMarkers, getCardMap, normalizeSource, normalizeWindow } from "@/lib/queries";
import { resolveFormat } from "@/lib/slug";
import { colorNameToId } from "@/lib/archetype/colors";
import { FormatTabs } from "@/components/FormatTabs";
import { WindowToggle } from "@/components/WindowToggle";
import { SourceToggle } from "@/components/SourceToggle";
import { MatchupTable } from "@/components/MatchupTable";
import { DeckList, type CardMap } from "@/components/DeckList";
import { VideoSection } from "@/components/VideoSection";
import { youtubeEnabled } from "@/lib/sources/youtube";
import { ColorPips } from "@/components/ColorPips";
import { TrendBadge } from "@/components/TrendBadge";
import { ShareChart } from "@/components/ShareChart";
import { conversionRate, fmtDate, formatArchetype, pageQuery, pct, winrateColor } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ArchetypePage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string; archetype: string }>;
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const { format: formatSlug, archetype: archetypeSlug } = await params;
  const format = resolveFormat(formatSlug);
  if (!format) notFound();

  const sp = await searchParams;
  const windowDays = normalizeWindow(sp.window);
  const source = normalizeSource(sp.source);
  const slug = format.toLowerCase();

  const detail = await getArchetypeDetail(format, windowDays, source, archetypeSlug);
  if (!detail) notFound();

  const names = new Set<string>();
  for (const d of detail.decks) {
    for (const c of d.mainboard) names.add(c.name);
    for (const c of d.sideboard) names.add(c.name);
  }
  const [cardMap, videos, banMarkers] = await Promise.all([
    getCardMap([...names]),
    getArchetypeVideos(format, detail.archetype),
    getBanMarkers(format),
  ]);
  const cards = cardMap as unknown as CardMap;

  const stat = detail.stat;
  const top8 = conversionRate(stat?.conversion?.top8, stat?.conversion?.elig8);
  const top32 = conversionRate(stat?.conversion?.top32, stat?.conversion?.elig32);

  return (
    <div className="space-y-8">
      <FormatTabs active={slug} windowDays={windowDays} source={source} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-neutral-500">
            <Link href={`/${slug}${pageQuery(windowDays, source)}`} className="hover:text-neutral-300">
              {format}
            </Link>{" "}
            / {formatArchetype(detail.archetype)}
          </nav>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {formatArchetype(detail.archetype)}
            <ColorPips colorId={colorNameToId(detail.colorName)} size={16} />
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle basePath={`/${slug}/${archetypeSlug}`} windowDays={windowDays} source={source} />
          <WindowToggle basePath={`/${slug}/${archetypeSlug}`} windowDays={windowDays} source={source} />
        </div>
      </div>

      {stat && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Meta share"
            value={pct(stat.metaShare, 1)}
            extra={<TrendBadge current={stat.metaShare} prev={stat.prevShare} className="text-sm" />}
            hint={stat.prevShare !== undefined ? "vs previous window" : undefined}
          />
          <Stat label="Decks (window)" value={String(stat.deckCount)} />
          <Stat
            label="Top 8 conversion"
            value={top8 !== null ? pct(top8, 1) : "—"}
            hint={stat.conversion?.elig8 ? `${stat.conversion.top8}/${stat.conversion.elig8} in cut events` : "small sample"}
          />
          <Stat
            label="Top 32 conversion"
            value={top32 !== null ? pct(top32, 1) : "—"}
            hint={stat.conversion?.elig32 ? `${stat.conversion.top32}/${stat.conversion.elig32} in 64+ events` : "small sample"}
          />
          <Stat
            label="Aggregate win rate"
            value={stat.sampleMatches > 0 ? pct(stat.winRate, 1) : "—"}
            color={stat.sampleMatches > 0 ? winrateColor(stat.winRate, 0.9) : undefined}
            hint={stat.sampleMatches > 0 ? `${stat.sampleMatches} matches` : undefined}
          />
          <Stat label="H2H matchups" value={String(detail.matchups.length)} hint="vs other archetypes" />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Meta share over time</h2>
          <p className="text-sm text-neutral-500">
            Weekly share over the last 12 months — toggle between share of the whole field and share among just the top-10
            decks. Amber lines mark B&amp;R announcements affecting {format}.
          </p>
        </div>
        <ShareChart points={detail.timeline} format={format} bans={banMarkers} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Matchups</h2>
          <p className="text-sm text-neutral-500">
            Head-to-head win rate vs the rest of the {format} field, from pairing data. Wide intervals mean small samples.
          </p>
        </div>
        <MatchupTable rows={detail.matchups} formatSlug={slug} windowDays={windowDays} source={source} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Representative decklists</h2>
          <p className="text-sm text-neutral-500">Recent strong finishes for this archetype. Hover any card for a preview.</p>
        </div>
        {detail.decks.length === 0 ? (
          <p className="text-sm text-neutral-500">No decklists found in the cache for this archetype.</p>
        ) : (
          <div className="space-y-4">
            {detail.decks.map((d) => (
              <article key={d.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-neutral-100">{d.player}</span>
                    <Finish rank={d.rank} result={d.result} />
                  </div>
                  <div className="text-xs text-neutral-500">
                    {d.tournamentUri ? (
                      <a href={d.tournamentUri} target="_blank" rel="noreferrer" className="hover:text-neutral-300">
                        {d.tournamentName}
                      </a>
                    ) : (
                      d.tournamentName
                    )}{" "}
                    · {fmtDate(d.tournamentDate)} · {d.source}
                    {d.anchorUri && (
                      <>
                        {" · "}
                        <a href={d.anchorUri} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-400">
                          full list ↗
                        </a>
                      </>
                    )}
                  </div>
                </header>
                <DeckList mainboard={d.mainboard as BoardCard[]} sideboard={d.sideboard as BoardCard[]} cardMap={cards} />
              </article>
            ))}
          </div>
        )}
      </section>

      <VideoSection format={format} archetype={detail.archetype} initialVideos={videos} enabled={youtubeEnabled()} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sideboard guides</h2>
        <p className="text-sm text-neutral-500">
          Curated sideboard guides from content creators will appear here, linked from the videos above and creator posts.
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  color,
  extra,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>
          {value}
        </span>
        {extra}
      </div>
      {hint && <div className="text-xs text-neutral-600">{hint}</div>}
    </div>
  );
}

function Finish({ rank, result }: { rank: number | null; result: string | null }) {
  const label = rank ? `#${rank}` : result ?? "";
  if (!label) return null;
  return <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-medium text-neutral-300">{label}</span>;
}
