import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPipeline } from "../update-data.js";
import { STATE_NAMES } from "../lib/states.js";

function seedPrev() {
  const states = {};
  for (const name of STATE_NAMES) {
    states[name] = {
      stateCode: name.slice(0, 2).toUpperCase(),
      gasPrices:  { regular: 3.00, midGrade: 3.30, premium: 3.60, diesel: 3.90, updated: "2026-04-10", source: "seed" },
      evChargingPublic: { usdPerKwh: 0.40, updated: "2026-04-10", source: "seed" },
      elecResidential:  { usdPerKwh: 0.15, period: "2026-01", updated: "2026-04-10", source: "seed" },
      gridCo2: { gCo2PerKwh: 400, year: 2025, source: "Ember" }
    };
  }
  return {
    meta: { generatedAt: "2026-04-10T13:00:00Z", pipelineVersion: "1.0.0", feedsRefreshedThisRun: [] },
    constants: { gasolineKgCo2PerGallon: 8.887, chargingEfficiency: 0.9 },
    states
  };
}

function stubOkFeed(name, targetKey, sourceLabel, blockFactory) {
  return async () => ({
    status: "ok", name, targetKey, sourceLabel,
    stateBlocks: Object.fromEntries(STATE_NAMES.map(s => [s, blockFactory(s)]))
  });
}

function stubRejectFeed(name, reason) {
  return async () => ({ status: "reject", name, reason });
}

test("runPipeline writes data.json when a feed changes values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const prevPath = join(dir, "data.json");
  await writeFile(prevPath, JSON.stringify(seedPrev()));

  const now = new Date("2026-04-22T13:00:00Z");
  const exitCode = await runPipeline({
    dataPath: prevPath,
    now,
    feeds: [
      stubOkFeed("gas", "gasPrices", "AAA",
        () => ({ regular: 3.50, midGrade: 3.80, premium: 4.10, diesel: 4.40 })),
      stubRejectFeed("aaaEv", "http 500"),
      stubRejectFeed("eiaResidential", "http 500")
    ]
  });

  assert.equal(exitCode, 0);
  const next = JSON.parse(await readFile(prevPath, "utf8"));
  assert.equal(next.states.Alabama.gasPrices.regular, 3.50);
  assert.equal(next.states.Alabama.gasPrices.updated, "2026-04-22");
  assert.equal(next.meta.generatedAt, now.toISOString());
  assert.deepEqual(next.meta.feedsRefreshedThisRun, ["gas"]);
  await rm(dir, { recursive: true });
});

test("runPipeline does NOT rewrite file when nothing changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const prevPath = join(dir, "data.json");
  await writeFile(prevPath, JSON.stringify(seedPrev()));
  const mtimeBefore = statSync(prevPath).mtimeMs;

  // All feeds reject → no data changes.
  await new Promise(r => setTimeout(r, 5));
  const exitCode = await runPipeline({
    dataPath: prevPath,
    now: new Date("2026-04-22T13:00:00Z"),
    feeds: [
      stubRejectFeed("gas", "stale"),
      stubRejectFeed("aaaEv", "http 500"),
      stubRejectFeed("eiaResidential", "http 500")
    ]
  });
  const mtimeAfter = statSync(prevPath).mtimeMs;
  assert.equal(exitCode, 0);
  assert.equal(mtimeBefore, mtimeAfter, "file should not be rewritten");
  await rm(dir, { recursive: true });
});

test("runPipeline returns exit 1 when all feeds reject AND data is >3 days stale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const prevPath = join(dir, "data.json");
  // Seed has updated dates of "2026-04-10"; now is "2026-04-20" (10 days later)
  await writeFile(prevPath, JSON.stringify(seedPrev()));

  const exitCode = await runPipeline({
    dataPath: prevPath,
    now: new Date("2026-04-20T13:00:00Z"),
    feeds: [
      stubRejectFeed("gas", "x"),
      stubRejectFeed("aaaEv", "x"),
      stubRejectFeed("eiaResidential", "x")
    ]
  });
  assert.equal(exitCode, 1);
  await rm(dir, { recursive: true });
});

test("runPipeline exit 0 when all feeds reject but data is fresh enough", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const prevPath = join(dir, "data.json");
  const prev = seedPrev();
  // Bump all live-feed updated dates to today.
  for (const s of Object.values(prev.states)) {
    s.gasPrices.updated = "2026-04-22";
    s.evChargingPublic.updated = "2026-04-22";
    s.elecResidential.updated = "2026-04-22";
  }
  await writeFile(prevPath, JSON.stringify(prev));

  const exitCode = await runPipeline({
    dataPath: prevPath,
    now: new Date("2026-04-22T13:00:00Z"),
    feeds: [
      stubRejectFeed("gas", "x"),
      stubRejectFeed("aaaEv", "x"),
      stubRejectFeed("eiaResidential", "x")
    ]
  });
  assert.equal(exitCode, 0);
  await rm(dir, { recursive: true });
});
