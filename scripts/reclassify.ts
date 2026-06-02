// Re-run archetype classification over all stored decks (after rule/classifier
// changes), then recompute aggregates. No network fetching.
//   pnpm tsx scripts/reclassify.ts
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

import { classify } from "../src/lib/archetype/classify";
import { computeAllAggregates } from "../src/lib/analytics/aggregate";
import { prisma } from "../src/lib/db";
import type { BoardCard } from "../src/lib/types";

async function main() {
  const decks = await prisma.deck.findMany({
    select: { id: true, format: true, mainboard: true, sideboard: true },
  });
  console.log(`Re-classifying ${decks.length} decks…`);

  const BATCH = 500;
  let pending: ReturnType<typeof prisma.deck.update>[] = [];
  let done = 0;
  for (const d of decks) {
    const cls = classify(
      d.format,
      d.mainboard as unknown as BoardCard[],
      d.sideboard as unknown as BoardCard[],
    );
    pending.push(
      prisma.deck.update({
        where: { id: d.id },
        data: { archetype: cls.archetype, colorId: cls.colorId, colorName: cls.colorName },
      }),
    );
    if (pending.length >= BATCH) {
      await prisma.$transaction(pending);
      done += pending.length;
      pending = [];
      process.stdout.write(`\r  ${done}/${decks.length}`);
    }
  }
  if (pending.length) {
    await prisma.$transaction(pending);
    done += pending.length;
  }
  console.log(`\r  ${done}/${decks.length} reclassified`);

  console.log("Recomputing aggregates…");
  await computeAllAggregates((m) => console.log(m));
  await prisma.$disconnect();
  console.log("✓ Done.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
