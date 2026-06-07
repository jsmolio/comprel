/* eslint-disable @next/next/no-img-element */

export interface SignatureCard {
  name: string;
  imageUrl: string;
}

/** A row of the cards that most define an archetype, shown as full card images. */
export function SignatureCards({ cards }: { cards: SignatureCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {cards.map((c) => (
        <img
          key={c.name}
          src={c.imageUrl}
          alt={c.name}
          title={c.name}
          loading="lazy"
          draggable={false}
          className="h-44 w-auto rounded-xl shadow-lg ring-1 ring-black/50 transition-transform hover:-translate-y-1 sm:h-56"
        />
      ))}
    </div>
  );
}
