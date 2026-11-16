import Link from "next/link";
import { formatArchetype } from "@/lib/ui";
import type { PresentedTournament } from "@/lib/tournaments/present";

export function RecentTournaments({
  events,
  moreHref,
  moreLabel,
  intro = true,
}: {
  events: PresentedTournament[];
  moreHref?: string | null;
  moreLabel?: string | null;
  /** Set false when the page already has its own title. */
  intro?: boolean;
}) {
  return (
    <div className="space-y-3">
      {intro && (
        <div>
          <h2 id="recent-tournaments" className="text-lg font-semibold">
            Recent tournaments
          </h2>
          <p className="text-sm text-neutral-500">
            Newest events in this window, with their top finishes. Open a decklist to see the cards.
          </p>
        </div>
      )}
      {events.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-400">
          No tournaments in this window and source.
        </p>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <article key={event.href} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-neutral-100">
                  <Link href={event.href} className="hover:text-emerald-400">
                    {event.name}
                  </Link>
                </h3>
                <p className="text-xs text-neutral-500">
                  {event.dateLabel} · {event.source}
                  {event.sizeLabel ? ` · ${event.sizeLabel}` : ""} · {event.formatLabel}
                  {event.externalHref && (
                    <>
                      {" · "}
                      <a href={event.externalHref} target="_blank" rel="noreferrer" className="hover:text-neutral-300">
                        Source
                      </a>
                    </>
                  )}
                </p>
              </header>
              {event.finishes.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No finishes recorded.</p>
              ) : (
                <ul className="mt-3 divide-y divide-neutral-900">
                  {event.finishes.map((finish) => {
                    const lead = finish.place ?? finish.record ?? "—";
                    const extra = finish.place && finish.record ? finish.record : null;
                    return (
                      <li key={finish.anchor} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-sm">
                        <span className="w-12 shrink-0 tabular-nums text-neutral-500">{lead}</span>
                        <span className="font-medium text-neutral-100">{finish.player}</span>
                        <Link href={finish.archetypeHref ?? event.href} className="text-neutral-300 hover:text-emerald-400">
                          {formatArchetype(finish.archetype)}
                        </Link>
                        {extra && <span className="tabular-nums text-neutral-500">{extra}</span>}
                        {finish.listHref && (
                          <Link href={finish.listHref} className="text-xs text-emerald-500 hover:text-emerald-400 sm:ml-auto">
                            Decklist
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
          {moreHref && moreLabel && (
            <Link href={moreHref} className="inline-flex text-sm font-medium text-emerald-500 hover:text-emerald-400">
              {moreLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
