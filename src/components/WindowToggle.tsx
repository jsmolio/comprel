import Link from "next/link";
import { WINDOW_CHOICES } from "@/lib/types";
import { pageQuery } from "@/lib/ui";

/** Segmented control linking to the same page with a different rolling window. */
export function WindowToggle({
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
      {WINDOW_CHOICES.map((w) => {
        const on = w === windowDays;
        return (
          <Link
            key={w}
            href={`${basePath}${pageQuery(w, source)}`}
            className={[
              "px-3 py-1 transition-colors",
              on ? "bg-emerald-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
            title={`Last ${w} days of data`}
          >
            {w}d
          </Link>
        );
      })}
    </div>
  );
}
