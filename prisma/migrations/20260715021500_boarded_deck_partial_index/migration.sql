-- Partial index over the small set of decks that still carry card lists
-- (boards are blanked beyond the N most-recent per archetype). Serves:
--   * retention.ts slim-boards ranking CTE (format, archetype, date DESC)
--   * scryfall.ts distinct card-name extraction
--   * queries.ts archetype-page decklist lookup
-- Without it these all seq-scan Deck's ~120MB heap + JSONB TOAST every run.
CREATE INDEX IF NOT EXISTS "Deck_boarded_idx"
ON "Deck" ("format", "archetype", "date" DESC, "id")
WHERE ("mainboard" <> '[]'::jsonb OR "sideboard" <> '[]'::jsonb);
