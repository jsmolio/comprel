import Link from "next/link";
import { FORMATS } from "@/lib/types";
import { pageQuery } from "@/lib/ui";

export function FormatTabs({ active, windowDays, source }: { active?: string; windowDays: number; source: string }) {
  return (
    <nav className="flex flex-wrap gap-1">
      {FORMATS.map((f) => {
        const slug = f.toLowerCase();
        const on = active?.toLowerCase() === slug;
        return (
          <Link
            key={f}
            href={`/${slug}${pageQuery(windowDays, source)}`}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              on ? "bg-emerald-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            ].join(" ")}
          >
            {f}
          </Link>
        );
      })}
    </nav>
  );
}
