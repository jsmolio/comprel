import fs from "node:fs";
import path from "node:path";
import type { Format } from "../types";
import { publishedSegment } from "./doc";
import { loadPublished } from "./load";
import { MAGIC_DIR } from "./magic";
import { RIFTBOUND_DIR } from "./riftbound";
import type { MagicTournamentEventFile, RiftboundTournamentEventFile, TournamentIndexFile } from "../tournaments/types";

export function loadMagicTournamentIndex(format: Format): { available: true; events: TournamentIndexFile["events"] } | { available: false } {
  const slug = format.toLowerCase();
  const file = path.join(MAGIC_DIR, slug, "tournaments", "index.json");
  const label = `data/published/magic/${slug}/tournaments/index.json`;
  if (!fs.existsSync(file)) return { available: false };
  const loaded = loadPublished<TournamentIndexFile>(file, label);
  if (!loaded.ok || !Array.isArray(loaded.snapshot.events)) return { available: false };
  return { available: true, events: loaded.snapshot.events };
}

export function loadMagicTournamentEvent(format: Format, slug: string): MagicTournamentEventFile | null {
  let segment: string;
  try {
    segment = publishedSegment(slug);
  } catch {
    return null;
  }
  const formatSlug = format.toLowerCase();
  const file = path.join(MAGIC_DIR, formatSlug, "tournaments", `${segment}.json`);
  if (!fs.existsSync(file)) return null;
  const loaded = loadPublished<MagicTournamentEventFile>(file, `data/published/magic/${formatSlug}/tournaments/${segment}.json`);
  if (!loaded.ok || loaded.snapshot.slug !== segment || !Array.isArray(loaded.snapshot.finishes)) return null;
  return loaded.snapshot;
}

export function loadRiftboundTournamentIndex(): { available: true; events: TournamentIndexFile["events"] } | { available: false } {
  const file = path.join(RIFTBOUND_DIR, "tournaments", "index.json");
  if (!fs.existsSync(file)) return { available: false };
  const loaded = loadPublished<TournamentIndexFile>(file, "data/published/riftbound/tournaments/index.json");
  if (!loaded.ok || !Array.isArray(loaded.snapshot.events)) return { available: false };
  return { available: true, events: loaded.snapshot.events };
}

export function loadRiftboundTournamentEvent(slug: string): RiftboundTournamentEventFile | null {
  let segment: string;
  try {
    segment = publishedSegment(slug);
  } catch {
    return null;
  }
  const file = path.join(RIFTBOUND_DIR, "tournaments", `${segment}.json`);
  if (!fs.existsSync(file)) return null;
  const loaded = loadPublished<RiftboundTournamentEventFile>(file, `data/published/riftbound/tournaments/${segment}.json`);
  if (!loaded.ok || loaded.snapshot.slug !== segment || !Array.isArray(loaded.snapshot.finishes)) return null;
  return loaded.snapshot;
}
