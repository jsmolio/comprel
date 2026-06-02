const PIP: Record<string, { bg: string; fg: string }> = {
  W: { bg: "#f9faf4", fg: "#1a1a1a" },
  U: { bg: "#0e68ab", fg: "#ffffff" },
  B: { bg: "#2b2622", fg: "#e8e8e8" },
  R: { bg: "#d3202a", fg: "#ffffff" },
  G: { bg: "#00733e", fg: "#ffffff" },
};

export function ColorPips({ colorId, size = 14 }: { colorId: string | null | undefined; size?: number }) {
  const letters = (colorId ?? "").split("").filter((l) => l in PIP);
  if (letters.length === 0) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-neutral-600 text-neutral-400"
        style={{ width: size, height: size, fontSize: size * 0.7 }}
        title="Colorless"
      >
        ◇
      </span>
    );
  }
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {letters.map((l, i) => (
        <span
          key={i}
          className="inline-block rounded-full ring-1 ring-black/30"
          style={{ width: size, height: size, background: PIP[l].bg }}
          title={l}
        />
      ))}
    </span>
  );
}
