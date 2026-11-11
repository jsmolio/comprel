import Link from "next/link";
import { notFound } from "next/navigation";
import { CollapsibleDecks } from "@/components/CollapsibleDecks";
import { DeckList, type CardMap, type DeckSectionView } from "@/components/DeckList";
import { DomainPips } from "@/components/DomainPips";
import { EraToggle } from "@/components/EraToggle";
import { MatchupTable } from "@/components/MatchupTable";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { ShareChart } from "@/components/ShareChart";
import { SignatureCards } from "@/components/SignatureCards";
import { SourceToggle } from "@/components/SourceToggle";
import { TrendBadge } from "@/components/TrendBadge";
import { VideoSection } from "@/components/VideoSection";
import { WindowToggle } from "@/components/WindowToggle";
import { loadPublished } from "@/lib/published/load";
import { ALL_ERA } from "@/lib/riftbound/eras";
import { RIFTBOUND_SNAPSHOT_LABEL, RIFTBOUND_SNAPSHOT_PATH } from "@/lib/riftbound/paths";
import {
  cellOf,
  findLegend,
  legendLists,
  legendTimeline,
  normalizeEra,
  normalizeRiftboundSource,
  normalizeRiftboundWindow,
  riftboundBanMarkers,
  riftboundRows,
} from "@/lib/riftbound/read";
import { isRuneCard, RIFTBOUND_CATEGORY_ORDER, riftboundCategory } from "@/lib/riftbound/domains";
import { RIFTBOUND_SOURCE_LABELS, RIFTBOUND_SOURCES } from "@/lib/riftbound/sources";
import type { RiftboundList, RiftboundSnapshot } from "@/lib/riftbound/types";
import { slugify } from "@/lib/slug";
import { conversionRate, fmtDate, formatArchetype, pageQuery, pct, winrateColor } from "@/lib/ui";

export default async function LegendPage({
  params,
  searchParams,
}: {
  params: Promise<{ legend: string }>;
  searchParams: Promise<{ window?: string; source?: string; era?: string }>;
}) {
  const loaded = loadPublished<RiftboundSnapshot>(RIFTBOUND_SNAPSHOT_PATH, RIFTBOUND_SNAPSHOT_LABEL);
  if (!loaded.ok) {
    return (
      <MissingSnapshot
        reason={loaded.reason}
        note="Build the first Riftbound snapshot with pnpm backfill --game=riftbound --days=90."
      />
    );
  }
  const { legend: legendSlug } = await params;
  const snapshot = loaded.snapshot;
  const legend = findLegend(snapshot, legendSlug);
  if (!legend) notFound();

  const sp = await searchParams;
  const windowDays = normalizeRiftboundWindow(sp.window);
  const source = normalizeRiftboundSource(sp.source);
  const era = normalizeEra(sp.era, snapshot.eras);
  const extra = era === ALL_ERA ? undefined : { era };
  const stat = riftboundRows(snapshot, windowDays, source, era).find((row) => row.archetype === legend) ?? null;
  const lists = legendLists(snapshot, legend, source, era);
  const names = new Set<string>();
  for (const list of lists) {
    for (const zone of [list.legend, list.champion, list.battlefield, list.main, list.runePool, list.sideboard]) {
      for (const card of zone) names.add(card.name);
    }
  }
  const cards = cardMap(snapshot, [...names]);
  const signature = pickLegendSignatures(lists, cards);
  const top8 = conversionRate(stat?.conversion?.top8, stat?.conversion?.elig8);
  const top32 = conversionRate(stat?.conversion?.top32, stat?.conversion?.elig32);
  const matchups = (snapshot.slices[`${windowDays}:${source}:${era}`]?.matchups ?? [])
    .filter((matchup) => matchup.archetypeA === legend)
    .map((matchup) => ({ opponent: matchup.archetypeB, slug: slugify(matchup.archetypeB), ...cellOf(matchup) }))
    .sort((a, b) => b.matches - a.matches || a.opponent.localeCompare(b.opponent));

  const deckArticles = lists.map((list) => (
    <article key={`${list.tournamentDate}:${list.playerId}`} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-neutral-100">{list.player}</span>
          {list.rank != null && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-medium text-neutral-300">#{list.rank}</span>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          {list.tournamentUri ? (
            <a href={list.tournamentUri} target="_blank" rel="noreferrer" className="hover:text-neutral-300">
              {list.tournamentName}
            </a>
          ) : (
            list.tournamentName
          )}{" "}
          · {fmtDate(list.tournamentDate)} · {list.source}
          {list.anchorUri && (
            <>
              {" · "}
              <a href={list.anchorUri} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-400">
                full list ↗
              </a>
            </>
          )}
        </div>
      </header>
      <DeckList
        mainboard={[]}
        sideboard={[]}
        cardMap={cards}
        sections={sectionsOf(list)}
        categoryOf={riftboundCategory}
        categoryOrder={RIFTBOUND_CATEGORY_ORDER}
        cardHref={(name) => {
          const slug = snapshot.cards[name]?.slug;
          return slug ? `https://openrift.app/cards/${slug}` : null;
        }}
      />
    </article>
  ));

  return (
    <div className="space-y-8">
      <EraToggle basePath={`/riftbound/${legendSlug}`} windowDays={windowDays} source={source} era={era} eras={snapshot.eras} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-neutral-500">
            <Link href={`/riftbound${pageQuery(windowDays, source, extra)}`} className="hover:text-neutral-300">
              Riftbound
            </Link>{" "}
            / {formatArchetype(legend)}
          </nav>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {formatArchetype(legend)}
            <DomainPips colorName={stat?.colorName} size={16} />
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceToggle
            basePath={`/riftbound/${legendSlug}`}
            windowDays={windowDays}
            source={source}
            extra={extra}
            filters={RIFTBOUND_SOURCES}
            labels={RIFTBOUND_SOURCE_LABELS}
          />
          <WindowToggle basePath={`/riftbound/${legendSlug}`} windowDays={windowDays} source={source} extra={extra} />
        </div>
      </div>

      {signature.length > 0 && (
        <section aria-label="Signature cards">
          <SignatureCards cards={signature} />
        </section>
      )}

      {stat && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Meta share" value={pct(stat.metaShare, 1)} extra={<TrendBadge current={stat.metaShare} prev={stat.prevShare} className="text-sm" />} hint={stat.prevShare !== undefined ? "vs previous window" : undefined} />
          <Stat label="Decks (window)" value={String(stat.deckCount)} />
          <Stat label="Top 8 conversion" value={top8 !== null ? pct(top8, 1) : "—"} hint={stat.conversion?.elig8 ? `${stat.conversion.top8}/${stat.conversion.elig8} in cut events` : "small sample"} />
          <Stat label="Top 32 conversion" value={top32 !== null ? pct(top32, 1) : "—"} hint={stat.conversion?.elig32 ? `${stat.conversion.top32}/${stat.conversion.elig32} in 64+ events` : "small sample"} />
          <Stat label="Aggregate win rate" value={stat.sampleMatches > 0 ? pct(stat.winRate, 1) : "—"} color={stat.sampleMatches > 0 ? winrateColor(stat.winRate, 0.9) : undefined} hint={stat.sampleMatches > 0 ? `${stat.sampleMatches} matches` : "Chinese events excluded"} />
          <Stat label="H2H matchups" value={String(matchups.length)} hint="mirrors excluded" />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Meta share over time</h2>
          <p className="text-sm text-neutral-500">
            Weekly share. Amber lines mark constructed ban dates. There is no rules-based archetype below the legend.
          </p>
        </div>
        <ShareChart points={legendTimeline(snapshot, legend, source, era)} format="Riftbound" bans={riftboundBanMarkers(snapshot)} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Matchups</h2>
          <p className="text-sm text-neutral-500">
            Head-to-head win rate against other legends. Mirror matches are excluded. Chinese events are excluded because
            they publish no match results. Wide intervals mean small samples.
          </p>
        </div>
        <MatchupTable rows={matchups} formatSlug="riftbound" windowDays={windowDays} source={source} extra={extra} linkRoot="/riftbound" />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Representative decklists</h2>
          <p className="text-sm text-neutral-500">
            Recent lists for this legend. Runes are grouped like basic lands. Hover a card for the OpenRift image. Prices
            are approximate TCGplayer USD. PlayRiftbound events do not publish lists.
          </p>
        </div>
        {lists.length === 0 ? (
          <p className="text-sm text-neutral-500">No decklists stored for this legend in this era and source.</p>
        ) : (
          <CollapsibleDecks first={deckArticles[0]} rest={deckArticles.slice(1)} restCount={deckArticles.length - 1} />
        )}
      </section>

      <VideoSection
        format="Riftbound"
        archetype={legend}
        initialVideos={snapshot.videos
          .filter((video) => video.format === "Riftbound" && video.archetype === legend)
          .map((video) => ({
            id: video.id,
            title: video.title,
            channelTitle: video.channelTitle,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
          }))}
        stale={snapshot.videosState === "degraded"}
        searchQuery={`Riftbound ${legend} gameplay`}
      />
      {snapshot.videosState === "no-key" && (
        <p className="text-xs text-neutral-500">Gameplay search stays empty until YOUTUBE_API_KEY is configured for the publisher.</p>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sideboard guides</h2>
        <p className="text-sm text-neutral-500">
          Curated sideboard guides are a placeholder, the same as on the Magic pages.
        </p>
      </section>
    </div>
  );
}

function sectionsOf(list: RiftboundList): DeckSectionView[] {
  return [
    { key: "legend", label: "Legend", cards: list.legend },
    { key: "champion", label: "Champion", cards: list.champion },
    { key: "battlefield", label: "Battlefields", cards: list.battlefield },
    { key: "main", label: "Main deck", cards: list.main, categorize: true },
    { key: "runes", label: "Rune deck", cards: list.runePool },
    { key: "sideboard", label: "Sideboard", cards: list.sideboard },
  ];
}

function cardMap(snapshot: RiftboundSnapshot, names: string[]): CardMap {
  const map: CardMap = new Map();
  for (const name of names) {
    const card = snapshot.cards[name];
    if (!card) continue;
    map.set(name, { imageUrl: card.imageUrl, typeLine: card.typeLine, manaCost: null, priceUsd: card.priceUsd });
  }
  return map;
}

function pickLegendSignatures(lists: RiftboundList[], cards: CardMap): { name: string; imageUrl: string }[] {
  const tally = new Map<string, { name: string; decks: number; copies: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const card of list.main) {
      if (isRuneCard(card.name, cards.get(card.name)?.typeLine)) continue;
      const row = tally.get(card.name) ?? { name: card.name, decks: 0, copies: 0 };
      if (!seen.has(card.name)) {
        row.decks += 1;
        seen.add(card.name);
      }
      row.copies += card.count;
      tally.set(card.name, row);
    }
  }
  return [...tally.values()]
    .map((row) => ({ ...row, imageUrl: cards.get(row.name)?.imageUrl ?? null }))
    .filter((row): row is typeof row & { imageUrl: string } => Boolean(row.imageUrl))
    .sort((a, b) => b.decks - a.decks || b.copies - a.copies || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((row) => ({ name: row.name, imageUrl: row.imageUrl }));
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
