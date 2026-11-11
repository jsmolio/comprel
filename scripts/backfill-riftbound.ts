// Incremental BoundRift ingest. Raw events, standings, matches, and a capped
// set of decklists. Shares and win rates are computed here. A failure of one
// event does not block the snapshot; the event list being down does.
import fs from "node:fs";
import path from "node:path";
import { historyCutoffMs } from "../src/lib/facts/horizon";
import { anchorMs } from "../src/lib/facts/compute";
import { refreshVideoState, videoHorizonStart } from "../src/lib/facts/videos";
import { withPublishLock } from "../src/lib/facts/store";
import { searchYoutube } from "../src/lib/sources/youtube-search";
import { namesInLists, buildRiftboundSnapshot } from "../src/lib/riftbound/aggregate";
import { indexCatalog, legendColorFor, stubsFor } from "../src/lib/riftbound/cards";
import { loadEraFile } from "../src/lib/riftbound/eras";
import { fetchJsonPolite, type PoliteResult } from "../src/lib/riftbound/http";
import { chooseDeckPlayers, normalizeEvent, parseStandings, playRoundIds } from "../src/lib/riftbound/normalize";
import { decideRiftboundPublish } from "../src/lib/riftbound/publish-policy";
import { normalizeListed, selectIngestEvents, type ListedEvent } from "../src/lib/riftbound/select";
import { RiftboundStore } from "../src/lib/riftbound/store";
import { RIFTBOUND_VIDEO_FORMAT, type RiftboundCoverage, type RiftboundSnapshotBody } from "../src/lib/riftbound/types";

const API = "https://boundrift.com/api";
const OPENRIFT = "https://openrift.app/api/v1";

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

interface Budget {
  requests: number;
  max: number;
  deadline: number;
}

function overBudget(budget: Budget): boolean {
  return budget.requests >= budget.max || Date.now() >= budget.deadline;
}

export async function publishRiftbound(argv = process.argv.slice(2)): Promise<number> {
  const args = new Set(argv.map((arg) => arg.split("=")[0]));
  const incremental = args.has("--incremental");
  const days = Number(flagValue(argv, "days")) || 90;
  const maxRequests = Number(flagValue(argv, "max-requests")) || (incremental ? 400 : 2000);
  const budgetMs = Number(flagValue(argv, "budget-ms")) || (incremental ? 8 * 60_000 : 15 * 60_000);
  const skirmishSample = Number(flagValue(argv, "skirmish-sample")) || 16;
  const decksPerEvent = Number(flagValue(argv, "decks-per-event")) || 24;
  const noCards = args.has("--no-cards");
  const publishOnly = args.has("--publish-only");
  const root = flagValue(argv, "out") || process.cwd();
  const store = new RiftboundStore(root);
  const log = (message: string) => console.log(message);
  const eraFile = loadEraFile(root);
  const budget: Budget = { requests: 0, max: maxRequests, deadline: Date.now() + budgetMs };
  let chain = Promise.resolve();

  const paced = (url: string, etag?: string | null): Promise<PoliteResult | { ok: false; kind: "budget"; status: null }> => {
    const run = chain.then(async () => {
      if (overBudget(budget)) return { ok: false as const, kind: "budget" as const, status: null };
      budget.requests += 1;
      const result = await fetchJsonPolite(url, { etag });
      await new Promise((resolve) => setTimeout(resolve, 120));
      return result;
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return withPublishLock(store, async () => {
    if (publishOnly) {
      log("→ Riftbound: republishing from stored facts…");
      const code = await republish(store, root, log, eraFile);
      return code;
    }

    log(`→ Riftbound: listing events (budget ${maxRequests} requests / ${Math.round(budgetMs / 1000)}s)…`);
    const listed = await paced(`${API}/events`);
    if (!listed.ok || listed.status !== 200 || !Array.isArray(listed.body)) {
      const why = listed.ok ? `status ${listed.status}` : listed.kind;
      log(`→ Holding previous Riftbound snapshot: event list unavailable (${why}).`);
      return 1;
    }
    const rows = listed.body.map(normalizeListed).filter((row): row is ListedEvent => row != null);
    const regionals = await paced(`${API}/regionals`);
    if (regionals.ok && regionals.status === 200 && typeof regionals.body === "object" && regionals.body) {
      const extra = (regionals.body as { regionals?: unknown[] }).regionals ?? [];
      const seen = new Set(rows.map((row) => row.id));
      for (const item of extra) {
        const regional = normalizeListed(item);
        if (!regional || seen.has(regional.id)) continue;
        rows.push({
          ...regional,
          source: regional.source ?? "uvs",
          eventCategory: regional.eventCategory ?? "regional",
          gameplayFormatName: regional.gameplayFormatName ?? "Constructed",
          startingPlayerCount: regional.startingPlayerCount,
        });
      }
    }
    const selected = selectIngestEvents(rows, {
      now: new Date(),
      days,
      minPlayers: eraFile.minPlayers,
      skirmishSample,
    });
    log(`  ${rows.length} listed, ${selected.length} selected (premier/regional plus up to ${skirmishSample} skirmishes)`);

    const skippedNoLegend = new Set<number>();
    let shapeFailures = 0;
    let networkFailures = 0;
    let ingestedThisRun = 0;
    let attemptedFetches = 0;
    const misses: { id: string; reason: string }[] = [];
    const failedIds = new Set<number>();
    const before = store.allEvents().length;

    const catalog = noCards ? null : await loadOpenRift(root, paced, log);
    const legendColor = (legend: string) => legendColorFor(legend, catalog?.legendColors);

    for (const candidate of selected) {
      const id = `boundrift:${candidate.id}`;
      if (store.hasEvent(id)) continue;
      if (overBudget(budget)) break;
      attemptedFetches += 1;
      const result = await fetchOne(candidate.id, paced, decksPerEvent, legendColor, eraFile.minPlayers);
      if (result.ok && result.event.deckCount === 0 && result.event.source !== "playriftbound") {
        skippedNoLegend.add(candidate.id);
        attemptedFetches -= 1;
        continue;
      }
      if (result.ok) {
        store.putEvent(result.event);
        if (Object.keys(result.boards).length) store.writeBoards(result.event.id, result.boards);
        ingestedThisRun += 1;
        log(`  + ${result.event.date.slice(0, 10)} ${result.event.source} ${result.event.name} (${result.event.deckCount} legends, ${result.event.matches.length} matches, ${Object.keys(result.boards).length} lists)`);
        continue;
      }
      if (result.reason === "budget") break;
      if (result.reason === "not constructed" || result.reason === "field too small") {
        attemptedFetches -= 1;
        continue;
      }
      if (result.shape) shapeFailures += 1;
      else networkFailures += 1;
      failedIds.add(candidate.id);
      if (misses.length < 12) misses.push({ id: String(candidate.id), reason: result.reason });
      log(`  ! ${candidate.id} ${result.reason}`);
    }

    const storedIds = new Set(store.allEvents().map((event) => event.boundriftId));
    const unattemptedEvents = selected
      .filter((event) => !storedIds.has(event.id) && !failedIds.has(event.id) && !skippedNoLegend.has(event.id))
      .slice(0, 12)
      .map((event) => ({ id: String(event.id), reason: "budget" }));
    const unattempted = selected.filter(
      (event) => !storedIds.has(event.id) && !failedIds.has(event.id) && !skippedNoLegend.has(event.id),
    ).length;

    let events = store.allEvents();
    const anchor = anchorMs(events);
    if (anchor != null) {
      const cutoff = historyCutoffMs(anchor);
      const kept = [];
      for (const event of events) {
        if (Date.parse(event.date) >= cutoff) kept.push(event);
        else store.deleteEvent(event.id);
      }
      if (kept.length !== events.length) log(`  pruned ${events.length - kept.length} event(s) older than the trend horizon`);
      events = kept;
    }

    const decision = decideRiftboundPublish({
      listingAvailable: true,
      shapeFailures,
      attemptedFetches,
      ingestedThisRun,
      storedEvents: before,
      networkFailures,
    });
    if (!decision.publish) {
      log(`→ Holding previous Riftbound snapshot: ${decision.reason}`);
      return 1;
    }

    const windowStart = Date.now() - days * 86_400_000;
    const inWindow = events.filter((event) => Date.parse(event.date) >= windowStart);
    const playriftbound = inWindow.filter((event) => event.source === "playriftbound");
    const coverage: RiftboundCoverage = {
      complete: networkFailures === 0 && shapeFailures === 0 && unattempted === 0,
      requestedDays: days,
      discovered: selected.length,
      ingested: selected.filter((event) => storedIds.has(event.id)).length,
      failed: networkFailures + shapeFailures,
      unattempted,
      boundrift: networkFailures + shapeFailures + unattempted > 0 ? "partial" : "ok",
      playriftboundEvents: playriftbound.length,
      playriftboundWithoutLists: playriftbound.filter((event) => event.listsAbsent).length,
      skippedNoLegend: skippedNoLegend.size,
    };
    if (misses.length) coverage.misses = misses;
    if (unattemptedEvents.length) coverage.unattemptedEvents = unattemptedEvents;

    const boards = new Map(events.map((event) => [event.id, store.readBoards(event.id) ?? {}]));
    const painted = events.map((event) => ({
      ...event,
      decks: event.decks.map((deck) => ({ ...deck, colorName: legendColor(deck.archetype) ?? deck.colorName })),
    }));
    const previous = store.readSnapshot();
    let body: RiftboundSnapshotBody = buildRiftboundSnapshot(painted, boards, {
      videos: [],
      banEvents: eraFile.bans.map((ban) => ({ date: ban.date, card: ban.card, kind: ban.kind })),
      cards: previous?.cards ?? {},
      eras: eraFile.eras,
    });
    const names = namesInLists(body.lists);
    if (catalog) body = { ...body, cards: { ...previous?.cards, ...stubsFor(names, catalog.byName) } };
    else if (previous?.cards) {
      const kept: RiftboundSnapshotBody["cards"] = {};
      for (const name of names) if (previous.cards[name]) kept[name] = previous.cards[name];
      body.cards = Object.keys(kept).length ? kept : previous.cards;
    }

    const now = new Date();
    let videosState: RiftboundSnapshotBody["videosState"] = process.env.YOUTUBE_API_KEY ? "current" : "no-key";
    try {
      const extras = store.readExtras();
      const top = (body.slices["30:all:all"]?.rows ?? []).slice(0, 6).map((row) => ({
        format: RIFTBOUND_VIDEO_FORMAT,
        archetype: row.archetype,
      }));
      const today = now.toISOString().slice(0, 10);
      const refreshed = await refreshVideoState(
        { videos: extras.videos, refreshedOn: extras.videoRefreshedOn ?? {}, attemptedOn: extras.videoAttemptedOn ?? {} },
        top,
        today,
        Boolean(process.env.YOUTUBE_API_KEY),
        async (target) => {
          try {
            const hits = await searchYoutube(
              target.format,
              target.archetype,
              6,
              videoHorizonStart(today),
              `Riftbound ${target.archetype} gameplay`,
            );
            return { ok: true, videos: hits };
          } catch (error) {
            const quota = /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|\b429\b/.test((error as Error).message);
            log(`  ! videos ${target.archetype}: ${quota ? "quota" : "upstream error"}`);
            return { ok: false, reason: quota ? "quota" : "error" };
          }
        },
      );
      videosState = refreshed.videosState;
      if (refreshed.changed || JSON.stringify(refreshed.attemptedOn) !== JSON.stringify(extras.videoAttemptedOn ?? {})) {
        store.writeExtras({
          schemaVersion: 1,
          videos: refreshed.videos,
          videoRefreshedOn: refreshed.refreshedOn,
          videoAttemptedOn: refreshed.attemptedOn,
        });
      }
      body.videos = refreshed.videos;
      log(`  videos: ${videosState}`);
    } catch (error) {
      videosState = "degraded";
      body.videos = store.readExtras().videos;
      log(`  ! video refresh kept the previous list: ${(error as Error).message}`);
    }
    body.videosState = videosState;
    body.coverage = coverage;

    const written = store.writeSnapshot(body, now.toISOString());
    log(
      written.changed
        ? `  Riftbound snapshot updated (${decision.reason}, ${body.eventCount} events, ${budget.requests} requests)`
        : "  Riftbound snapshot unchanged",
    );
    return 0;
  });
}

function flagValue(argv: string[], name: string): string | undefined {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

type Paced = (url: string, etag?: string | null) => Promise<PoliteResult | { ok: false; kind: "budget"; status: null }>;

async function fetchOne(
  id: number,
  paced: Paced,
  decksPerEvent: number,
  legendColor: (legend: string) => string | null,
  minPlayers: number,
) {
  const detail = await paced(`${API}/events/${id}`);
  if (!detail.ok || detail.status !== 200) {
    return { ok: false as const, shape: !detail.ok && detail.kind === "bad-shape", reason: detail.ok ? "not modified" : detail.kind };
  }
  const standings = await paced(`${API}/events/${id}/standings`);
  if (!standings.ok || standings.status !== 200) {
    return {
      ok: false as const,
      shape: !standings.ok && standings.kind === "bad-shape",
      reason: standings.ok ? "standings not modified" : `standings ${standings.kind}`,
    };
  }
  const detailRecord = detail.body as { rounds?: { id?: number; roundType?: string; status?: string }[]; source?: string };
  const source = typeof detailRecord?.source === "string" ? detailRecord.source : "";
  const matchBodies: unknown[] = [];
  if (source !== "loltcg") {
    const rounds = playRoundIds(detailRecord.rounds).map((roundId) => ({ id: roundId }));
    for (const round of rounds) {
      const matches = await paced(`${API}/events/${id}/matches?round_id=${round.id}`);
      if (!matches.ok || matches.status !== 200) {
        return {
          ok: false as const,
          shape: !matches.ok && matches.kind === "bad-shape",
          reason: matches.ok ? `round ${round.id} not modified` : `round ${round.id} ${matches.kind}`,
        };
      }
      matchBodies.push(matches.body);
    }
  }
  const parsedStandings = parseStandings(standings.body);
  const decks: Record<string, unknown> = {};
  if (parsedStandings.ok && source !== "playriftbound") {
    for (const player of chooseDeckPlayers(parsedStandings.rows, decksPerEvent)) {
      const deck = await paced(`${API}/events/${id}/players/${player}/deck`);
      if (deck.ok && deck.status === 200) decks[player] = deck.body;
    }
  }
  const normalized = normalizeEvent({
    detail: detail.body,
    standings: standings.body,
    matchBodies,
    decks,
    legendColor,
    minPlayers,
  });
  if (!normalized.ok) return { ok: false as const, shape: normalized.shape, reason: normalized.reason };
  return { ok: true as const, event: normalized.event, boards: normalized.boards };
}

async function republish(
  store: RiftboundStore,
  root: string,
  log: (message: string) => void,
  eraFile: ReturnType<typeof loadEraFile>,
): Promise<number> {
  const events = store.allEvents();
  const dir = path.join(root, "data", "cache", "riftbound");
  const catalogBody = readCachedBody(dir, "catalog");
  const pricesBody = readCachedBody(dir, "prices");
  const catalog = catalogBody ? indexCatalog(catalogBody, pricesBody) : null;
  if (catalog) log(`  OpenRift catalog: ${catalog.byName.size} cards, ${catalog.legendColors.size} legends`);
  const legendColor = (legend: string) => legendColorFor(legend, catalog?.legendColors);
  const previous = store.readSnapshot();
  const boards = new Map(events.map((event) => [event.id, store.readBoards(event.id) ?? {}]));
  const painted = events.map((event) => ({
    ...event,
    decks: event.decks.map((deck) => ({ ...deck, colorName: legendColor(deck.archetype) ?? deck.colorName })),
  }));
  let body = buildRiftboundSnapshot(painted, boards, {
    videos: previous?.videos ?? [],
    banEvents: eraFile.bans.map((ban) => ({ date: ban.date, card: ban.card, kind: ban.kind })),
    cards: previous?.cards ?? {},
    eras: eraFile.eras,
  });
  const names = namesInLists(body.lists);
  if (catalog) body = { ...body, cards: stubsFor(names, catalog.byName) };
  body.videosState = previous?.videosState ?? (process.env.YOUTUBE_API_KEY ? "current" : "no-key");
  body.coverage = previous?.coverage;
  const written = store.writeSnapshot(body, new Date().toISOString());
  const colored = body.slices["30:all:all"]?.rows.filter((row) => row.colorName).length ?? 0;
  log(written.changed ? `  Riftbound snapshot republished (${colored} colored legends in the 30-day field)` : "  Riftbound snapshot unchanged");
  return 0;
}

function readCachedBody(dir: string, name: string): unknown | null {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { body?: unknown }).body ?? null;
  } catch {
    return null;
  }
}

async function loadOpenRift(root: string, paced: Paced, log: (message: string) => void) {
  const dir = path.join(root, "data", "cache", "riftbound");
  fs.mkdirSync(dir, { recursive: true });
  const catalog = await cachedJson(dir, "catalog", `${OPENRIFT}/catalog?langs=EN`, paced);
  const prices = await cachedJson(dir, "prices", `${OPENRIFT}/prices`, paced);
  if (!catalog) {
    log("  ! OpenRift catalog unavailable; card images stay on the previous snapshot");
    return null;
  }
  const indexed = indexCatalog(catalog, prices);
  log(`  OpenRift catalog: ${indexed.byName.size} cards, ${indexed.legendColors.size} legends`);
  return indexed;
}

async function cachedJson(dir: string, name: string, url: string, paced: Paced): Promise<unknown | null> {
  const file = path.join(dir, `${name}.json`);
  let etag: string | null = null;
  let previous: unknown = null;
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { etag?: string; body?: unknown };
      etag = saved.etag ?? null;
      previous = saved.body ?? null;
    } catch {
      previous = null;
    }
  }
  const result = await paced(url, etag);
  if (!result.ok) return previous;
  if (result.status === 304) return previous;
  fs.writeFileSync(file, JSON.stringify({ etag: result.etag, body: result.body }));
  return result.body;
}
