import Link from "next/link";
import type { MatchupRow } from "@/lib/queries";
import { pct, winrateColor } from "@/lib/ui";

/** A 0–100% track with the win-rate marker and its 95% confidence band. */
function ConfidenceBar({ p, low, high }: { p: number; low: number; high: number }) {
  return (
    <div className="relative h-2.5 w-full min-w-[7rem] overflow-hidden rounded-full bg-neutral-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-600" />
      <div
        className="absolute inset-y-0 rounded-full bg-neutral-500/40"
        style={{ left: `${low * 100}%`, width: `${Math.max(1, (high - low) * 100)}%` }}
      />
      <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded" style={{ left: `${p * 100}%`, background: winrateColor(p, 1) }} />
    </div>
  );
}

export function MatchupTable({ rows }: { rows: MatchupRow[]; formatSlug: string; windowDays: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No head-to-head pairing data for this deck in the selected window.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-2 pr-2 font-medium">Opponent</th>
          <th className="py-2 pr-2 text-right font-medium">Win rate</th>
          <th className="py-2 pr-2 text-right font-medium">Record</th>
          <th className="py-2 pr-2 text-right font-medium">n</th>
          <th className="py-2 pl-2 font-medium">95% CI</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.opponent} className="border-b border-neutral-900">
            <td className="py-2 pr-2 text-neutral-200">{r.opponent}</td>
            <td className="py-2 pr-2 text-right">
              <span
                className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white"
                style={{ background: winrateColor(r.winRateA, r.matches >= 8 ? 0.9 : 0.4) }}
              >
                {pct(r.winRateA, 0)}
              </span>
            </td>
            <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">
              {r.winsA}-{r.winsB}
              {r.draws ? `-${r.draws}` : ""}
            </td>
            <td className="py-2 pr-2 text-right tabular-nums text-neutral-500">{r.matches}</td>
            <td className="py-2 pl-2">
              <div className="flex items-center gap-2">
                <ConfidenceBar p={r.winRateA} low={r.ciLow} high={r.ciHigh} />
                <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">
                  {pct(r.ciLow, 0)}–{pct(r.ciHigh, 0)}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
