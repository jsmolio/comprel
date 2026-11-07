// Read-only copy of the existing Postgres database into the fact log.
// Never updates or deletes database rows. Refuses to run without an explicit flag
// so a casual invocation cannot surprise anyone who still has production credentials.

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { classifierVersion } from "../src/lib/facts/classifier-version";
import { publishSnapshot } from "../src/lib/facts/publish";
import { FactStore, withPublishLock } from "../src/lib/facts/store";
import type { FactEvent, FactExtras, PlayerBoard } from "../src/lib/facts/types";
import { prisma } from "../src/lib/db";
import { FORMATS, type Format } from "../src/lib/types";
import type { BoardCard } from "../src/lib/types";

const FOLDER: Record<string, string> = {
  "melee.gg": "MTGmelee",
  "mtgo.com": "MTGO",
  "topdeck.gg": "Topdeck",
  "manatraders.com": "Manatrader",
  "cardsrealm.com": "CardsRealm",
};

function sourcePathFor(id: string, source: string, date: Date): string | null {
  const folder = FOLDER[source];
  const prefix = `${source}:`;
  if (!folder || !id.startsWith(prefix)) return null;
  const stableId = id.slice(prefix.length);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `Tournaments/${folder}/${y}/${m}/${d}/${stableId}.json`;
}

function asBoard(value: unknown): BoardCard[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((card): card is { name: string; count: number } => {
      return Boolean(card) && typeof card === "object" && "name" in card;
    })
    .map((card) => ({ name: String(card.name), count: Number(card.count) || 0 }));
}

async function main() {
  if (!process.argv.includes("--yes-read-only")) {
    console.error("Refusing to run. This reads Postgres and writes local fact files only.");
    console.error("Re-run with --yes-read-only once DATABASE_URL points at the database you mean to read.");
    process.exit(1);
  }
  const version = `db-export:${classifierVersion()}`;
  const store = new FactStore(process.cwd());
  const allow = new Set<string>(FORMATS);

  await withPublishLock(store, async () => {
    console.log("→ Reading tournaments (read-only)…");
    const tournaments = await prisma.tournament.findMany({
      include: { decks: true, matches: true },
    });
    let events = 0;
    for (const tournament of tournaments) {
      if (!allow.has(tournament.format)) continue;
      const boards: Record<string, PlayerBoard> = {};
      const event: FactEvent = {
        schemaVersion: 1,
        classifierVersion: version,
        id: tournament.id,
        source: tournament.source,
        name: tournament.name,
        date: tournament.date.toISOString(),
        format: tournament.format as Format,
        uri: tournament.uri,
        sourcePath: sourcePathFor(tournament.id, tournament.source, tournament.date),
        deckCount: tournament.deckCount || tournament.decks.length,
        decks: tournament.decks.map((deck) => {
          const mainboard = asBoard(deck.mainboard);
          const sideboard = asBoard(deck.sideboard);
          if (mainboard.length || sideboard.length) {
            boards[deck.player] = {
              result: deck.result,
              anchorUri: deck.anchorUri,
              mainboard,
              sideboard,
            };
          }
          return {
            player: deck.player,
            archetype: deck.archetype || "Unknown",
            colorName: deck.colorName,
            rank: deck.rank,
          };
        }),
        matches: tournament.matches.map((match) => ({
          player1: match.player1,
          player2: match.player2,
          winner: (match.winner === 1 || match.winner === 2 ? match.winner : 0) as 0 | 1 | 2,
        })),
      };
      store.putEvent(event);
      if (Object.keys(boards).length) store.writeBoards(tournament.id, boards);
      events++;
    }
    console.log(`  exported ${events} tournaments`);

    const videos = await prisma.video.findMany();
    const banEvents = await prisma.banEvent.findMany();
    const banSnapshots = await prisma.banSnapshot.findMany();
    const extras: FactExtras = {
      schemaVersion: 1,
      videos: videos.map((video) => ({
        id: video.id,
        format: video.format,
        archetype: video.archetype,
        title: video.title,
        channelTitle: video.channelTitle,
        publishedAt: video.publishedAt?.toISOString() ?? null,
        thumbnail: video.thumbnail,
      })),
      banEvents: banEvents.map((event) => ({
        format: event.format,
        date: event.date.toISOString().slice(0, 10),
        card: event.card,
        action: event.action,
      })),
      banSnapshot: Object.fromEntries(
        banSnapshots.map((row) => [
          row.format,
          { banned: asNames(row.banned), restricted: asNames(row.restricted) },
        ]),
      ),
    };
    store.writeExtras(extras);
    console.log(`  videos ${extras.videos.length}, detected ban events ${extras.banEvents.length}`);
    console.log("  These rows are not recoverable from the public cache. The database was not modified.");

    if (!process.argv.includes("--no-publish")) {
      const published = await publishSnapshot(store, { classifierVersion: version, log: (m) => console.log(m) });
      console.log(published.changed ? "  snapshot updated" : "  snapshot unchanged");
    }
  });

  await prisma.$disconnect();
  console.log("✓ Export finished. Review data/facts and data/published before committing.");
}

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map((name) => String(name)) : [];
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
