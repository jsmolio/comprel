"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from "react";

/**
 * Card name in a decklist. Click (or hover with a mouse) opens the card image
 * in a fixed popup so it is not clipped by the deck grid. Touch devices never
 * match the old hover-only CSS, and a click used to do nothing.
 */
export function CardPreview({
  name,
  count,
  imageUrl,
  href,
}: {
  name: string;
  count: number;
  imageUrl: string | null;
  href?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  function place() {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 240;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const top = below + 340 > window.innerHeight ? Math.max(8, rect.top - 332) : below;
    setBox({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      setPinned(false);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      const dialog = document.getElementById(dialogId);
      if (dialog?.contains(target)) return;
      setOpen(false);
      setPinned(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, dialogId]);

  return (
    <>
      <span className="w-5 shrink-0 tabular-nums text-neutral-500">{count}</span>
      {imageUrl ? (
        <button
          ref={buttonRef}
          type="button"
          className="text-left text-neutral-200 hover:text-emerald-400"
          aria-expanded={open}
          aria-controls={dialogId}
          aria-haspopup="dialog"
          onClick={() => {
            place();
            setPinned((current) => {
              const next = !current;
              setOpen(next);
              return next;
            });
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse" || pinned) return;
            place();
            setOpen(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "mouse" || pinned) return;
            setOpen(false);
          }}
        >
          {name}
        </button>
      ) : (
        <span className="text-neutral-200">{name}</span>
      )}
      {imageUrl && (
        <span
          id={dialogId}
          role="dialog"
          aria-label={name}
          hidden={!open}
          className="fixed z-50"
          style={box ? { top: box.top, left: box.left } : undefined}
        >
          <img src={imageUrl} alt={name} width={223} className="rounded-xl shadow-2xl ring-1 ring-black/60" />
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-emerald-500 hover:text-emerald-400">
              Open card page
            </a>
          )}
        </span>
      )}
    </>
  );
}
