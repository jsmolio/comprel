-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL,
    "uri" TEXT,
    "hasPairings" BOOLEAN NOT NULL DEFAULT false,
    "deckCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "player" TEXT NOT NULL,
    "result" TEXT,
    "rank" INTEGER,
    "anchorUri" TEXT,
    "archetype" TEXT,
    "colorId" TEXT,
    "colorName" TEXT,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "mainboard" JSONB NOT NULL,
    "sideboard" JSONB NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "roundName" TEXT,
    "player1" TEXT NOT NULL,
    "player2" TEXT NOT NULL,
    "p1GameWins" INTEGER NOT NULL DEFAULT 0,
    "p2GameWins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "winner" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "name" TEXT NOT NULL,
    "scryfallId" TEXT,
    "imageUrl" TEXT,
    "artCrop" TEXT,
    "manaCost" TEXT,
    "cmc" DOUBLE PRECISION,
    "typeLine" TEXT,
    "colors" TEXT,
    "oracleText" TEXT,
    "rarity" TEXT,
    "setCode" TEXT,
    "priceUsd" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ArchetypeStat" (
    "id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "colorName" TEXT,
    "deckCount" INTEGER NOT NULL,
    "metaShare" DOUBLE PRECISION NOT NULL,
    "matchWins" INTEGER NOT NULL,
    "matchLosses" INTEGER NOT NULL,
    "matchDraws" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchetypeStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupStat" (
    "id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "archetypeA" TEXT NOT NULL,
    "archetypeB" TEXT NOT NULL,
    "matches" INTEGER NOT NULL,
    "winsA" INTEGER NOT NULL,
    "winsB" INTEGER NOT NULL,
    "draws" INTEGER NOT NULL,
    "winRateA" DOUBLE PRECISION NOT NULL,
    "ciLow" DOUBLE PRECISION NOT NULL,
    "ciHigh" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchupStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "thumbnail" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_format_date_idx" ON "Tournament"("format", "date");

-- CreateIndex
CREATE INDEX "Tournament_source_idx" ON "Tournament"("source");

-- CreateIndex
CREATE INDEX "Deck_format_archetype_idx" ON "Deck"("format", "archetype");

-- CreateIndex
CREATE INDEX "Deck_tournamentId_idx" ON "Deck"("tournamentId");

-- CreateIndex
CREATE INDEX "Deck_format_date_idx" ON "Deck"("format", "date");

-- CreateIndex
CREATE INDEX "Match_tournamentId_idx" ON "Match"("tournamentId");

-- CreateIndex
CREATE INDEX "Match_format_date_idx" ON "Match"("format", "date");

-- CreateIndex
CREATE INDEX "ArchetypeStat_format_windowDays_source_idx" ON "ArchetypeStat"("format", "windowDays", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ArchetypeStat_format_windowDays_source_archetype_key" ON "ArchetypeStat"("format", "windowDays", "source", "archetype");

-- CreateIndex
CREATE INDEX "MatchupStat_format_windowDays_source_archetypeA_idx" ON "MatchupStat"("format", "windowDays", "source", "archetypeA");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupStat_format_windowDays_source_archetypeA_archetypeB_key" ON "MatchupStat"("format", "windowDays", "source", "archetypeA", "archetypeB");

-- CreateIndex
CREATE INDEX "Video_format_archetype_idx" ON "Video"("format", "archetype");

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

