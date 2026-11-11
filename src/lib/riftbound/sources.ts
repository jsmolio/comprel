/** BoundRift event sources. Chinese events count toward share only. */
export const RIFTBOUND_SOURCES = ["all", "uvs", "playriftbound", "topdeck", "loltcg"] as const;
export type RiftboundSource = (typeof RIFTBOUND_SOURCES)[number];

export const RIFTBOUND_SOURCE_LABELS: Record<RiftboundSource, string> = {
  all: "All",
  uvs: "UVS",
  playriftbound: "PlayRiftbound",
  topdeck: "topdeck.gg",
  loltcg: "Chinese",
};

/** Sources that publish lists (or standings) but no match results. */
export const SHARE_ONLY_SOURCES = new Set<string>(["loltcg"]);

export const DEFAULT_RIFTBOUND_SOURCE: RiftboundSource = "all";

export function sourceMatches(source: string, filter: string): boolean {
  if (filter === "all") return true;
  return source === filter;
}

export function matchesCount(source: string): boolean {
  return !SHARE_ONLY_SOURCES.has(source);
}
