import type { TimelinePoint, BanMarker } from "@/lib/queries";
import type { Format } from "@/lib/types";
import { pct } from "@/lib/ui";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (t: number) => {
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
};

/**
 * Dependency-free SVG of an archetype's weekly meta share over the last ~12 months,
 * with dashed amber markers at B&R announcements that affected this format (#5).
 * `bans` is the merged curated + auto-detected list passed in by the caller.
 */
export function ShareChart({ points, format, bans }: { points: TimelinePoint[]; format: Format; bans: BanMarker[] }) {
  if (points.length < 3) {
    return <p className="text-sm text-neutral-500">Not enough history yet to chart this deck&apos;s share over time.</p>;
  }

  const W = 760;
  const H = 200;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const times = points.map((p) => Date.parse(p.week));
  const minX = times[0];
  const maxX = times[times.length - 1];
  const spanX = maxX - minX || 1;
  const maxShare = Math.max(0.02, ...points.map((p) => p.share));

  const X = (t: number) => padL + ((t - minX) / spanX) * innerW;
  const Y = (s: number) => padT + (1 - s / maxShare) * innerH;

  const linePath = points.map((p, i) => `${i ? "L" : "M"}${X(times[i]).toFixed(1)},${Y(p.share).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${X(maxX).toFixed(1)},${(padT + innerH).toFixed(1)} L${X(minX).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const yTicks = [0, maxShare / 2, maxShare];
  const xIdx = [0, Math.floor(points.length / 2), points.length - 1];

  const marks = bans
    .map((b) => ({ ...b, t: Date.parse(b.date) }))
    .filter((b) => b.t >= minX && b.t <= maxX);

  return (
    <figure className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${format} meta share over time`}>
        {yTicks.map((s, i) => (
          <g key={`y${i}`}>
            <line x1={padL} x2={W - padR} y1={Y(s)} y2={Y(s)} stroke="#262626" />
            <text x={padL - 5} y={Y(s) + 3} textAnchor="end" fontSize={9} fill="#737373">
              {pct(s, s < 0.1 ? 1 : 0)}
            </text>
          </g>
        ))}

        {marks.map((b, i) => (
          <g key={`b${i}`}>
            <line x1={X(b.t)} x2={X(b.t)} y1={padT} y2={padT + innerH} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
            <circle cx={X(b.t)} cy={padT} r={3} fill="#f59e0b">
              <title>{`B&R ${b.date} — ${b.label}`}</title>
            </circle>
          </g>
        ))}

        <path d={areaPath} fill="rgba(16,185,129,0.14)" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.75} strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle key={`p${i}`} cx={X(times[i])} cy={Y(p.share)} r={4} fill="transparent">
            <title>{`Week of ${p.week}: ${pct(p.share, 1)} (${p.n}/${p.total} decks)`}</title>
          </circle>
        ))}

        {xIdx.map((idx, i) => (
          <text
            key={`x${i}`}
            x={X(times[idx])}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === xIdx.length - 1 ? "end" : "middle"}
            fontSize={9}
            fill="#737373"
          >
            {monthLabel(times[idx])}
          </text>
        ))}
      </svg>
      {marks.length > 0 && (
        <figcaption className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden /> dashed lines mark B&amp;R announcements affecting {format} (hover for details)
        </figcaption>
      )}
    </figure>
  );
}
