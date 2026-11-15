import Link from "next/link";
import type { ReactNode } from "react";
import { formatArchetype } from "@/lib/ui";

export interface TournamentFinishView {
  anchor: string;
  place: string | null;
  record: string | null;
  player: string;
  archetype: string;
  archetypeHref: string;
  list: ReactNode | null;
}

export function TournamentEventView({
  crumbs,
  title,
  meta,
  externalHref,
  finishes,
}: {
  crumbs: { href: string; label: string }[];
  title: string;
  meta: string;
  externalHref: string | null;
  finishes: TournamentFinishView[];
}) {
  return (
    <div className="space-y-8">
      <div>
        <nav className="mb-1 text-xs text-neutral-500">
          {crumbs.map((crumb, index) => (
            <span key={crumb.href}>
              {index > 0 && " / "}
              <Link href={crumb.href} className="hover:text-neutral-300">
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {meta}
          {externalHref && (
            <>
              {" · "}
              <a href={externalHref} target="_blank" rel="noreferrer" className="hover:text-neutral-300">
                Source
              </a>
            </>
          )}
        </p>
      </div>
      {finishes.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-400">No finishes recorded.</p>
      ) : (
        <div className="space-y-4">
          {finishes.map((finish) => {
            const lead = finish.place ?? finish.record;
            return (
              <article key={finish.anchor} id={finish.anchor} className="scroll-mt-20 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    {lead && (
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-medium tabular-nums text-neutral-300">
                        {lead}
                      </span>
                    )}
                    <span className="font-semibold text-neutral-100">{finish.player}</span>
                    {finish.place && finish.record && (
                      <span className="text-xs tabular-nums text-neutral-500">{finish.record}</span>
                    )}
                  </div>
                  <Link href={finish.archetypeHref} className="text-sm text-neutral-300 hover:text-emerald-400">
                    {formatArchetype(finish.archetype)}
                  </Link>
                </header>
                {finish.list}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
