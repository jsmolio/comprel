import Link from "next/link";
import type { ArchetypeRow } from "@/lib/queries";
import { colorNameToId } from "@/lib/archetype/colors";
import { conversionRate, formatArchetype, pageQuery, pct, winrateColor } from "@/lib/ui";
import { ColorPips } from "./ColorPips";
import { TrendBadge } from "./TrendBadge";

const RELIABLE_SAMPLE = 20;
// Archetypes below this share (and any "* Unknown" bucket) fold into "Other".
const OTHER_THRESHOLD = 0.005;

function isTail(r: ArchetypeRow): boolean {
  return r.metaShare < OTHER_THRESHOLD || r.archetype.endsWith("Unknown");
}

/** Conversion rate cell — a % when the eligible sample is large enough, else "—". */
function ConvCell({ top, elig }: { top?: number; elig?: number }) {
  const rate = conversionRate(top, elig);
  if (rate === null) return <span className="text-neutral-700">—</span>;
  return (
    <span className="tabular-nums text-neutral-300" title={`${top ?? 0} of ${elig} entries in qualifying events`}>
      {pct(rate, 0)}
    </span>
  );
}

export function MetaShareTable({
  rows,
  formatSlug,
  windowDays,
  source,
}: {
  rows: ArchetypeRow[];
  formatSlug: string;
  windowDays: number;
  source: string;
}) {
  const kept = rows.filter((r) => !isTail(r));
  const tail = rows.filter(isTail);
  const tailDecks = tail.reduce((n, r) => n + r.deckCount, 0);
  const tailShare = tail.reduce((n, r) => n + r.metaShare, 0);
  const maxShare = Math.max(0.0001, ...kept.map((r) => r.metaShare), tailShare);

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-2 pr-2 font-medium">#</th>
          <th className="py-2 pr-2 font-medium">Deck</th>
          <th className="py-2 pr-2 font-medium">Meta share</th>
          <th className="py-2 pr-2 text-right font-medium">Decks</th>
          <th className="py-2 pr-2 text-right font-medium" title="Share of entries finishing Top 8, among events with standings and ≥16 players">
            Top 8
          </th>
          <th className="py-2 pr-2 text-right font-medium" title="Share of entries finishing Top 32, among events with ≥64 players">
            Top 32
          </th>
          <th className="py-2 pl-2 text-right font-medium">Win rate</th>
        </tr>
      </thead>
      <tbody>
        {kept.map((r, i) => (
          <tr key={r.archetype} className="border-b border-neutral-900 hover:bg-neutral-900/60">
            <td className="py-2 pr-2 tabular-nums text-neutral-500">{i + 1}</td>
            <td className="py-2 pr-2">
              <Link
                href={`/${formatSlug}/${r.slug}${pageQuery(windowDays, source)}`}
                className="inline-flex items-center gap-2 font-medium text-neutral-100 hover:text-emerald-400"
              >
                <span>{formatArchetype(r.archetype)}</span>
                <ColorPips colorId={colorNameToId(r.colorName)} />
              </Link>
            </td>
            <td className="py-2 pr-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${(r.metaShare / maxShare) * 100}%` }} />
                </div>
                <span className="w-12 tabular-nums text-neutral-300">
                  {r.metaShare > 0 && r.metaShare < 0.001 ? "<0.1%" : pct(r.metaShare, 1)}
                </span>
                <TrendBadge current={r.metaShare} prev={r.prevShare} className="text-xs" />
              </div>
            </td>
            <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{r.deckCount}</td>
            <td className="py-2 pr-2 text-right">
              <ConvCell top={r.conversion?.top8} elig={r.conversion?.elig8} />
            </td>
            <td className="py-2 pr-2 text-right">
              <ConvCell top={r.conversion?.top32} elig={r.conversion?.elig32} />
            </td>
            <td className="py-2 pl-2 text-right">
              {r.sampleMatches > 0 ? (
                <span
                  className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white"
                  style={{ background: winrateColor(r.winRate, r.sampleMatches >= RELIABLE_SAMPLE ? 0.9 : 0.4) }}
                  title={`${pct(r.winRate, 1)} across ${r.sampleMatches} matches${r.sampleMatches < RELIABLE_SAMPLE ? " (small sample)" : ""}`}
                >
                  {pct(r.winRate, 1)}
                </span>
              ) : (
                <span className="text-neutral-600">—</span>
              )}
            </td>
          </tr>
        ))}
        {tail.length > 0 && (
          <tr className="border-t border-neutral-800 text-neutral-500">
            <td className="py-2 pr-2 tabular-nums">{kept.length + 1}</td>
            <td className="py-2 pr-2">
              Other <span className="text-xs">({tail.length} archetypes)</span>
            </td>
            <td className="py-2 pr-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full bg-neutral-600" style={{ width: `${(tailShare / maxShare) * 100}%` }} />
                </div>
                <span className="tabular-nums">{pct(tailShare, 1)}</span>
              </div>
            </td>
            <td className="py-2 pr-2 text-right tabular-nums">{tailDecks}</td>
            <td className="py-2 pr-2 text-right text-neutral-600">—</td>
            <td className="py-2 pr-2 text-right text-neutral-600">—</td>
            <td className="py-2 pl-2 text-right text-neutral-600">—</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
