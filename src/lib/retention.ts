import { prisma } from "./db";

export interface PruneOptions {
  /** Keep the N most-recent boarded decks per (format, archetype); blank the rest. */
  boardsPerArchetype?: number;
  /** Legacy: blank decklists for decks older than this many days (used if boardsPerArchetype is unset). */
  keepBoardsDays?: number;
  /** Delete tournaments (and their decks/matches) older than this many days. */
  retentionDays?: number;
  log?: (m: string) => void;
}

/**
 * Keeps the database bounded so it fits a fixed storage budget over time:
 *  - retention: drop tournaments past the window entirely (cascades to decks/matches)
 *  - slim boards: keep card lists only for a bounded set of decks
 * Aggregation never reads the card lists, so blanking them does NOT change meta
 * share / win rates — those decks still count via their stored archetype + record.
 *
 * The default board policy keeps the N most-recent decklists PER archetype (an even
 * spread across the metagame) rather than "everything in the last X days", so even a
 * fringe archetype that hasn't appeared recently still shows representative lists.
 */
export async function pruneOldData(opts: PruneOptions): Promise<void> {
  const log = opts.log ?? (() => {});

  if (opts.retentionDays) {
    const cutoff = new Date(Date.now() - opts.retentionDays * 86_400_000);
    const r = await prisma.tournament.deleteMany({ where: { date: { lt: cutoff } } });
    log(`  retention: deleted ${r.count} tournaments older than ${opts.retentionDays}d`);
  }

  if (opts.boardsPerArchetype) {
    // Blank every boarded deck beyond the N most-recent per (format, archetype).
    const blanked = await prisma.$executeRawUnsafe(
      `WITH ranked AS (
         SELECT id, row_number() OVER (PARTITION BY format, archetype ORDER BY date DESC, id) AS rn
         FROM "Deck"
         WHERE archetype IS NOT NULL AND mainboard <> '[]'::jsonb
       )
       UPDATE "Deck" d SET mainboard = '[]'::jsonb, sideboard = '[]'::jsonb
       FROM ranked r
       WHERE d.id = r.id AND r.rn > $1`,
      opts.boardsPerArchetype,
    );
    log(`  slim boards: kept ${opts.boardsPerArchetype} most-recent decklists per archetype; blanked ${blanked} others`);
  } else if (opts.keepBoardsDays) {
    const cutoff = new Date(Date.now() - opts.keepBoardsDays * 86_400_000);
    const blanked = await prisma.$executeRawUnsafe(
      `UPDATE "Deck" SET mainboard = '[]'::jsonb, sideboard = '[]'::jsonb WHERE date < $1 AND mainboard <> '[]'::jsonb`,
      cutoff,
    );
    log(`  slim boards: blanked decklists on ${blanked} decks older than ${opts.keepBoardsDays}d`);
  }
}
