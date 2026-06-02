// Report row counts, per-table sizes, and decklist (board) composition.
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { prisma } from "../src/lib/db";

async function main() {
  const [tournaments, decks, matches, cards, archetypeStats, matchupStats] = await Promise.all([
    prisma.tournament.count(),
    prisma.deck.count(),
    prisma.match.count(),
    prisma.card.count(),
    prisma.archetypeStat.count(),
    prisma.matchupStat.count(),
  ]);
  const boarded = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "Deck" WHERE mainboard <> '[]'::jsonb`,
  );
  const size = await prisma.$queryRawUnsafe<{ pretty: string }[]>(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty`,
  );
  const tables = await prisma.$queryRawUnsafe<{ name: string; size: string }[]>(
    `SELECT relname AS name, pg_size_pretty(pg_total_relation_size(relid)) AS size
     FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`,
  );
  console.log({ tournaments, decks, matches, cards, archetypeStats, matchupStats });
  console.log("decks WITH decklists:", Number(boarded[0].n), "/", decks);
  console.log("total db size:", size[0].pretty);
  console.log("per-table:", tables);
  await prisma.$disconnect();
}

main();
