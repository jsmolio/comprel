import assert from "node:assert/strict";
import test from "node:test";
import { decidePublish } from "../src/lib/facts/publish-policy";
import { diagnoseMtgoHtml, importMtgo, mtgoEventUrl, prioritizeMtgoSlugs, type MtgoPageFetch } from "../src/lib/sources/mtgo";

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
  const mtgo = result.structuralFailure ? "unavailable" : "partial";
  assert.equal(mtgo, "partial");
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo, allowIncompleteMtgo: false }).publish, true);
});

test("an index 404 still blocks publish", async () => {
  const result = await importMtgo({
    sleep: async () => {},
    fetchPage: async () => ({ kind: "http", status: 404 }),
  });
  assert.equal(result.structuralFailure, true);
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: "unavailable", allowIncompleteMtgo: false }).publish, false);
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
  assert.equal(decidePublish({ discovered: 4, failed: 0, mtgo: "unavailable", allowIncompleteMtgo: false }).publish, false);
});
