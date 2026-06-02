// Enrich all referenced cards from Scryfall (images, oracle text, prices).
//   pnpm tsx scripts/enrich.ts
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { enrichCardsFromDb } from "../src/lib/sources/scryfall";
import { prisma } from "../src/lib/db";

enrichCardsFromDb((m) => console.log(m))
  .then(async (n) => {
    console.log(`✓ enriched ${n} cards`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
