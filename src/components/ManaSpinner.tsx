// MTG-themed loading spinner: the five mana colors (WUBRG) orbiting a center,
// with a comet-trail fade so the rotation reads clearly. Pure CSS (animate-spin),
// no JS or network — safe as a server-rendered Suspense fallback.
const COLORS = [
  { c: "#f9faf4", ring: "#0003" }, // W
  { c: "#0e68ab", ring: "#0003" }, // U
  { c: "#2b2622", ring: "#fff2" }, // B
  { c: "#d3202a", ring: "#0003" }, // R
  { c: "#00733e", ring: "#0003" }, // G
];

export function ManaSpinner({ size = 56 }: { size?: number }) {
  const dot = Math.round(size * 0.26);
  const radius = size / 2 - dot / 2;
  return (
    <span
      className="relative inline-block motion-safe:animate-spin"
      style={{ width: size, height: size, animationDuration: "1.15s" }}
      role="status"
      aria-label="Loading"
    >
      {COLORS.map((co, i) => {
        const angle = (i / COLORS.length) * 2 * Math.PI - Math.PI / 2;
        const left = size / 2 + radius * Math.cos(angle) - dot / 2;
        const top = size / 2 + radius * Math.sin(angle) - dot / 2;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              width: dot,
              height: dot,
              left,
              top,
              background: co.c,
              boxShadow: `inset 0 0 0 1px ${co.ring}`,
              opacity: 0.35 + (0.65 * i) / (COLORS.length - 1), // comet trail
            }}
          />
        );
      })}
    </span>
  );
}
