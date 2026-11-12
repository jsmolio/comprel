import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { commitSnapshotTree, stableStringify } from "../facts/store";
import { readRiftboundSnapshot, riftboundBody, riftboundPartFiles, riftboundPublishedDir } from "../published/riftbound";
import type { RiftboundBoard, RiftboundFactEvent, RiftboundSnapshot, RiftboundSnapshotBody } from "./types";

export interface RiftboundExtras {
  schemaVersion: 1;
  videos: RiftboundSnapshotBody["videos"];
  videoRefreshedOn?: Record<string, string>;
  videoAttemptedOn?: Record<string, string>;
}

function emptyExtras(): RiftboundExtras {
  return { schemaVersion: 1, videos: [] };
}

export class RiftboundStore {
  readonly factDir: string;
  readonly snapshotFile: string;

  constructor(readonly root: string) {
    this.factDir = path.join(root, "data", "facts", "riftbound", "v1");
    this.snapshotFile = path.join(riftboundPublishedDir(root), "index.json");
  }

  private eventFile(id: string): string {
    const hash = createHash("sha256").update(id).digest("hex");
    const safe = id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
    return path.join(this.factDir, "events", hash.slice(0, 2), `${safe}__${hash.slice(0, 12)}.json`);
  }

  private boardFile(id: string): string {
    const hash = createHash("sha256").update(id).digest("hex");
    return path.join(this.factDir, "boards", hash.slice(0, 2), `${hash.slice(0, 16)}.json`);
  }

  hasEvent(id: string): boolean {
    return fs.existsSync(this.eventFile(id));
  }

  readEvent(id: string): RiftboundFactEvent | null {
    const file = this.eventFile(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as RiftboundFactEvent;
  }

  deleteEvent(id: string) {
    const eventFile = this.eventFile(id);
    const boardFile = this.boardFile(id);
    if (fs.existsSync(eventFile)) fs.unlinkSync(eventFile);
    if (fs.existsSync(boardFile)) fs.unlinkSync(boardFile);
  }

  putEvent(event: RiftboundFactEvent): { changed: boolean } {
    const file = this.eventFile(event.id);
    const body = `${stableStringify(event)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return { changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
    return { changed: true };
  }

  allEvents(): RiftboundFactEvent[] {
    const root = path.join(this.factDir, "events");
    if (!fs.existsSync(root)) return [];
    const events: RiftboundFactEvent[] = [];
    for (const shard of fs.readdirSync(root)) {
      const dir = path.join(root, shard);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        events.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as RiftboundFactEvent);
      }
    }
    return events;
  }

  readBoards(id: string): Record<string, RiftboundBoard> | null {
    const file = this.boardFile(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, RiftboundBoard>;
  }

  writeBoards(id: string, boards: Record<string, RiftboundBoard>) {
    const file = this.boardFile(id);
    const body = `${stableStringify(boards)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }

  extrasFile(): string {
    return path.join(this.factDir, "extras.json");
  }

  readExtras(): RiftboundExtras {
    const file = this.extrasFile();
    if (!fs.existsSync(file)) return emptyExtras();
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RiftboundExtras;
    return { schemaVersion: 1, videos: parsed.videos ?? [], videoRefreshedOn: parsed.videoRefreshedOn, videoAttemptedOn: parsed.videoAttemptedOn };
  }

  writeExtras(extras: RiftboundExtras) {
    const file = this.extrasFile();
    const body = `${stableStringify(extras)}\n`;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }

  readSnapshot(): RiftboundSnapshot | null {
    return readRiftboundSnapshot(riftboundPublishedDir(this.root));
  }

  writeSnapshot(body: RiftboundSnapshotBody, publishedAt: string, opts?: { beforeRename?: () => void }): { changed: boolean } {
    const previous = this.readSnapshot();
    if (previous && stableStringify(riftboundBody(previous)) === stableStringify(body)) return { changed: false };
    return commitSnapshotTree(riftboundPublishedDir(this.root), riftboundPartFiles({ ...body, publishedAt }), opts);
  }
}
