/**
 * Where "View full list" should go.
 *
 * MTGO's embedded event JSON sets `url` to the challenges index, not the event.
 * The scraper used to store that index as the deck anchor, so the link left the
 * specific list. A real list is the event page (plus the player fragment MTGO
 * uses) or another source's deck URL.
 */

const MTGO_EVENT = /^https:\/\/(?:www\.)?mtgo\.com\/decklist\/[^#?]+/i;

export function isGenericMtgoIndex(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "mtgo.com" && host !== "www.mtgo.com") return false;
    return !parsed.pathname.toLowerCase().startsWith("/decklist/");
  } catch {
    return false;
  }
}

function playerFragment(player: string): string {
  const token = /^[\w.-]+$/.test(player) ? player : encodeURIComponent(player);
  return `#deck_${token}`;
}

export function fullListHref(deck: {
  anchorUri: string | null;
  tournamentUri: string | null;
  player: string;
}): string | null {
  const anchor = deck.anchorUri?.trim() || null;
  const event = deck.tournamentUri?.trim() || null;
  if (anchor && !isGenericMtgoIndex(anchor)) return anchor;
  if (!event || isGenericMtgoIndex(event)) return null;
  const match = event.match(MTGO_EVENT);
  if (match) return `${match[0]}${playerFragment(deck.player)}`;
  return event.split("#")[0];
}
