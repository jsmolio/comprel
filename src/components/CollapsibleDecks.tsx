"use client";

import { useState } from "react";

/**
 * Shows the most-recent decklist by default and tucks the rest behind a toggle,
 * so the section stays compact. The deck articles are rendered on the server and
 * passed in as nodes — this component only flips their visibility, so the card
 * map never has to cross the client boundary.
 */
export function CollapsibleDecks({
  first,
  rest,
  restCount,
}: {
  first: React.ReactNode;
  rest: React.ReactNode;
  restCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      {first}
      {restCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-sm font-medium text-neutral-300 transition-colors hover:border-emerald-700/60 hover:text-emerald-400"
          >
            {open ? "Hide older lists" : `Show ${restCount} more list${restCount > 1 ? "s" : ""}`}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && <div className="space-y-4">{rest}</div>}
        </>
      )}
    </div>
  );
}
