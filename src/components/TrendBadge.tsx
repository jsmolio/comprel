import { pct } from "@/lib/ui";

/**
 * Up/down change in meta share vs the immediately-preceding equal window,
 * shown in percentage points (e.g. "▲ 2.3" = +2.3 pts of the metagame).
 */
export function TrendBadge({ current, prev, className = "" }: { current: number; prev: number | undefined; className?: string }) {
  if (prev === undefined) return null; // no previous-window data to compare against
  const pts = (current - prev) * 100;
  if (Math.abs(pts) < 0.1) {
    return (
      <span className={`tabular-nums text-neutral-600 ${className}`} title="No meaningful change vs the previous window">
        ±0
      </span>
    );
  }
  const up = pts > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${up ? "text-emerald-400" : "text-rose-400"} ${className}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(pts).toFixed(1)} points vs the previous equal-length window (was ${pct(prev, 1)})`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(pts).toFixed(1)}
    </span>
  );
}
