export const DOMAIN_ORDER = ["Fury", "Mind", "Calm", "Body", "Order", "Chaos"] as const;
export type DomainName = (typeof DOMAIN_ORDER)[number];

const LABEL_BY_SLUG: Record<string, DomainName> = {
  fury: "Fury",
  mind: "Mind",
  calm: "Calm",
  body: "Body",
  order: "Order",
  chaos: "Chaos",
};

export function domainLabel(slugOrLabel: string): DomainName | null {
  const direct = DOMAIN_ORDER.find((name) => name.toLowerCase() === slugOrLabel.toLowerCase());
  if (direct) return direct;
  return LABEL_BY_SLUG[slugOrLabel.toLowerCase()] ?? null;
}

export function colorNameFromDomains(domains: readonly string[]): string | null {
  const labels = domains.map(domainLabel).filter((label): label is DomainName => label != null);
  const unique = DOMAIN_ORDER.filter((name) => labels.includes(name));
  return unique.length ? unique.join(" ") : null;
}

export function domainsFromColorName(colorName: string | null | undefined): DomainName[] {
  if (!colorName) return [];
  const found = new Set<DomainName>();
  for (const part of colorName.split(/[^A-Za-z]+/)) {
    const label = domainLabel(part);
    if (label) found.add(label);
  }
  return DOMAIN_ORDER.filter((name) => found.has(name));
}

const RUNE = /\brune\b/i;

export function isRuneCard(name: string, typeLine: string | null | undefined): boolean {
  if (RUNE.test(typeLine ?? "")) return true;
  return /\brune$/i.test(name.trim());
}

export const RIFTBOUND_CATEGORY_ORDER = ["Units", "Spells", "Gear", "Battlefields", "Legends", "Runes", "Other"] as const;

export function riftboundCategory(typeLine: string | null | undefined): string {
  const t = (typeLine ?? "").toLowerCase();
  if (t.includes("unit")) return "Units";
  if (t.includes("spell")) return "Spells";
  if (t.includes("gear")) return "Gear";
  if (t.includes("battlefield")) return "Battlefields";
  if (t.includes("legend")) return "Legends";
  if (t.includes("rune")) return "Runes";
  return "Other";
}
