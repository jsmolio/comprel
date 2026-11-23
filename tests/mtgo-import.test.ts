import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { decidePublish } from "../src/lib/facts/publish-policy";
import { renderIngestDiagnostic } from "../src/lib/ingest-summary";
import { assessMtgoImport, diagnoseMtgoHtml, importMtgo, listingEmptyPersisted, mtgoEventUrl, prioritizeMtgoSlugs, type MtgoFetchInit, type MtgoPageFetch } from "../src/lib/sources/mtgo";
import type { RawCacheItem } from "../src/lib/types";

const day = new Date().toISOString().slice(0, 10);

function indexHtml(slugs: string[]): string {
  return slugs.map((slug) => `<a href="/decklist/${slug}">event</a>`).join("");
}

function page(data: unknown): string {
  return `<script>window.MTGO.decklists.data = ${JSON.stringify(data)};</script>`;
}

test("empty decklists are distinguished from a page that does not parse", () => {
  assert.equal(diagnoseMtgoHtml("<html>no data</html>").ok, false);
  assert.equal(diagnoseMtgoHtml(page({ name: "League" })).ok, false);
  if (!diagnoseMtgoHtml(page({ name: "League" })).ok) {
    assert.equal((diagnoseMtgoHtml(page({ name: "League" })) as { reason: string }).reason, "empty-decklists");
  }
  assert.equal(diagnoseMtgoHtml(page({ decklists: [] })).ok, false);
  const good = diagnoseMtgoHtml(
    page({ decklists: [{ player: "A", loginid: "1", main_deck: [{ qty: "4", card_attributes: { card_name: "Lightning Bolt" } }] }] }),
  );
  assert.equal(good.ok, true);
});

test("per-event misses log the public URL and reason without becoming structural", async () => {
  const good = `modern-league-${day}11161`;
  const empty = `pioneer-league-${day}11137`;
  const down = `legacy-league-${day}11169`;
  const lines: string[] = [];
  const imported: string[] = [];
  const result = await importMtgo({
    days: 4,
    log: (line) => lines.push(line),
    onItem: (_item, slug) => {
      imported.push(slug);
    },
    sleep: async () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([good, empty, down]) };
      if (url.endsWith(good)) {
        return {
          kind: "ok",
          status: 200,
          html: page({
            description: "Modern League",
            starttime: `${day} 00:00:00`,
            decklists: [{ player: "Ada", loginid: "1", main_deck: [{ qty: "4", card_attributes: { card_name: "Lightning Bolt" } }], sideboard_deck: [] }],
          }),
        };
      }
      if (url.endsWith(empty)) return { kind: "ok", status: 200, html: page({ name: "Pioneer League", publish_date: day }) };
      return { kind: "timeout" };
    },
  });
  assert.equal(result.structuralFailure, false);
  assert.equal(result.events, 1);
  assert.deepEqual(imported, [good]);
  assert.equal(result.misses.length, 2);
  assert.deepEqual(
    result.misses.map((miss) => `${miss.reason} ${miss.url}`),
    [`timeout ${mtgoEventUrl(down)}`, `empty-decklists ${mtgoEventUrl(empty)}`],
  );
  assert.ok(lines.some((line) => line.includes(mtgoEventUrl(empty)) && line.includes("empty-decklists")));
  assert.ok(lines.some((line) => line.includes(mtgoEventUrl(down)) && line.includes("timeout")));
  assert.ok(lines.some((line) => line.includes("missed 2")));
  assert.equal(result.unattempted.length, 0);
  assert.equal(result.structuralFailure, false);
});

test("same-day unseen events are fetched before older stored ones, and lists are not requested", () => {
  const today = "2026-11-11";
  const ordered = prioritizeMtgoSlugs(
    [
      "legacy-league-2026-11-09-1",
      `modern-challenge-${today}2`,
      `pioneer-league-${today}3`,
      "vintage-league-2026-11-10-4",
      `standard-league-${today}5`,
    ],
    (slug) => {
      if (slug.startsWith("pioneer")) return "lists";
      if (slug.startsWith("legacy")) return "empty";
      if (slug.startsWith("standard")) return "empty";
      return "absent";
    },
    today,
  );
  assert.deepEqual(ordered.skippedStored, [`pioneer-league-${today}3`]);
  assert.deepEqual(ordered.queue, [
    `modern-challenge-${today}2`,
    `standard-league-${today}5`,
    "vintage-league-2026-11-10-4",
    "legacy-league-2026-11-09-1",
  ]);
});

test("a stored list is not fetched, and the budget reports the rest as unattempted", async () => {
  const today = "2026-11-11";
  const stored = `modern-league-${today}10001`;
  const fresh = `modern-challenge-${today}10002`;
  const older = "legacy-league-2026-11-09-10003";
  let now = Date.parse(`${today}T12:00:00Z`);
  const fetched: string[] = [];
  const lines: string[] = [];
  const result = await importMtgo({
    days: 4,
    today,
    budgetMs: 1,
    now: () => now,
    sleep: async () => {},
    log: (line) => lines.push(line),
    known: (slug) => (slug === stored ? "lists" : "absent"),
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([stored, older, fresh]) };
      fetched.push(url);
      now += 10_000;
      return {
        kind: "ok",
        status: 200,
        html: page({
          description: "Event",
          starttime: `${today} 00:00:00`,
          decklists: [{ player: "Ada", loginid: "1", main_deck: [{ qty: "4", card_attributes: { card_name: "Lightning Bolt" } }] }],
        }),
      };
    },
  });
  assert.deepEqual(fetched, [mtgoEventUrl(fresh)]);
  assert.equal(result.skippedStored, 1);
  assert.equal(result.events, 1);
  assert.equal(result.errors, 0);
  assert.deepEqual(
    result.unattempted.map((item) => `${item.reason} ${item.url}`),
    [`budget ${mtgoEventUrl(older)}`],
  );
  assert.equal(result.structuralFailure, false);
  assert.ok(lines.some((line) => line.includes(mtgoEventUrl(older)) && line.includes("unattempted budget")));
  assert.ok(lines.some((line) => line.includes("unattempted 1")));
});

test("a 200 without embedded decklists is retried, and an empty list is not", async () => {
  const today = "2026-11-11";
  const late = `modern-league-${today}20001`;
  const empty = `pioneer-league-${today}20002`;
  const calls = new Map<string, number>();
  const now = Date.parse(`${today}T12:00:00Z`);
  const result = await importMtgo({
    days: 4,
    today,
    now: () => now,
    sleep: async () => {},
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([late, empty]) };
      calls.set(url, (calls.get(url) ?? 0) + 1);
      if (url.endsWith(late) && calls.get(url) === 1) return { kind: "ok", status: 200, html: "<html>not ready</html>" };
      if (url.endsWith(late)) {
        return {
          kind: "ok",
          status: 200,
          html: page({
            starttime: `${today} 00:00:00`,
            decklists: [{ player: "Bea", loginid: "2", main_deck: [{ qty: "1", card_attributes: { card_name: "Island" } }] }],
          }),
        };
      }
      return { kind: "ok", status: 200, html: page({ decklists: [] }) };
    },
  });
  assert.equal(calls.get(mtgoEventUrl(late)), 2);
  assert.equal(calls.get(mtgoEventUrl(empty)), 1);
  assert.equal(result.events, 1);
  assert.deepEqual(
    result.misses.map((miss) => miss.reason),
    ["empty-decklists"],
  );
  assert.equal(result.structuralFailure, false);
});

test("the listing is retried before the cycle is skipped, and a 404 is not", async () => {
  const lines: string[] = [];
  let indexTries = 0;
  const gaveUp = await importMtgo({
    log: (line) => lines.push(line),
    sleep: async () => {},
    fetchPage: async () => {
      indexTries++;
      return { kind: "timeout" };
    },
  });
  assert.equal(indexTries, 3);
  assert.equal(gaveUp.indexOk, false);
  assert.equal(gaveUp.structuralFailure, false);
  assert.ok(lines.some((line) => line.includes("attempt 1 failed") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("unreachable after 3 attempts")));

  let listing = 0;
  const moved = await importMtgo({
    sleep: async () => {},
    fetchPage: async () => {
      listing++;
      return { kind: "http", status: 404 };
    },
  });
  assert.equal(listing, 1);
  assert.equal(moved.structuralFailure, true);
});

test("an unreachable listing is partial, a fetched listing is ok, and a structural failure stays unavailable", async () => {
  const today = "2026-11-17";
  const slug = `modern-league-${today}10001`;
  const unreachable = assessMtgoImport(
    await importMtgo({
      sleep: async () => {},
      fetchPage: async () => ({ kind: "network", detail: "fetch failed" }),
    }),
  );
  assert.equal(unreachable.mtgo, "partial");
  assert.equal(unreachable.mtgoMissed, 1);
  assert.equal(unreachable.mtgoUnattempted, 0);
  assert.deepEqual(unreachable.mtgoMisses, [
    { slug: "listing", url: "https://www.mtgo.com/decklists", reason: "listing-unreachable" },
  ]);
  assert.deepEqual(unreachable.diagnosticMisses, [
    { ref: "https://www.mtgo.com/decklists", reason: "listing-unreachable", detail: "fetch failed" },
  ]);
  const summary = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish allowed. cache complete. MTGO ${unreachable.mtgo}.`,
    sections: [{ title: "Missed events", events: unreachable.diagnosticMisses }],
  });
  assert.match(summary, /MTGO partial\./);
  assert.match(summary, /Count: 1 \(listing-unreachable 1\)/);
  assert.match(summary, /https:\/\/www\.mtgo\.com\/decklists — listing-unreachable \(fetch failed\)/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: unreachable.mtgo, allowIncompleteMtgo: false }).publish, true);

  const ok = assessMtgoImport(
    await importMtgo({
      days: 4,
      today,
      now: () => Date.parse(`${today}T12:00:00Z`),
      sleep: async () => {},
      onItem: () => {},
      fetchPage: async (url): Promise<MtgoPageFetch> => {
        if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([slug]) };
        return {
          kind: "ok",
          status: 200,
          html: page({
            starttime: `${today} 00:00:00`,
            decklists: [{ player: "Ada", loginid: "1", main_deck: [{ qty: "1", card_attributes: { card_name: "Island" } }] }],
          }),
        };
      },
    }),
  );
  assert.equal(ok.mtgo, "ok");
  assert.equal(ok.mtgoMissed, 0);
  assert.equal(ok.mtgoMisses, undefined);
  assert.deepEqual(ok.diagnosticMisses, []);
  const okSummary = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish allowed. cache complete. MTGO ${ok.mtgo}.`,
    sections: [{ title: "Missed events", events: ok.diagnosticMisses }],
  });
  assert.match(okSummary, /MTGO ok\./);
  assert.match(okSummary, /Count: 0/);
  assert.doesNotMatch(okSummary, /listing-unreachable/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: ok.mtgo, allowIncompleteMtgo: false }).publish, true);

  const structural = assessMtgoImport(
    await importMtgo({
      sleep: async () => {},
      fetchPage: async () => ({ kind: "http", status: 404 }),
    }),
  );
  assert.equal(structural.mtgo, "unavailable");
  assert.equal(structural.mtgoMissed, 0);
  assert.equal(structural.mtgoMisses, undefined);
  assert.deepEqual(structural.diagnosticMisses, []);
  const held = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish held. MTGO scrape failed structurally; previous snapshot kept. MTGO ${structural.mtgo}.`,
    sections: [{ title: "Missed events", events: structural.diagnosticMisses }],
  });
  assert.match(held, /MTGO unavailable\./);
  assert.doesNotMatch(held, /listing-unreachable/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: structural.mtgo, allowIncompleteMtgo: false }).publish, false);

  const backfill = fs.readFileSync("scripts/backfill.ts", "utf8");
  assert.match(backfill, /assessMtgoImport\(scraped\)/);
  assert.match(backfill, /events: mtgoDiagnosticMisses/);
  assert.match(backfill, /path\.join\(root, "data", "published", "magic", "index\.json"\)/);
  assert.match(backfill, /priorEmptyListings: listingEmptyPersisted\(publishedMtgoMisses\(root\)\) \? 1 : 0/);
  const magic = fs.readFileSync("src/app/magic/page.tsx", "utf8");
  assert.doesNotMatch(magic, /listing-unreachable/);
  assert.doesNotMatch(magic, /mtgoMisses/);
});

test("the event request cap leaves the rest unattempted", async () => {
  const today = "2026-11-11";
  const first = `modern-league-${today}30001`;
  const second = `pioneer-league-${today}30002`;
  const fetched: string[] = [];
  const result = await importMtgo({
    days: 4,
    today,
    now: () => Date.parse(`${today}T12:00:00Z`),
    sleep: async () => {},
    maxEventRequests: 1,
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([second, first]) };
      fetched.push(url);
      return { kind: "timeout" };
    },
  });
  assert.deepEqual(fetched, [mtgoEventUrl(first)]);
  assert.equal(result.requests, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.unattempted[0]?.reason, "request-limit");
  assert.equal(result.unattempted[0]?.slug, second);
  assert.equal(result.structuralFailure, false);
});

test("timeouts and HTTP errors after skipping stored events stay partial and still publish", async () => {
  const today = "2026-11-11";
  const stored = `modern-league-${today}40001`;
  const hung = `pioneer-league-${today}40002`;
  const denied = `legacy-league-${today}40003`;
  const result = await importMtgo({
    days: 4,
    today,
    now: () => Date.parse(`${today}T12:00:00Z`),
    sleep: async () => {},
    known: (slug) => (slug === stored ? "lists" : "absent"),
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([stored, hung, denied]) };
      if (url.endsWith(hung)) return { kind: "timeout" };
      return { kind: "http", status: 503 };
    },
  });
  assert.equal(result.skippedStored, 1);
  assert.equal(result.events, 0);
  assert.equal(result.errors, 2);
  assert.equal(result.structuralFailure, false);
  const assessed = assessMtgoImport(result);
  assert.equal(assessed.mtgo, "partial");
  assert.deepEqual(
    assessed.diagnosticMisses.map((miss) => miss.reason).sort(),
    ["http", "timeout"],
  );
  assert.equal(
    assessed.diagnosticMisses.some((miss) => miss.reason === "listing-unreachable"),
    false,
  );
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, true);
});

test("an index 404 still blocks publish", async () => {
  const result = await importMtgo({
    sleep: async () => {},
    fetchPage: async () => ({ kind: "http", status: 404 }),
  });
  assert.equal(result.structuralFailure, true);
  const assessed = assessMtgoImport(result);
  assert.equal(assessed.mtgo, "unavailable");
  assert.equal(assessed.mtgoMisses, undefined);
  assert.equal(
    assessed.diagnosticMisses.some((miss) => miss.reason === "listing-unreachable"),
    false,
  );
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, false);
});

test("every 200 page missing the decklist embed is structural", async () => {
  const today = "2026-11-11";
  const first = `modern-league-${today}50001`;
  const second = `pioneer-league-${today}50002`;
  const result = await importMtgo({
    days: 4,
    today,
    now: () => Date.parse(`${today}T12:00:00Z`),
    sleep: async () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([first, second]) };
      return { kind: "ok", status: 200, html: "<html>no decklist object</html>" };
    },
  });
  assert.equal(result.events, 0);
  assert.equal(result.errors, 2);
  assert.ok(result.misses.every((miss) => miss.reason === "parse"));
  assert.equal(result.structuralFailure, true);
  const assessed = assessMtgoImport(result);
  assert.equal(assessed.mtgo, "unavailable");
  assert.deepEqual(
    assessed.diagnosticMisses.map((miss) => miss.reason),
    ["parse", "parse"],
  );
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, false);
});

test("scraped MTGO lists link to the event page, not the challenges index in the payload", async () => {
  const today = "2026-11-14";
  const slug = `modern-challenge-32-${today}12858103`;
  let item: RawCacheItem | undefined;
  const result = await importMtgo({
    days: 4,
    today,
    now: () => Date.parse(`${today}T12:00:00Z`),
    sleep: async () => {},
    onItem: (next) => {
      item = next;
    },
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) return { kind: "ok", status: 200, html: indexHtml([slug]) };
      return {
        kind: "ok",
        status: 200,
        html: page({
          description: "Modern Challenge 32",
          starttime: `${today} 02:00:00.0`,
          url: "https://www.mtgo.com/premier-play-prelims-and-format-challenges#challenges",
          site_name: slug,
          decklists: [
            {
              player: "gazmon48",
              loginid: "1",
              main_deck: [{ qty: "4", card_attributes: { card_name: "Thoughtseize" } }],
              sideboard_deck: [],
            },
          ],
        }),
      };
    },
  });
  assert.equal(result.events, 1);
  assert.ok(item);
  assert.equal(item.Tournament.Uri, mtgoEventUrl(slug));
  assert.equal(item.Decks[0]?.AnchorUri, `${mtgoEventUrl(slug)}#deck_gazmon48`);
  assert.equal(item.Decks[0]?.AnchorUri?.includes("premier-play"), false);
});

const LISTING = "https://www.mtgo.com/decklists";

function isListingUrl(url: string): boolean {
  return url.split("?")[0] === LISTING;
}

test("a previous published cycle's event misses are not an empty listing", () => {
  assert.equal(listingEmptyPersisted(undefined), false);
  assert.equal(
    listingEmptyPersisted([{ reason: "timeout" }, { reason: "parse" }, { reason: "listing-unreachable" }, { reason: "listing-stale" }]),
    false,
  );
  assert.equal(listingEmptyPersisted([{ reason: "timeout" }, { reason: "listing-empty" }]), true);
});

test("an empty-200 listing succeeds on a later retry", async () => {
  const today = "2026-11-20";
  const now = Date.parse(`${today}T12:00:00Z`);
  const recent = `modern-league-${today}11337`;
  const shell = "<html><title>Decklists</title><img src=\"/images/loading.gif\"></html>";
  const eventHtml = page({
    description: "Modern League",
    starttime: `${today} 00:00:00`,
    decklists: [{ player: "Ada", loginid: "1", main_deck: [{ qty: "4", card_attributes: { card_name: "Lightning Bolt" } }] }],
  });
  const lines: string[] = [];
  const pauses: number[] = [];
  const indexUrls: string[] = [];
  const indexInits: (MtgoFetchInit | undefined)[] = [];
  let indexCalls = 0;
  const recovered = await importMtgo({
    days: 4,
    today,
    now: () => now,
    priorEmptyListings: 1,
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      pauses.push(ms);
    },
    onItem: () => {},
    fetchPage: async (url, init): Promise<MtgoPageFetch> => {
      if (isListingUrl(url)) {
        indexCalls++;
        indexUrls.push(url);
        indexInits.push(init);
        if (indexCalls === 1) return { kind: "ok", status: 200, html: shell };
        return { kind: "ok", status: 200, html: indexHtml([recent]) };
      }
      return { kind: "ok", status: 200, html: eventHtml };
    },
  });
  assert.equal(indexCalls, 2);
  assert.deepEqual(indexUrls, [LISTING, `${LISTING}?comprel-retry=1`]);
  assert.equal(indexInits[0], undefined);
  assert.deepEqual(indexInits[1]?.headers, { "Cache-Control": "no-cache", Pragma: "no-cache" });
  assert.equal(indexInits[1]?.cache, "no-store");
  assert.deepEqual(pauses, [10_000, 60]);
  assert.equal(recovered.structuralFailure, false);
  assert.equal(recovered.listingEmpty, false);
  assert.equal(recovered.indexOk, true);
  assert.equal(recovered.events, 1);
  assert.equal(assessMtgoImport(recovered).mtgo, "ok");
  assert.ok(lines.some((line) => line.includes("attempt 1 failed") && line.includes("200 with no decklist links") && line.includes("retrying")));
  assert.equal(lines.some((line) => line.includes("the index markup changed")), false);

  const latePauses: number[] = [];
  const lateUrls: string[] = [];
  const lateInits: (MtgoFetchInit | undefined)[] = [];
  let lateCalls = 0;
  const late = await importMtgo({
    days: 4,
    today,
    now: () => now,
    sleep: async (ms) => {
      latePauses.push(ms);
    },
    onItem: () => {},
    fetchPage: async (url, init): Promise<MtgoPageFetch> => {
      if (isListingUrl(url)) {
        lateCalls++;
        lateUrls.push(url);
        lateInits.push(init);
        if (lateCalls < 4) return { kind: "ok", status: 200, html: shell };
        return { kind: "ok", status: 200, html: indexHtml([recent]) };
      }
      return { kind: "ok", status: 200, html: eventHtml };
    },
  });
  assert.equal(lateCalls, 4);
  assert.deepEqual(lateUrls, [LISTING, `${LISTING}?comprel-retry=1`, `${LISTING}?comprel-retry=2`, `${LISTING}?comprel-retry=3`]);
  assert.equal(lateInits[0], undefined);
  assert.deepEqual(lateInits[3]?.headers, { "Cache-Control": "no-cache", Pragma: "no-cache" });
  assert.equal(lateInits[3]?.cache, "no-store");
  assert.deepEqual(latePauses, [10_000, 30_000, 60_000, 60]);
  assert.equal(late.structuralFailure, false);
  assert.equal(late.listingEmpty, false);
  assert.equal(late.events, 1);
  assert.equal(assessMtgoImport(late).mtgo, "ok");

  let healthy = 0;
  await importMtgo({
    days: 4,
    today,
    now: () => now,
    sleep: async () => {},
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) {
        healthy++;
        return { kind: "ok", status: 200, html: indexHtml([recent]) };
      }
      return { kind: "ok", status: 200, html: eventHtml };
    },
  });
  assert.equal(healthy, 1);
});

test("an empty-200 listing on every retry is a partial listing-empty miss and still publishes", async () => {
  const today = "2026-11-20";
  const now = Date.parse(`${today}T12:00:00Z`);
  const shell = "<html><title>Decklists</title><img src=\"/images/loading.gif\"></html>";
  const lines: string[] = [];
  const pauses: number[] = [];
  let calls = 0;
  let imported = 0;
  const result = await importMtgo({
    days: 4,
    today,
    now: () => now,
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      pauses.push(ms);
    },
    onItem: () => {
      imported++;
    },
    fetchPage: async () => {
      calls++;
      return { kind: "ok", status: 200, html: shell };
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(pauses, [10_000, 30_000, 60_000]);
  assert.equal(result.indexOk, false);
  assert.equal(result.listingEmpty, true);
  assert.equal(result.structuralFailure, false);
  assert.equal(result.events, 0);
  assert.equal(result.requests, 0);
  assert.equal(imported, 0);
  assert.equal(result.indexError, "200 with no decklist links");
  assert.ok(lines.some((line) => line.includes("attempt 1 failed") && line.includes("200 with no decklist links") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("attempt 2 failed") && line.includes("200 with no decklist links") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("attempt 3 failed") && line.includes("200 with no decklist links") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("returned 200 but no decklist links — transient, skipping this cycle")));
  assert.equal(lines.some((line) => line.includes("the index markup changed")), false);
  const assessed = assessMtgoImport(result);
  assert.equal(assessed.mtgo, "partial");
  assert.equal(assessed.mtgoMissed, 1);
  assert.deepEqual(assessed.mtgoMisses, [{ slug: "listing", url: LISTING, reason: "listing-empty" }]);
  assert.deepEqual(assessed.diagnosticMisses, [{ ref: LISTING, reason: "listing-empty", detail: "200 with no decklist links" }]);
  const summary = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish allowed. cache complete. MTGO ${assessed.mtgo}.`,
    sections: [{ title: "Missed events", events: assessed.diagnosticMisses }],
  });
  assert.match(summary, /MTGO partial\./);
  assert.match(summary, /Count: 1 \(listing-empty 1\)/);
  assert.match(summary, /https:\/\/www\.mtgo\.com\/decklists — listing-empty \(200 with no decklist links\)/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, true);
  const magic = fs.readFileSync("src/app/magic/page.tsx", "utf8");
  assert.doesNotMatch(magic, /listing-empty/);
  assert.doesNotMatch(magic, /mtgoMisses/);
});

test("an empty-200 listing that repeats the previous published cycle holds publish", async () => {
  const today = "2026-11-20";
  const now = Date.parse(`${today}T12:00:00Z`);
  const shell = "<html><title>Decklists</title><img src=\"/images/loading.gif\"></html>";
  const lines: string[] = [];
  const pauses: number[] = [];
  let calls = 0;
  const held = await importMtgo({
    days: 4,
    today,
    now: () => now,
    priorEmptyListings: 1,
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      pauses.push(ms);
    },
    onItem: () => {},
    fetchPage: async () => {
      calls++;
      return { kind: "ok", status: 200, html: shell };
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(pauses, [10_000, 30_000, 60_000]);
  assert.equal(held.indexOk, false);
  assert.equal(held.listingEmpty, false);
  assert.equal(held.structuralFailure, true);
  assert.equal(held.events, 0);
  assert.equal(held.requests, 0);
  assert.ok(lines.some((line) => line.includes("attempt 1 failed") && line.includes("200 with no decklist links")));
  assert.ok(lines.some((line) => line.includes("attempt 3 failed") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("on consecutive published cycles — the index markup changed")));
  const assessed = assessMtgoImport(held);
  assert.equal(assessed.mtgo, "unavailable");
  assert.equal(assessed.mtgoMisses, undefined);
  assert.equal(assessed.diagnosticMisses.some((miss) => miss.reason === "listing-empty"), false);
  assert.equal(assessed.diagnosticMisses.some((miss) => miss.reason === "listing-stale"), false);
  const summary = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish held. MTGO scrape failed structurally; previous snapshot kept. MTGO ${assessed.mtgo}.`,
    sections: [{ title: "Missed events", events: assessed.diagnosticMisses }],
  });
  assert.match(summary, /MTGO unavailable\./);
  assert.doesNotMatch(summary, /listing-empty/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, false);
});

test("a listing with no recent tracked events is retried, then recorded as listing-stale", async () => {
  const today = "2026-11-20";
  const now = Date.parse(`${today}T12:00:00Z`);
  const recent = `modern-league-${today}11337`;
  const staleHtml = indexHtml([`modern-league-2026-11-0111337`, `premodern-league-${today}11377`]);
  const eventHtml = page({
    description: "Modern League",
    starttime: `${today} 00:00:00`,
    decklists: [{ player: "Ada", loginid: "1", main_deck: [{ qty: "1", card_attributes: { card_name: "Island" } }] }],
  });
  const pauses: number[] = [];
  let indexCalls = 0;
  const recovered = await importMtgo({
    days: 4,
    today,
    now: () => now,
    sleep: async (ms) => {
      pauses.push(ms);
    },
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) {
        indexCalls++;
        if (indexCalls < 3) return { kind: "ok", status: 200, html: staleHtml };
        return { kind: "ok", status: 200, html: indexHtml([recent]) };
      }
      return { kind: "ok", status: 200, html: eventHtml };
    },
  });
  assert.equal(indexCalls, 3);
  assert.deepEqual(pauses, [700, 1400, 60]);
  assert.equal(recovered.found, 1);
  assert.equal(recovered.events, 1);
  assert.equal(recovered.structuralFailure, false);
  assert.equal(assessMtgoImport(recovered).mtgo, "ok");

  const lines: string[] = [];
  const stalePauses: number[] = [];
  let staleCalls = 0;
  const fetchedEvents: string[] = [];
  const stale = await importMtgo({
    days: 4,
    today,
    now: () => now,
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      stalePauses.push(ms);
    },
    onItem: () => {},
    fetchPage: async (url): Promise<MtgoPageFetch> => {
      if (url.endsWith("/decklists")) {
        staleCalls++;
        return { kind: "ok", status: 200, html: staleHtml };
      }
      fetchedEvents.push(url);
      return { kind: "ok", status: 200, html: eventHtml };
    },
  });
  assert.equal(staleCalls, 3);
  assert.deepEqual(fetchedEvents, []);
  assert.deepEqual(stalePauses, [700, 1400]);
  assert.equal(stale.indexOk, true);
  assert.equal(stale.found, 0);
  assert.equal(stale.indexLinks, 2);
  assert.equal(stale.events, 0);
  assert.equal(stale.errors, 0);
  assert.equal(stale.structuralFailure, false);
  assert.ok(lines.some((line) => line.includes("attempt 1 failed") && line.includes("0 recent events in tracked formats") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("attempt 2 failed") && line.includes("retrying")));
  assert.ok(lines.some((line) => line.includes("0 recent events in tracked formats; 0 already stored with lists, 0 to fetch")));
  assert.ok(lines.some((line) => line.includes("had 0 recent events in tracked formats (2 decklist links)")));
  const assessed = assessMtgoImport(stale);
  assert.equal(assessed.mtgo, "partial");
  assert.equal(assessed.mtgoMissed, 1);
  assert.equal(assessed.mtgoUnattempted, 0);
  assert.deepEqual(assessed.mtgoMisses, [
    { slug: "listing", url: "https://www.mtgo.com/decklists", reason: "listing-stale" },
  ]);
  assert.deepEqual(assessed.diagnosticMisses, [
    { ref: "https://www.mtgo.com/decklists", reason: "listing-stale", detail: "2 decklist links" },
  ]);
  const summary = renderIngestDiagnostic({
    game: "Magic",
    status: `Publish allowed. cache complete. MTGO ${assessed.mtgo}.`,
    sections: [{ title: "Missed events", events: assessed.diagnosticMisses }],
  });
  assert.match(summary, /MTGO partial\./);
  assert.match(summary, /Count: 1 \(listing-stale 1\)/);
  assert.match(summary, /https:\/\/www\.mtgo\.com\/decklists — listing-stale \(2 decklist links\)/);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: assessed.mtgo, allowIncompleteMtgo: false }).publish, true);
  const magic = fs.readFileSync("src/app/magic/page.tsx", "utf8");
  assert.doesNotMatch(magic, /listing-stale/);
  assert.doesNotMatch(magic, /mtgoMisses/);
});
