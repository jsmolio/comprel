import { prisma } from "./db";

export interface PruneOptions {
  /** Blank decklists (mainboard/sideboard) for decks older than this many days. */
  keepBoardsDays?: number;
  /** Delete tournaments (and their decks/matches) older than this many days. */
  retentionDays?: number;
  log?: (m: string) => void;
}

/**
 * Keeps the database bounded so it fits a fixed storage budget over time:
 *  - retention: drop tournaments past the window entirely (cascades to decks/matches)
 *  - slim boards: blank the card lists of decks past the board window
 * Aggregation never reads the card lists, so blanking them does NOT change meta
 * share / win rates — those decks still count via their stored archetype + record.
 */
export async function pruneOldData(opts: PruneOptions): Promise<void> {
  const log = opts.log ?? (() => {});

  if (opts.retentionDays) {
    const cutoff = new Date(Date.now() - opts.retentionDays * 86_400_000);
    const r = await prisma.tournament.deleteMany({ where: { date: { lt: cutoff } } });
    log(`  retention: deleted ${r.count} tournaments older than ${opts.retentionDays}d`);
  }

  if (opts.keepBoardsDays) {
    const cutoff = new Date(Date.now() - opts.keepBoardsDays * 86_400_000);
    const blanked = await prisma.$executeRawUnsafe(
      `UPDATE "Deck" SET mainboard = '[]'::jsonb, sideboard = '[]'::jsonb WHERE date < $1 AND mainboard <> '[]'::jsonb`,
      cutoff,
    );
    log(`  slim boards: blanked decklists on ${blanked} decks older than ${opts.keepBoardsDays}d`);
  }
}
