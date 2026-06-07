import Link from "next/link";
import type { MatchupMatrix as Matrix } from "@/lib/queries";
import { colorNameToId } from "@/lib/archetype/colors";
import { formatArchetype, pageQuery, pct, winrateColor } from "@/lib/ui";
import { ColorPips } from "./ColorPips";

const SMALL_SAMPLE = 8; // below this, fade the cell to signal low confidence

export function MatchupMatrix({
  matrix,
  formatSlug,
  windowDays,
  source,
}: {
  matrix: Matrix;
  formatSlug: string;
  windowDays: number;
  source: string;
}) {
  const archs = matrix.archetypes;
  if (archs.length < 2) {
    return <p className="text-sm text-neutral-500">Not enough pairing data in this window yet to build a matrix.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-950" />
              {archs.map((_, j) => (
                <th key={j} className="px-1 pb-1 text-center font-medium text-neutral-500">
                  {j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {archs.map((row, i) => (
              <tr key={row.archetype}>
                <th className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 py-0.5 pr-2 text-right font-normal">
                  <Link
                    href={`/${formatSlug}/${row.slug}${pageQuery(windowDays, source)}`}
                    className="inline-flex items-center gap-1.5 text-neutral-300 hover:text-emerald-400"
                  >
                    <span className="tabular-nums text-neutral-600">{i + 1}.</span>
                    <ColorPips colorId={colorNameToId(row.colorName)} size={11} />
                    <span className="max-w-[12rem] truncate">{formatArchetype(row.archetype)}</span>
                  </Link>
                </th>
                {archs.map((col, j) => {
                  if (i === j) {
                    return <td key={j} className="h-8 w-12 border border-neutral-900 bg-neutral-900/40 text-center text-neutral-700">—</td>;
                  }
                  const c = matrix.cell(row.archetype, col.archetype);
                  if (!c || c.matches === 0) {
                    return <td key={j} className="h-8 w-12 border border-neutral-900 bg-neutral-950 text-center text-neutral-700">·</td>;
                  }
                  const faded = c.matches < SMALL_SAMPLE;
                  const record = `${c.winsA}-${c.winsB}${c.draws ? `-${c.draws}` : ""}`;
                  return (
                    <td
                      key={j}
                      className="h-8 w-12 border border-neutral-900 text-center font-semibold tabular-nums"
                      style={{ background: winrateColor(c.winRateA, faded ? 0.3 : 0.92), color: faded ? "#9ca3af" : "#fff" }}
                      title={`${formatArchetype(row.archetype)} vs ${formatArchetype(col.archetype)}: ${record} — ${pct(c.winRateA, 1)} (95% CI ${pct(c.ciLow)}–${pct(c.ciHigh)}, n=${c.matches})`}
                    >
                      {pct(c.winRateA)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-2xl text-xs leading-5 text-neutral-500">
        Each cell is the <span className="text-neutral-300">row deck&apos;s match win&nbsp;%</span> against the column deck,
        computed from round-by-round pairings. Columns are numbered to match the rows. Faded cells have a small sample
        (n&nbsp;&lt;&nbsp;{SMALL_SAMPLE}); hover any cell for the record and 95% confidence interval.
      </p>
    </div>
  );
}
