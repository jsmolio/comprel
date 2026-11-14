"use client";

import { useEffect, useId, useState } from "react";
import {
  deckExportFilename,
  formatArena,
  formatMtgo,
  formatPlain,
  type DeckFileLabel,
  type TypeLines,
} from "@/lib/deck-export";
import type { BoardCard } from "@/lib/types";

interface Notice {
  id: number;
  tone: "ok" | "err";
  text: string;
}

/**
 * Copy and download actions for one Magic list. The formatted text is built in
 * the click handler so the buttons stay usable without a server round trip.
 */
export function DeckExport({
  mainboard,
  sideboard,
  typeLines,
  label,
}: {
  mainboard: readonly BoardCard[];
  sideboard: readonly BoardCard[];
  typeLines: TypeLines;
  label: DeckFileLabel;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const statusId = useId();
  const deck = { mainboard, sideboard };
  const filename = deckExportFilename(label);
  const who = [label.player, label.archetype].filter(Boolean).join(", ") || "this deck";

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copy(text: string) {
    const ok = await writeClipboard(text);
    show(ok ? "Copied!" : "Couldn't copy", ok ? "ok" : "err");
  }

  function download() {
    const text = formatMtgo(deck, typeLines);
    try {
      saveTextFile(filename, text);
      show("Downloaded", "ok");
    } catch {
      show("Couldn't download", "err");
    }
  }

  function show(text: string, tone: Notice["tone"]) {
    setNotice({ id: Date.now(), tone, text });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClass}
        aria-label={`Copy ${who} for MTG Arena`}
        onClick={() => void copy(formatArena(deck, typeLines))}
      >
        Copy for Arena
      </button>
      <button type="button" className={buttonClass} aria-label={`Download ${who} for Magic Online`} onClick={download}>
        Download for MTGO
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={`Copy ${who} as plain text`}
        onClick={() => void copy(formatPlain(deck, typeLines))}
      >
        Copy text
      </button>
      <span id={statusId} role="status" aria-live="polite" className="min-h-5 text-xs">
        {notice && (
          <span key={notice.id} className={notice.tone === "ok" ? "text-emerald-400" : "text-amber-400"}>
            {notice.text}
            <span className="sr-only"> {who}. {filename}</span>
          </span>
        )}
      </span>
    </div>
  );
}

const buttonClass =
  "inline-flex min-h-9 items-center rounded-md border border-neutral-800 bg-neutral-900/60 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-emerald-700/60 hover:text-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older selection copy, which still works on some mobile browsers.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function saveTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
