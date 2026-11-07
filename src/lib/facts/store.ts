import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { historyCutoffMs } from "./horizon";
import { anchorMs, eventTime } from "./compute";
import type { FactEvent, FactExtras, PlayerBoard, Snapshot, SnapshotBody } from "./types";
import type { Format } from "../types";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

interface IndexEntry {
  date: string;
  format: Format;
  source: string;
  file: string;
  classifierVersion: string;
}

interface IndexFile {
  schemaVersion: 1;
  events: Record<string, IndexEntry>;
}

function emptyExtras(): FactExtras {
  return { schemaVersion: 1, videos: [], banEvents: [], banSnapshot: {} };
}

export class FactStore {
  readonly factDir: string;
  readonly snapshotFile: string;
  private readonly indexes = new Map<string, IndexFile>();

  constructor(readonly root: string) {
    this.factDir = path.join(root, "data", "facts", "v1");
    this.snapshotFile = path.join(root, "data", "published", "snapshot.json");
  }

  private shardOf(id: string): string {
    return createHash("sha256").update(id).digest("hex").slice(0, 2);
  }

  private eventFile(id: string): string {
    const hash = createHash("sha256").update(id).digest("hex");
    const safe = id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
    return path.join("events", hash.slice(0, 2), `${safe}__${hash.slice(0, 12)}.json`);
  }

  private indexPath(shard: string): string {
    return path.join(this.factDir, "index", `${shard}.json`);
  }

  private loadIndex(shard: string): IndexFile {
    const cached = this.indexes.get(shard);
    if (cached) return cached;
    const file = this.indexPath(shard);
    const index: IndexFile = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as IndexFile)
      : { schemaVersion: 1, events: {} };
    if (!index.events) index.events = {};
    this.indexes.set(shard, index);
    return index;
  }

  private saveIndex(shard: string) {
    const index = this.loadIndex(shard);
    const file = this.indexPath(shard);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, stableStringify(index));
    fs.renameSync(tmp, file);
  }

  /** Insert or replace one event. Unchanged content does not rewrite the file. */
  putEvent(event: FactEvent): { changed: boolean } {
    const shard = this.shardOf(event.id);
    const index = this.loadIndex(shard);
    const rel = this.eventFile(event.id);
    const abs = path.join(this.factDir, rel);
    const body = `${stableStringify(event)}\n`;
    const previous = index.events[event.id];
    if (previous && previous.file !== rel && fs.existsSync(path.join(this.factDir, previous.file))) {
      fs.unlinkSync(path.join(this.factDir, previous.file));
    }
    const same =
      previous?.file === rel &&
      previous.classifierVersion === event.classifierVersion &&
      fs.existsSync(abs) &&
      fs.readFileSync(abs, "utf8") === body;
    if (same) return { changed: false };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, abs);
    index.events[event.id] = {
      date: event.date,
      format: event.format,
      source: event.source,
      file: rel,
      classifierVersion: event.classifierVersion,
    };
    this.saveIndex(shard);
    return { changed: true };
  }

  readEvent(id: string): FactEvent | null {
    const entry = this.loadIndex(this.shardOf(id)).events[id];
    if (!entry) return null;
    const abs = path.join(this.factDir, entry.file);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, "utf8")) as FactEvent;
  }

  allEvents(): FactEvent[] {
    const events: FactEvent[] = [];
    const indexDir = path.join(this.factDir, "index");
    if (!fs.existsSync(indexDir)) return events;
    for (const name of fs.readdirSync(indexDir)) {
      if (!name.endsWith(".json")) continue;
      const shard = name.slice(0, 2);
      const index = this.loadIndex(shard);
      for (const entry of Object.values(index.events)) {
        const abs = path.join(this.factDir, entry.file);
        if (fs.existsSync(abs)) events.push(JSON.parse(fs.readFileSync(abs, "utf8")) as FactEvent);
      }
    }
    return events;
  }

  /**
   * Drop events older than each format's history cutoff. The cutoff is the
   * anchor minus 730 days minus slack, so the previous 365-day trend window
   * stays complete. Formats with no decks are left alone.
   */
  pruneToHorizon(events: FactEvent[]): { deleted: string[] } {
    const byFormat = new Map<Format, FactEvent[]>();
    for (const event of events) {
      const list = byFormat.get(event.format);
      if (list) list.push(event);
      else byFormat.set(event.format, [event]);
    }
    const cutoff = new Map<Format, number>();
    for (const [format, list] of byFormat) {
      const anchor = anchorMs(list);
      if (anchor != null) cutoff.set(format, historyCutoffMs(anchor));
    }
    const deleted: string[] = [];
    for (const event of events) {
      const limit = cutoff.get(event.format);
      if (limit == null || eventTime(event) >= limit) continue;
      const shard = this.shardOf(event.id);
      const index = this.loadIndex(shard);
      const entry = index.events[event.id];
      if (entry) {
        const abs = path.join(this.factDir, entry.file);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        delete index.events[event.id];
        this.saveIndex(shard);
      }
      const board = this.boardPath(event.id);
      if (fs.existsSync(board)) fs.unlinkSync(board);
      deleted.push(event.id);
    }
    return { deleted };
  }

  private boardPath(id: string): string {
    const hash = createHash("sha256").update(id).digest("hex");
    return path.join(this.factDir, "boards", hash.slice(0, 2), `${hash.slice(0, 16)}.json`);
  }

  readBoards(id: string): Record<string, PlayerBoard> | null {
    const file = this.boardPath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, PlayerBoard>;
  }

  writeBoards(id: string, boards: Record<string, PlayerBoard>) {
    const file = this.boardPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = `${stableStringify(boards)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }

  /** Remove board files for events that are no longer in the keep set. */
  pruneBoards(keepIds: Set<string>) {
    const root = path.join(this.factDir, "boards");
    if (!fs.existsSync(root)) return;
    const keepFiles = new Set([...keepIds].map((id) => this.boardPath(id)));
    for (const shard of fs.readdirSync(root)) {
      const dir = path.join(root, shard);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!keepFiles.has(full)) fs.unlinkSync(full);
      }
    }
  }

  extrasFile(): string {
    return path.join(this.factDir, "extras.json");
  }

  readExtras(): FactExtras {
    const file = this.extrasFile();
    if (!fs.existsSync(file)) return emptyExtras();
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FactExtras;
    return {
      schemaVersion: 1,
      videos: parsed.videos ?? [],
      videoRefreshedOn: parsed.videoRefreshedOn ?? {},
      videoAttemptedOn: parsed.videoAttemptedOn ?? {},
      boardEmptyOn: parsed.boardEmptyOn ?? {},
      banEvents: parsed.banEvents ?? [],
      banSnapshot: parsed.banSnapshot ?? {},
    };
  }

  writeExtras(extras: FactExtras) {
    const file = this.extrasFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = `${stableStringify(extras)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }

  readSnapshot(): Snapshot | null {
    if (!fs.existsSync(this.snapshotFile)) return null;
    return JSON.parse(fs.readFileSync(this.snapshotFile, "utf8")) as Snapshot;
  }

  /**
   * Rename into place only after the full document is on disk.
   * `beforeRename` lets tests simulate a crash. A throw leaves the previous snapshot.
   */
  writeSnapshot(body: SnapshotBody, publishedAt: string, opts?: { beforeRename?: () => void }): { changed: boolean } {
    const next: Snapshot = { ...body, publishedAt };
    const previous = this.readSnapshot();
    if (previous && stableStringify(stripPublishedAt(previous)) === stableStringify(body)) {
      return { changed: false };
    }
    fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true });
    const tmp = `${this.snapshotFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${stableStringify(next)}\n`);
    try {
      opts?.beforeRename?.();
      fs.renameSync(tmp, this.snapshotFile);
    } catch (error) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      throw error;
    }
    return { changed: true };
  }
}

function stripPublishedAt(snapshot: Snapshot): SnapshotBody {
  const body: SnapshotBody = {
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
    classifierVersion: snapshot.classifierVersion,
    eventCount: snapshot.eventCount,
    formats: snapshot.formats,
    cards: snapshot.cards,
    videos: snapshot.videos,
    banEvents: snapshot.banEvents,
  };
  if (snapshot.videosState) body.videosState = snapshot.videosState;
  if (snapshot.coverage) body.coverage = snapshot.coverage;
  return body;
}

const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export function withPublishLock<T>(store: FactStore, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(store.factDir, ".lock");
  fs.mkdirSync(store.factDir, { recursive: true });
  if (fs.existsSync(lock)) {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age < LOCK_STALE_MS) {
      throw new Error(`Another publish holds ${lock}. The scheduled workflow runs one at a time.`);
    }
  }
  fs.writeFileSync(lock, String(process.pid));
  return fn().finally(() => {
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  });
}
