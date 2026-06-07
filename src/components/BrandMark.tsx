/**
 * The compREL badge — a "cR" tournament-stamp monogram (a nod to Competitive REL).
 * Inline SVG so it stays crisp at any size and renders the monogram in the site's
 * Geist font. The standalone favicon/apple-icon live in src/app/{icon.svg,apple-icon.png}.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="compREL" className="shrink-0">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#brandGrad)" />
      <rect x="4" y="4" width="56" height="56" rx="16" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.5" />
      <text
        x="32"
        y="43"
        textAnchor="middle"
        fontWeight={800}
        fontSize={32}
        letterSpacing="-1.5"
        fill="#052e23"
        fontFamily="var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
      >
        cR
      </text>
    </svg>
  );
}
