import fs from "node:fs";
import path from "node:path";

/** Runner-temp files the ingest workflow copies into $GITHUB_STEP_SUMMARY. */
export const INGEST_SUMMARY_FILES = {
  magic: "comprel-ingest-magic.md",
  riftbound: "comprel-ingest-riftbound.md",
} as const;

export type IngestGame = keyof typeof INGEST_SUMMARY_FILES;

export interface DiagnosticEvent {
  /** Public URL when the source has one, otherwise the event id. */
  ref: string;
  /** Stable reason used for the count, such as `timeout` or `budget`. */
  reason: string;
  /** Extra per-event detail that does not split the reason count. */
  detail?: string;
}

export interface IngestDiagnostic {
  game: "Magic" | "Riftbound";
  /** One plain-text status line for this run. */
  status: string;
  sections: { title: string; events: DiagnosticEvent[] }[];
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Counts grouped by reason, highest count first, then reason name. */
export function countByReason(events: { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const reason = oneLine(event.reason) || "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
}

export function renderIngestDiagnostic(diagnostic: IngestDiagnostic): string {
  const lines = [`## ${diagnostic.game} ingest`, "", oneLine(diagnostic.status), ""];
  for (const section of diagnostic.sections) {
    const counts = countByReason(section.events);
    lines.push(`### ${section.title}`);
    lines.push("");
    lines.push(counts ? `Count: ${section.events.length} (${counts})` : "Count: 0");
    lines.push("");
    if (section.events.length === 0) {
      lines.push("None.");
    } else {
      for (const event of section.events) {
        const reason = oneLine(event.reason) || "unknown";
        const detail = event.detail ? oneLine(event.detail) : "";
        const why = detail ? `${reason} (${detail})` : reason;
        lines.push(`- ${oneLine(event.ref)} — ${why}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function ingestSummaryPath(game: IngestGame): string | null {
  const dir = process.env.RUNNER_TEMP;
  if (!dir) return null;
  return path.join(dir, INGEST_SUMMARY_FILES[game]);
}

/**
 * Prints the summary and, on Actions, writes it where the diagnostics step
 * can append it to $GITHUB_STEP_SUMMARY. A failed game step still leaves the
 * file in RUNNER_TEMP because that step is continue-on-error.
 */
export function reportIngestDiagnostic(
  game: IngestGame,
  diagnostic: IngestDiagnostic,
  log: (message: string) => void = console.log,
): void {
  const text = renderIngestDiagnostic(diagnostic);
  log(text.trimEnd());
  const file = ingestSummaryPath(game);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
