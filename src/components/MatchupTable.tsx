"use client";

import { useState } from "react";
import type { MatchupRow } from "@/lib/queries";
import { formatArchetype, pct, winrateColor } from "@/lib/ui";

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

type SortKey = "opponent" | "winRateA" | "winsA" | "matches" | "ciLow";

// Each header maps to a sort key. "Record" sorts by match wins, "95% CI" by the
// lower confidence bound. Numeric columns default to descending on first click.
const COLUMNS: { key: SortKey; label: string; th: string; numeric: boolean }[] = [
  { key: "opponent", label: "Opponent", th: "py-2 pr-2", numeric: false },
  { key: "winRateA", label: "Win rate", th: "py-2 pr-2 text-right", numeric: true },
  { key: "winsA", label: "Record", th: "py-2 pr-2 text-right", numeric: true },
  { key: "matches", label: "n", th: "py-2 pr-2 text-right", numeric: true },
  { key: "ciLow", label: "95% CI", th: "py-2 pl-2", numeric: true },
];

export function MatchupTable({ rows }: { rows: MatchupRow[]; formatSlug: string; windowDays: number }) {
  // Default to the original order: sample size (n), descending.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "matches", dir: "desc" });

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No head-to-head pairing data for this deck in the selected window.</p>;
  }

  const sorted = [...rows].sort((a, b) => {
    const cmp =
      sort.key === "opponent"
        ? formatArchetype(a.opponent).localeCompare(formatArchetype(b.opponent))
        : (a[sort.key] as number) - (b[sort.key] as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const toggle = (key: SortKey, numeric: boolean) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
          {COLUMNS.map((c) => (
            <th
              key={c.key}
              className={`${c.th} font-medium`}
              aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
            >
              <button
                type="button"
                onClick={() => toggle(c.key, c.numeric)}
                title="Click to sort"
                className={`cursor-pointer select-none whitespace-nowrap uppercase tracking-wide hover:text-neutral-300 ${
                  sort.key === c.key ? "text-neutral-200" : ""
                }`}
              >
                {c.label}
                <span className="ml-0.5 inline-block w-3 text-left">
                  {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.opponent} className="border-b border-neutral-900">
            <td className="py-2 pr-2 text-neutral-200">{formatArchetype(r.opponent)}</td>
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
