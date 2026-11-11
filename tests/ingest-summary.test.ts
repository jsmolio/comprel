import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { INGEST_SUMMARY_FILES, renderIngestDiagnostic, reportIngestDiagnostic } from "../src/lib/ingest-summary";

test("ingest summary counts misses by reason and lists every event", () => {
  const text = renderIngestDiagnostic({
    game: "Magic",
    status: "Publish allowed. cache complete. MTGO partial.",
    sections: [
      {
        title: "Missed events",
        events: [
          { ref: "https://www.mtgo.com/decklist/a", reason: "timeout", detail: "exhausted retries" },
          { ref: "https://www.mtgo.com/decklist/b", reason: "http", detail: "500" },
          { ref: "https://www.mtgo.com/decklist/c", reason: "timeout", detail: "exhausted retries" },
        ],
      },
      {
        title: "Unattempted events",
        events: [
          { ref: "https://www.mtgo.com/decklist/d", reason: "budget" },
          { ref: "https://www.mtgo.com/decklist/e", reason: "request-limit" },
        ],
      },
      { title: "Failed cache files", events: [] },
    ],
  });
  assert.match(text, /## Magic ingest/);
  assert.match(text, /Publish allowed\. cache complete\. MTGO partial\./);
  assert.match(text, /### Missed events/);
  assert.match(text, /Count: 3 \(timeout 2, http 1\)/);
  assert.match(text, /https:\/\/www\.mtgo\.com\/decklist\/a — timeout \(exhausted retries\)/);
  assert.match(text, /https:\/\/www\.mtgo\.com\/decklist\/b — http \(500\)/);
  assert.match(text, /https:\/\/www\.mtgo\.com\/decklist\/c — timeout \(exhausted retries\)/);
  assert.match(text, /### Unattempted events/);
  assert.match(text, /Count: 2 \(budget 1, request-limit 1\)/);
  assert.match(text, /https:\/\/www\.mtgo\.com\/decklist\/d — budget/);
  assert.match(text, /https:\/\/www\.mtgo\.com\/decklist\/e — request-limit/);
  assert.match(text, /### Failed cache files/);
  assert.match(text, /Count: 0/);
  assert.match(text, /None\./);
});

test("riftbound summary lists every miss, unattempted event, list gap, and missing legend", () => {
  const text = renderIngestDiagnostic({
    game: "Riftbound",
    status: "Publish allowed. partial coverage. BoundRift partial.",
    sections: [
      {
        title: "Missed events",
        events: [
          { ref: "https://boundrift.com/events/1", reason: "standings unavailable" },
          { ref: "https://boundrift.com/events/2", reason: "rate-limit" },
        ],
      },
      {
        title: "Unattempted events",
        events: [{ ref: "https://boundrift.com/events/3", reason: "budget" }],
      },
      {
        title: "PlayRiftbound events with no lists",
        events: [
          { ref: "https://boundrift.com/events/4", reason: "no lists" },
          { ref: "https://boundrift.com/events/5 https://example.test/event", reason: "no lists" },
        ],
      },
      {
        title: "Events with no legend",
        events: [{ ref: "https://boundrift.com/events/6", reason: "no legend" }],
      },
    ],
  });
  assert.match(text, /Count: 2 \(rate-limit 1, standings unavailable 1\)/);
  assert.match(text, /https:\/\/boundrift\.com\/events\/1 — standings unavailable/);
  assert.match(text, /https:\/\/boundrift\.com\/events\/2 — rate-limit/);
  assert.match(text, /https:\/\/boundrift\.com\/events\/3 — budget/);
  assert.match(text, /Count: 2 \(no lists 2\)/);
  assert.match(text, /https:\/\/boundrift\.com\/events\/5 https:\/\/example\.test\/event — no lists/);
  assert.match(text, /https:\/\/boundrift\.com\/events\/6 — no legend/);
});

test("report writes the runner summary file and the log", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comprel-summary-"));
  const previous = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = dir;
  const lines: string[] = [];
  try {
    reportIngestDiagnostic(
      "riftbound",
      {
        game: "Riftbound",
        status: "Publish held. BoundRift event list unavailable (rate-limit). BoundRift unavailable.",
        sections: [
          { title: "Missed events", events: [] },
          { title: "Unattempted events", events: [] },
        ],
      },
      (line) => lines.push(line),
    );
    const written = fs.readFileSync(path.join(dir, INGEST_SUMMARY_FILES.riftbound), "utf8");
    assert.match(written, /Publish held/);
    assert.match(written, /Count: 0/);
    assert.equal(lines.join("\n"), written.trimEnd());
    assert.equal(fs.existsSync(path.join(dir, INGEST_SUMMARY_FILES.magic)), false);
  } finally {
    if (previous === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = previous;
  }
});

test("the ingest workflow copies both summaries into the job summary and records step failure", () => {
  const yml = fs.readFileSync(".github/workflows/ingest.yml", "utf8");
  assert.match(yml, /GITHUB_STEP_SUMMARY/);
  assert.match(yml, /for game in magic riftbound/);
  assert.match(yml, /comprel-ingest-\$\{game\}\.md/);
  assert.equal(INGEST_SUMMARY_FILES.magic, "comprel-ingest-magic.md");
  assert.equal(INGEST_SUMMARY_FILES.riftbound, "comprel-ingest-riftbound.md");
  assert.match(yml, /Magic publish failed \(continue-on-error\)/);
  assert.match(yml, /Riftbound publish failed \(continue-on-error\)/);
  assert.match(yml, /steps\.magic\.outcome/);
  assert.match(yml, /steps\.riftbound\.outcome/);
  assert.doesNotMatch(yml, /if:\s*always\(\)/);
  const summary = yml.indexOf("Record ingest diagnostics");
  const rift = yml.indexOf("pnpm backfill --incremental --game=riftbound");
  const commit = yml.indexOf("git push");
  assert.ok(summary > rift && summary < commit);
  assert.match(yml, /cron: "0 \*\/2 \* \* \*"/);
});
