import Link from "next/link";
import { getFormatSummaries } from "@/lib/queries";
import { ColorPips } from "@/components/ColorPips";
import { colorNameToId } from "@/lib/archetype/colors";
import { fmtDate, pct } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summaries = await getFormatSummaries();

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Everything competitive <span className="text-emerald-400">Magic</span>, in one place.
        </h1>
        <p className="max-w-2xl text-neutral-400">
          Live metagame share, tournament decklists, and head-to-head matchup win rates computed from real pairing data
          across every competitive format.
        </p>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <Note title="Aggregate win rate">
            A deck&apos;s overall match win&nbsp;% across all events — high volume, from MTGO and paper alike.
          </Note>
          <Note title="Head-to-head matchups">
            Deck-vs-deck win&nbsp;% from round-by-round pairings, shown with sample size and a 95% confidence interval.
          </Note>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => (
          <Link
            key={s.format}
            href={`/${s.format.toLowerCase()}`}
            className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-emerald-700/60 hover:bg-neutral-900"
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-neutral-100 group-hover:text-emerald-400">{s.format}</h2>
              <span className="text-xs text-neutral-500">{s.decks > 0 ? `${s.decks} decks` : "no data"}</span>
            </div>
            {s.top.length > 0 ? (
              <ul className="space-y-1.5">
                {s.top.map((t) => (
                  <li key={t.archetype} className="flex items-center gap-2 text-sm">
                    <ColorPips colorId={colorNameToId(t.colorName)} size={11} />
                    <span className="flex-1 truncate text-neutral-300">{t.archetype}</span>
                    <span className="tabular-nums text-neutral-500">{pct(t.metaShare, 1)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-600">Run ingest to populate this format.</p>
            )}
            <p className="mt-3 text-xs text-neutral-600">updated {fmtDate(s.latest)}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-sm font-semibold text-neutral-200">{title}</div>
      <p className="mt-1 text-xs leading-5 text-neutral-400">{children}</p>
    </div>
  );
}
