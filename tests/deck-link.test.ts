import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeckList } from "../src/components/DeckList";
import { fullListHref } from "../src/lib/deck-link";

const INDEX = "https://www.mtgo.com/premier-play-prelims-and-format-challenges#challenges";
const EVENT = "https://www.mtgo.com/decklist/modern-challenge-32-2026-11-1412858103";

test("full list prefers a specific deck URL over the MTGO challenges index", () => {
  assert.equal(
    fullListHref({
      anchorUri: INDEX,
      tournamentUri: EVENT,
      player: "gazmon48",
    }),
    `${EVENT}#deck_gazmon48`,
  );
  assert.equal(
    fullListHref({
      anchorUri: `${EVENT}#deck_gazmon48`,
      tournamentUri: EVENT,
      player: "gazmon48",
    }),
    `${EVENT}#deck_gazmon48`,
  );
  assert.equal(
    fullListHref({
      anchorUri: "https://melee.gg/Decklist/View/f3fe37a7-6c3e-4072-9387-b40d00867127",
      tournamentUri: "https://melee.gg/Tournament/View/413453",
      player: "Pavel",
    }),
    "https://melee.gg/Decklist/View/f3fe37a7-6c3e-4072-9387-b40d00867127",
  );
  assert.equal(
    fullListHref({
      anchorUri: "https://boundrift.com/d/gGwpvfNW",
      tournamentUri: "https://boundrift.com/event/abc",
      player: "Riven",
    }),
    "https://boundrift.com/d/gGwpvfNW",
  );
  assert.equal(fullListHref({ anchorUri: INDEX, tournamentUri: INDEX, player: "Walker735" }), null);
  assert.equal(fullListHref({ anchorUri: null, tournamentUri: null, player: "Ada" }), null);
});

test("clicking a decklist card name is a button that owns the card image", () => {
  const cards = new Map([
    ["Thoughtseize", { imageUrl: "https://cards.scryfall.io/normal/front/thoughtseize.jpg", typeLine: "Sorcery", manaCost: null, priceUsd: "7" }],
  ]);
  const html = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [{ name: "Thoughtseize", count: 4 }],
      sideboard: [],
      cardMap: cards,
    }),
  );
  assert.match(html, /<button[^>]*>Thoughtseize<\/button>/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /src="https:\/\/cards\.scryfall\.io\/normal\/front\/thoughtseize\.jpg"/);
  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(html, /group-hover:block/);

  const riftbound = renderToStaticMarkup(
    createElement(DeckList, {
      mainboard: [],
      sideboard: [],
      cardMap: new Map([
        ["The Exile", { imageUrl: "https://openrift.app/media/cards/exile.webp", typeLine: "Legend", manaCost: null, priceUsd: null }],
      ]),
      sections: [{ key: "legend", label: "Legend", cards: [{ name: "The Exile", count: 1 }] }],
      cardHref: () => "https://openrift.app/cards/the-exile",
    }),
  );
  assert.match(riftbound, /<button[^>]*>The Exile<\/button>/);
  assert.match(riftbound, /src="https:\/\/openrift\.app\/media\/cards\/exile\.webp"/);
  assert.match(riftbound, /href="https:\/\/openrift\.app\/cards\/the-exile"/);
  assert.doesNotMatch(riftbound, /<a[^>]*>The Exile<\/a>/);
});
