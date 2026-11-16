import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckList, type CardMap } from "@/components/DeckList";
import { MissingSnapshot } from "@/components/MissingSnapshot";
import { TournamentEventView } from "@/components/TournamentEventView";
import { fullListHref, isGenericMtgoIndex } from "@/lib/deck-link";
import { loadMagicCards, loadMagicIndex } from "@/lib/published/magic";
import { loadMagicTournamentEvent } from "@/lib/published/tournaments";
import { cardMap, normalizeSource, normalizeWindow } from "@/lib/queries";
import { resolveFormat, slugify } from "@/lib/slug";
import { tournamentSizeLabel } from "@/lib/tournaments/select";
import type { MagicFinish } from "@/lib/tournaments/types";
import { fmtDate, formatArchetype, pageQuery } from "@/lib/ui";
import type { BoardCard } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ format: string; event: string }>;
}): Promise<Metadata> {
  const { format: formatSlug, event: eventSlug } = await params;
  const format = resolveFormat(formatSlug);
  if (!format) return { title: "Tournament — compREL" };
  const event = loadMagicTournamentEvent(format, eventSlug);
  if (!event) return { title: `${format} tournament — compREL` };
  return { title: `${event.name} — ${format} — compREL` };
}

export default async function MagicTournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ format: string; event: string }>;
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const { format: formatSlug, event: eventSlug } = await params;
  const index = loadMagicIndex();
  if (!index.ok) return <MissingSnapshot reason={index.reason} />;
  const format = resolveFormat(formatSlug);
  if (!format) notFound();
  const event = loadMagicTournamentEvent(format, eventSlug);
  if (!event) notFound();

  const sp = await searchParams;
  const windowDays = normalizeWindow(sp.window);
  const source = normalizeSource(sp.source);
  const slug = format.toLowerCase();
  const query = pageQuery(windowDays, source);
  const cardsLoaded = loadMagicCards();
  if (!cardsLoaded.ok) return <MissingSnapshot reason={cardsLoaded.reason} />;
  const names = new Set<string>();
  for (const finish of event.finishes) {
    for (const card of finish.mainboard ?? []) names.add(card.name);
    for (const card of finish.sideboard ?? []) names.add(card.name);
  }
  const cards = cardMap(cardsLoaded.snapshot, [...names]) as unknown as CardMap;
  const size = tournamentSizeLabel(event);
  const externalHref = event.uri && !isGenericMtgoIndex(event.uri) ? event.uri : null;

  return (
    <TournamentEventView
      crumbs={[
        { href: `/magic/${slug}${query}`, label: format },
        { href: `/magic/${slug}/tournaments${query}`, label: "Tournaments" },
      ]}
      title={event.name}
      meta={[fmtDate(event.date), event.source, size, format].filter(Boolean).join(" · ")}
      externalHref={externalHref}
      finishes={event.finishes.map((finish, index) => ({
        anchor: `deck-${index + 1}`,
        place: finish.rank != null ? `#${finish.rank}` : null,
        record: finish.record,
        player: finish.player,
        archetype: finish.archetype,
        archetypeHref: `/magic/${slug}/${slugify(finish.archetype)}${query}`,
        list: magicList(finish, cards, format, event.name, fmtDate(event.date), event.uri),
      }))}
    />
  );
}

function magicList(
  finish: MagicFinish,
  cards: CardMap,
  format: string,
  eventName: string,
  date: string,
  tournamentUri: string | null,
) {
  const mainboard = finish.mainboard ?? [];
  const sideboard = finish.sideboard ?? [];
  if (mainboard.length + sideboard.length === 0) return null;
  const listHref = fullListHref({ anchorUri: finish.anchorUri ?? null, tournamentUri, player: finish.player });
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
        mainboard={mainboard as BoardCard[]}
        sideboard={sideboard as BoardCard[]}
        cardMap={cards}
        exportMeta={{
          format,
          archetype: formatArchetype(finish.archetype),
          player: finish.player,
          event: eventName,
          date: date === "—" ? null : date,
        }}
      />
    </div>
  );
}
