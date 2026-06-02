import Link from "next/link";
import { SOURCE_FILTERS, SOURCE_LABELS } from "@/lib/types";
import { pageQuery } from "@/lib/ui";

/** Segmented control switching the metagame data source (All / Paper / MTGO). */
export function SourceToggle({
  basePath,
  windowDays,
  source,
}: {
  basePath: string;
  windowDays: number;
  source: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-sm">
      {SOURCE_FILTERS.map((s) => {
        const on = s === source;
        return (
          <Link
            key={s}
            href={`${basePath}${pageQuery(windowDays, s)}`}
            className={[
              "px-3 py-1 transition-colors",
              on ? "bg-sky-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
            title={`${SOURCE_LABELS[s]} events`}
          >
            {SOURCE_LABELS[s]}
          </Link>
        );
      })}
    </div>
  );
}
