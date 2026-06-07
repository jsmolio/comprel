/* eslint-disable @next/next/no-img-element */

// Official Scryfall mana-symbol SVGs (the round, colored glyphs sites like
// MTGGoldfish use). Only six distinct URLs are ever requested, so the browser
// caches them after first paint. We key by the WUBRG letters in a color id.
const SYMBOL: Record<string, string> = {
  W: "https://svgs.scryfall.io/card-symbols/W.svg",
  U: "https://svgs.scryfall.io/card-symbols/U.svg",
  B: "https://svgs.scryfall.io/card-symbols/B.svg",
  R: "https://svgs.scryfall.io/card-symbols/R.svg",
  G: "https://svgs.scryfall.io/card-symbols/G.svg",
  C: "https://svgs.scryfall.io/card-symbols/C.svg", // colorless
};

export function ColorPips({ colorId, size = 14 }: { colorId: string | null | undefined; size?: number }) {
  const letters = (colorId ?? "").split("").filter((l) => l in SYMBOL && l !== "C");
  const shown = letters.length > 0 ? letters : ["C"];
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" aria-label={letters.join("") || "Colorless"}>
      {shown.map((l, i) => (
        <img
          key={i}
          src={SYMBOL[l]}
          alt={l}
          title={l}
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          className="inline-block rounded-full"
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  );
}
