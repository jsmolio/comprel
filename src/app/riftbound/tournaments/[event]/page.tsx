import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckList, type CardMap, type DeckSectionView } from "@/components/DeckList";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { TournamentEventView } from "@/components/TournamentEventView";
import { fullListHref, isGenericMtgoIndex } from "@/lib/deck-link";
import { loadRiftboundCards, loadRiftboundIndex } from "@/lib/published/riftbound";
import { loadRiftboundTournamentEvent } from "@/lib/published/tournaments";
import { RIFTBOUND_CATEGORY_ORDER, riftboundCategory } from "@/lib/riftbound/domains";
import { ALL_ERA } from "@/lib/riftbound/eras";
import { normalizeEra, normalizeRiftboundSource, normalizeRiftboundWindow } from "@/lib/riftbound/read";
import { slugify } from "@/lib/slug";
import { tournamentSizeLabel } from "@/lib/tournaments/select";
import type { RiftboundFinish } from "@/lib/tournaments/types";
import { fmtDate, pageQuery } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ event: string }>;
}): Promise<Metadata> {
  const { event: eventSlug } = await params;
  const event = loadRiftboundTournamentEvent(eventSlug);
  if (!event) return { title: "Riftbound tournament — compREL" };
  return { title: `${event.name} — Riftbound — compREL` };
}

export default async function RiftboundTournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ event: string }>;
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
  const { event: eventSlug } = await params;
  const event = loadRiftboundTournamentEvent(eventSlug);
  if (!event) notFound();
  const sp = await searchParams;
  const windowDays = normalizeRiftboundWindow(sp.window);
  const source = normalizeRiftboundSource(sp.source);
  const era = normalizeEra(sp.era, index.snapshot.eras);
  const extra = era === ALL_ERA ? undefined : { era };
  const query = pageQuery(windowDays, source, extra);
  const cardsLoaded = loadRiftboundCards();
  if (!cardsLoaded.ok) return <MissingSnapshot reason={cardsLoaded.reason} />;
  const names = new Set<string>();
  for (const finish of event.finishes) {
    for (const zone of [finish.legend, finish.champion, finish.battlefield, finish.main, finish.runePool, finish.sideboard]) {
      for (const card of zone ?? []) names.add(card.name);
    }
  }
  const cards: CardMap = new Map();
  for (const name of names) {
    const card = cardsLoaded.snapshot.cards[name];
    if (!card) continue;
    cards.set(name, { imageUrl: card.imageUrl, typeLine: card.typeLine, manaCost: null, priceUsd: card.priceUsd });
  }
  const externalHref = event.uri && !isGenericMtgoIndex(event.uri) ? event.uri : null;

  return (
    <TournamentEventView
      crumbs={[
        { href: `/riftbound${query}`, label: "Riftbound" },
        { href: `/riftbound/tournaments${query}`, label: "Tournaments" },
      ]}
      title={event.name}
      meta={[fmtDate(event.date), event.source, tournamentSizeLabel(event), "Constructed"].filter(Boolean).join(" · ")}
      externalHref={externalHref}
      finishes={event.finishes.map((finish, index) => ({
        anchor: `deck-${index + 1}`,
        place: finish.rank != null ? `#${finish.rank}` : null,
        record: finish.record,
        player: finish.player,
        archetype: finish.archetype,
        archetypeHref: `/riftbound/${slugify(finish.archetype)}${query}`,
        list: riftboundList(finish, cards, cardsLoaded.snapshot.cards),
      }))}
    />
  );
}

function sectionsOf(finish: RiftboundFinish): DeckSectionView[] {
  return [
    { key: "legend", label: "Legend", cards: finish.legend ?? [] },
    { key: "champion", label: "Champion", cards: finish.champion ?? [] },
    { key: "battlefield", label: "Battlefields", cards: finish.battlefield ?? [] },
    { key: "main", label: "Main deck", cards: finish.main ?? [], categorize: true },
    { key: "runes", label: "Rune deck", cards: finish.runePool ?? [] },
    { key: "sideboard", label: "Sideboard", cards: finish.sideboard ?? [] },
  ].filter((section) => section.cards.length > 0);
}

function riftboundList(
  finish: RiftboundFinish,
  cards: CardMap,
  catalog: { [name: string]: { slug: string | null } | undefined },
) {
  const sections = sectionsOf(finish);
  if (sections.length === 0) return null;
  const listHref = fullListHref({
    anchorUri: finish.anchorUri ?? null,
    tournamentUri: null,
    player: finish.player,
  });
  return (
    <div className="space-y-3">
      {listHref && (
        <p className="text-xs text-neutral-500">
          <Link href={listHref} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-400">
            View full list
          </Link>
        </p>
      )}
      <DeckList
        mainboard={[] as BoardCard[]}
        sideboard={[] as BoardCard[]}
        cardMap={cards}
        sections={sections}
        categoryOf={riftboundCategory}
        categoryOrder={RIFTBOUND_CATEGORY_ORDER}
        cardHref={(name) => {
          const slug = catalog[name]?.slug;
          return slug ? `https://openrift.app/cards/${slug}` : null;
        }}
      />
    </div>
  );
}
