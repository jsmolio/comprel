import { domainsFromColorName, type DomainName } from "@/lib/riftbound/domains";

const COLOR: Record<DomainName, string> = {
  Fury: "#e23b2f",
  Mind: "#3b82f6",
  Calm: "#14b8a6",
  Body: "#f59e0b",
  Order: "#e8e4d4",
  Chaos: "#a855f7",
};

export function DomainPips({ colorName, size = 12 }: { colorName: string | null | undefined; size?: number }) {
  const domains = domainsFromColorName(colorName);
  if (domains.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" aria-label={domains.join(" ")}>
      {domains.map((domain) => (
        <span
          key={domain}
          title={domain}
          className="inline-block rounded-full ring-1 ring-black/40"
          style={{ width: size, height: size, background: COLOR[domain] }}
        />
      ))}
    </span>
  );
}
