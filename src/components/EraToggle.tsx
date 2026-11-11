import Link from "next/link";
import { pageQuery } from "@/lib/ui";
import { ALL_ERA, type EraDef } from "@/lib/riftbound/eras";

export function EraToggle({
  basePath,
  windowDays,
  source,
  era,
  eras,
}: {
  basePath: string;
  windowDays: number;
  source: string;
  era: string;
  eras: EraDef[];
}) {
  const choices = [{ id: ALL_ERA, name: "All eras" }, ...eras.map((item) => ({ id: item.id, name: item.name }))];
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Set era">
      {choices.map((choice) => {
        const on = choice.id === era;
        return (
          <Link
            key={choice.id}
            href={`${basePath}${pageQuery(windowDays, source, { era: choice.id === ALL_ERA ? undefined : choice.id })}`}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              on ? "bg-emerald-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
          >
            {choice.name}
          </Link>
        );
      })}
    </nav>
  );
}
