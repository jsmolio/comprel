import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseMtgoHtml, importMtgo, mtgoEventUrl, type MtgoPageFetch } from "../src/lib/sources/mtgo";

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
    [`empty-decklists ${mtgoEventUrl(empty)}`, `timeout ${mtgoEventUrl(down)}`],
  );
  assert.ok(lines.some((line) => line.includes(mtgoEventUrl(empty)) && line.includes("empty-decklists")));
  assert.ok(lines.some((line) => line.includes(mtgoEventUrl(down)) && line.includes("timeout")));
  assert.ok(lines.some((line) => line.includes("missed 2")));
});
