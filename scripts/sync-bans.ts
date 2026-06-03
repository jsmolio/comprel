// Detect Banned & Restricted changes from Scryfall and record them. Safe to re-run.
//   pnpm sync-bans
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { syncBanlist } from "../src/lib/sources/banlist-sync";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("→ Syncing B&R changes from Scryfall…");
  const { detected } = await syncBanlist((m) => console.log(m));
  console.log(`✓ ${detected} B&R change(s) recorded`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
