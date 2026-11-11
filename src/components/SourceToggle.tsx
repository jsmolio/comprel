import Link from "next/link";
import { SOURCE_FILTERS, SOURCE_LABELS } from "@/lib/types";
import { pageQuery } from "@/lib/ui";

/** Segmented control switching the metagame data source. Magic defaults to All / Paper / MTGO. */
export function SourceToggle({
  basePath,
  windowDays,
  source,
  extra,
  filters = SOURCE_FILTERS,
  labels = SOURCE_LABELS as Record<string, string>,
}: {
  basePath: string;
  windowDays: number;
  source: string;
  extra?: Record<string, string | undefined>;
  filters?: readonly string[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-sm">
      {filters.map((s) => {
        const on = s === source;
        return (
          <Link
            key={s}
            href={`${basePath}${pageQuery(windowDays, s, extra)}`}
            className={[
              "px-3 py-1 transition-colors",
              on ? "bg-sky-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
            title={`${labels[s] ?? s} events`}
          >
            {labels[s] ?? s}
          </Link>
        );
      })}
    </div>
  );
}
