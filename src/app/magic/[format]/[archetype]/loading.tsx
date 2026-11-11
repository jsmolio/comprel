import { ManaSpinner } from "@/components/ManaSpinner";

// Suspense fallback for the archetype detail route. Next prefetches this, so it
// appears instantly when you pick a deck from the metagame table while the
// (dynamic) page streams in behind it.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <ManaSpinner size={64} />
      <p className="text-sm text-neutral-400">Shuffling up the latest lists…</p>
    </div>
  );
}
