import { FORMATS, type Format } from "./types";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveFormat(slug: string): Format | null {
  return FORMATS.find((f) => f.toLowerCase() === slug.toLowerCase()) ?? null;
}
