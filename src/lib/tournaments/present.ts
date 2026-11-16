import { isGenericMtgoIndex } from "../deck-link";
import { fmtDate } from "../ui";
import { tournamentSizeLabel } from "./select";
import type { TournamentEvent } from "./types";

export interface PresentedFinish {
  place: string | null;
  player: string;
  archetype: string;
  archetypeHref: string | null;
  record: string | null;
  listHref: string | null;
  anchor: string;
}

export interface PresentedTournament {
  href: string;
  name: string;
  dateLabel: string;
  source: string;
  formatLabel: string;
  sizeLabel: string | null;
  externalHref: string | null;
  finishes: PresentedFinish[];
}

export function presentTournaments(
  events: readonly TournamentEvent[],
  opts: {
    eventHref: (event: TournamentEvent) => string;
    archetypeHref: (archetype: string) => string;
    formatLabel: string;
  },
): PresentedTournament[] {
  return events.map((event) => {
    const href = opts.eventHref(event);
    return {
      href,
      name: event.name,
      dateLabel: fmtDate(event.date),
      source: event.source,
      formatLabel: opts.formatLabel,
      sizeLabel: tournamentSizeLabel(event),
      externalHref: event.uri && !isGenericMtgoIndex(event.uri) ? event.uri : null,
      finishes: event.finishes.map((finish, index) => {
        const anchor = `deck-${index + 1}`;
        return {
          place: finish.rank != null ? `#${finish.rank}` : null,
          player: finish.player,
          archetype: finish.archetype,
          archetypeHref: opts.archetypeHref(finish.archetype),
          record: finish.record,
          listHref: finish.hasList ? `${href}#${anchor}` : null,
          anchor,
        };
      }),
    };
  });
}
