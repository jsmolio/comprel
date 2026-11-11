import { FORMATS } from "./types";

/** Lowercase format slugs that used to live at the site root. */
export const MAGIC_FORMAT_SLUGS = FORMATS.map((format) => format.toLowerCase());

const FORMAT_SLUG = new Set(MAGIC_FORMAT_SLUGS);

/**
 * Permanent destination for a legacy Magic path, or null when the path is not one.
 * Format segment is matched case-insensitively. The archetype segment is preserved.
 * Query strings are not part of the path; Next.js redirects pass them through.
 */
export function magicLegacyDestination(pathname: string): string | null {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length < 1 || parts.length > 2) return null;
  const format = parts[0].toLowerCase();
  if (!FORMAT_SLUG.has(format)) return null;
  if (parts.length === 1) return `/magic/${format}`;
  return `/magic/${format}/${parts[1]}`;
}

/** Same mapping, keeping the original query string (`?window=14&source=paper`). */
export function magicLegacyLocation(pathname: string, search = ""): string | null {
  const dest = magicLegacyDestination(pathname);
  if (!dest) return null;
  if (!search) return dest;
  return `${dest}${search.startsWith("?") ? search : `?${search}`}`;
}

export function magicRedirects(): { source: string; destination: string; permanent: true }[] {
  const group = MAGIC_FORMAT_SLUGS.join("|");
  return [
    {
      source: `/:format(${group})`,
      destination: "/magic/:format",
      permanent: true,
    },
    {
      source: `/:format(${group})/:archetype`,
      destination: "/magic/:format/:archetype",
      permanent: true,
    },
  ];
}
