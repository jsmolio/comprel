import type { ReactNode } from "react";
import Link from "next/link";
import type { ArchetypeRow } from "@/lib/queries";
import { colorNameToId } from "@/lib/archetype/colors";
import { META_PREVIEW_COUNT, partitionMetaRows } from "@/lib/meta-rows";
import { conversionRate, formatArchetype, pageQuery, pct, winrateColor } from "@/lib/ui";
import { ColorPips } from "./ColorPips";
import { TrendBadge } from "./TrendBadge";

const RELIABLE_SAMPLE = 20;

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

function MetaRow({
  row,
  rank,
  formatSlug,
  windowDays,
  source,
  linkRoot,
  extra,
  renderIdentity,
  maxShare,
}: {
  row: ArchetypeRow;
  rank: number;
  formatSlug: string;
  windowDays: number;
  source: string;
  linkRoot?: string;
  extra?: Record<string, string | undefined>;
  renderIdentity?: (row: ArchetypeRow) => ReactNode;
  maxShare: number;
}) {
  return (
    <tr className="border-b border-neutral-900 hover:bg-neutral-900/60">
      <td className="py-2 pr-2 tabular-nums text-neutral-500">{rank}</td>
      <td className="py-2 pr-2">
        <Link
          href={`${linkRoot ?? `/magic/${formatSlug}`}/${row.slug}${pageQuery(windowDays, source, extra)}`}
          className="inline-flex items-center gap-2 font-medium text-neutral-100 hover:text-emerald-400"
        >
          <span>{formatArchetype(row.archetype)}</span>
          {renderIdentity ? renderIdentity(row) : <ColorPips colorId={colorNameToId(row.colorName)} />}
        </Link>
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${(row.metaShare / maxShare) * 100}%` }} />
          </div>
          <span className="w-12 tabular-nums text-neutral-300">
            {row.metaShare > 0 && row.metaShare < 0.001 ? "<0.1%" : pct(row.metaShare, 1)}
          </span>
          <TrendBadge current={row.metaShare} prev={row.prevShare} className="text-xs" />
        </div>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-neutral-400">{row.deckCount}</td>
      <td className="py-2 pr-2 text-right">
        <ConvCell top={row.conversion?.top8} elig={row.conversion?.elig8} />
      </td>
      <td className="py-2 pr-2 text-right">
        <ConvCell top={row.conversion?.top32} elig={row.conversion?.elig32} />
      </td>
      <td className="py-2 pl-2 text-right">
        {row.sampleMatches > 0 ? (
          <span
            className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white"
            style={{ background: winrateColor(row.winRate, row.sampleMatches >= RELIABLE_SAMPLE ? 0.9 : 0.4) }}
            title={`${pct(row.winRate, 1)} across ${row.sampleMatches} matches${row.sampleMatches < RELIABLE_SAMPLE ? " (small sample)" : ""}`}
          >
            {pct(row.winRate, 1)}
          </span>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>
    </tr>
  );
}

function OtherRow({
  rank,
  tailCount,
  tailDecks,
  tailShare,
  maxShare,
  tailNoun,
}: {
  rank: number;
  tailCount: number;
  tailDecks: number;
  tailShare: number;
  maxShare: number;
  tailNoun: string;
}) {
  return (
    <tr className="border-t border-neutral-800 text-neutral-500">
      <td className="py-2 pr-2 tabular-nums">{rank}</td>
      <td className="py-2 pr-2">
        Other <span className="text-xs">({tailCount} {tailNoun})</span>
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
  );
}

function MetaTable({
  rows,
  startRank,
  formatSlug,
  windowDays,
  source,
  linkRoot,
  extra,
  renderIdentity,
  nameColumn,
  maxShare,
  other,
}: {
  rows: ArchetypeRow[];
  startRank: number;
  formatSlug: string;
  windowDays: number;
  source: string;
  linkRoot?: string;
  extra?: Record<string, string | undefined>;
  renderIdentity?: (row: ArchetypeRow) => ReactNode;
  nameColumn: string;
  maxShare: number;
  other?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">{nameColumn}</th>
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
          {rows.map((row, index) => (
            <MetaRow
              key={row.archetype}
              row={row}
              rank={startRank + index}
              formatSlug={formatSlug}
              windowDays={windowDays}
              source={source}
              linkRoot={linkRoot}
              extra={extra}
              renderIdentity={renderIdentity}
              maxShare={maxShare}
            />
          ))}
          {other}
        </tbody>
      </table>
    </div>
  );
}

export function MetaShareTable({
  rows,
  formatSlug,
  windowDays,
  source,
  linkRoot,
  extra,
  renderIdentity,
  nameColumn = "Deck",
  tailNoun = "archetypes",
  previewCount = META_PREVIEW_COUNT,
}: {
  rows: ArchetypeRow[];
  formatSlug: string;
  windowDays: number;
  source: string;
  /** Path before the archetype slug. Defaults to `/magic/{format}`. */
  linkRoot?: string;
  extra?: Record<string, string | undefined>;
  renderIdentity?: (row: ArchetypeRow) => ReactNode;
  nameColumn?: string;
  tailNoun?: string;
  /** Named archetypes shown before the disclosure. */
  previewCount?: number;
}) {
  const { kept, tail, preview, rest } = partitionMetaRows(rows, previewCount);
  const tailDecks = tail.reduce((n, row) => n + row.deckCount, 0);
  const tailShare = tail.reduce((n, row) => n + row.metaShare, 0);
  const maxShare = Math.max(0.0001, ...kept.map((row) => row.metaShare), tailShare);
  const shared = { formatSlug, windowDays, source, linkRoot, extra, renderIdentity, nameColumn, maxShare };
  const other =
    tail.length > 0 ? (
      <OtherRow
        rank={kept.length + 1}
        tailCount={tail.length}
        tailDecks={tailDecks}
        tailShare={tailShare}
        maxShare={maxShare}
        tailNoun={tailNoun}
      />
    ) : null;

  return (
    <div className="space-y-3">
      <MetaTable {...shared} rows={preview} startRank={1} other={rest.length === 0 ? other : null} />
      {rest.length > 0 && (
        <details className="meta-more">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-sm font-medium text-neutral-300 hover:border-emerald-700/60 hover:text-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
            <span className="when-closed">Show all {kept.length} {tailNoun}</span>
            <span className="when-open">Show top {preview.length}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden
              className="meta-chevron transition-transform"
            >
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="mt-3">
            <MetaTable {...shared} rows={rest} startRank={preview.length + 1} other={other} />
          </div>
        </details>
      )}
    </div>
  );
}
