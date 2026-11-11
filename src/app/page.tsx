import Link from "next/link";

export default function ChooseGame() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Pick a <span className="text-emerald-400">game</span>.
        </h1>
        <p className="max-w-2xl text-neutral-400">
          compREL tracks competitive constructed metagames from tournament pairings: share, decklists, and head-to-head win
          rates with a 95% confidence interval.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <GameCard
          href="/magic"
          eyebrow="Wizards of the Coast"
          title="Magic: the Gathering"
          body="Standard, Pioneer, Modern, Legacy, Vintage, and Pauper. Paper and MTGO, classified into archetypes."
        />
        <GameCard
          href="/riftbound"
          eyebrow="Riot Games"
          title="Riftbound"
          body="One constructed pool, filtered by set era. Legends stand in for archetypes. Domains stand in for colors."
        />
      </section>
    </div>
  );
}

function GameCard({ href, eyebrow, title, body }: { href: string; eyebrow: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 transition-colors hover:border-emerald-700/60 hover:bg-neutral-900"
    >
      <p className="text-xs uppercase tracking-wide text-neutral-500">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-neutral-100 group-hover:text-emerald-400">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-400">{body}</p>
    </Link>
  );
}
