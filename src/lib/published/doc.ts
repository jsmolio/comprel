import fs from "node:fs";

/** Read one published JSON document. Missing, unreadable JSON, or a failed schema check is null. */
export function readPublishedDoc<T extends { schemaVersion: number; status: string }>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${file} (${(error as Error).message}).`);
  }
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!parsed || parsed.schemaVersion !== 1 || parsed.status !== "ok") return null;
  return parsed;
}

/** Path segments used in published filenames. Rejects anything that could escape the game directory. */
export function publishedSegment(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value)) {
    throw new Error(`Refusing to publish a snapshot path segment ${JSON.stringify(value)}.`);
  }
  return value;
}

export interface PublishedPart {
  rel: string;
  doc: { schemaVersion: 1; status: "ok"; publishedAt?: string };
}

/** Keeps the schema fields and allows the rest of a part's payload. */
export function publishedPart<T extends PublishedPart["doc"]>(rel: string, doc: T): PublishedPart {
  return { rel, doc };
}
