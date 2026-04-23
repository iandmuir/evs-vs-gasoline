import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, statesChanged } from "../lib/merge.js";

function basePrev() {
  return {
    meta: {
      generatedAt: "2026-04-20T13:00:00Z",
      pipelineVersion: "1.0.0",
      feedsRefreshedThisRun: []
    },
    constants: { gasolineKgCo2PerGallon: 8.887, chargingEfficiency: 0.9 },
    states: {
      Alabama: {
        stateCode: "AL",
        gasPrices: { regular: 3.00, midGrade: 3.30, premium: 3.60, diesel: 3.90, updated: "2026-04-18", source: "AAA" },
        evChargingPublic: { usdPerKwh: 0.40, updated: "2026-04-18", source: "AAA" },
        elecResidential: { usdPerKwh: 0.15, period: "2026-01", updated: "2026-04-18", source: "EIA" },
        gridCo2: { gCo2PerKwh: 359.41, year: 2025, source: "Ember" }
      }
    }
  };
}

test("merge applies ok feed to matching state", () => {
  const prev = basePrev();
  const now = new Date("2026-04-22T13:00:00Z");
  const feedResults = [{
    status: "ok",
    name: "gas",
    targetKey: "gasPrices",
    sourceLabel: "AAA",
    stateBlocks: {
      Alabama: { regular: 3.50, midGrade: 3.80, premium: 4.10, diesel: 4.40 }
    }
  }];

  const next = merge(prev, feedResults, now);
  assert.equal(next.states.Alabama.gasPrices.regular, 3.50);
  assert.equal(next.states.Alabama.gasPrices.updated, "2026-04-22");
  assert.equal(next.states.Alabama.gasPrices.source, "AAA");
});

test("merge ignores rejected feeds", () => {
  const prev = basePrev();
  const now = new Date("2026-04-22T13:00:00Z");
  const feedResults = [
    { status: "reject", name: "gas", reason: "freshness" }
  ];
  const next = merge(prev, feedResults, now);
  assert.equal(next.states.Alabama.gasPrices.regular, 3.00);
  assert.equal(next.states.Alabama.gasPrices.updated, "2026-04-18");
});

test("merge skips unknown state names", () => {
  const prev = basePrev();
  const now = new Date("2026-04-22T13:00:00Z");
  const feedResults = [{
    status: "ok",
    name: "gas",
    targetKey: "gasPrices",
    sourceLabel: "AAA",
    stateBlocks: { Atlantis: { regular: 9.99, midGrade: 9, premium: 9, diesel: 9 } }
  }];
  const next = merge(prev, feedResults, now);
  assert.equal(Object.keys(next.states).length, 1);
  assert.equal(next.states.Alabama.gasPrices.regular, 3.00);
});

test("merge does not mutate prev", () => {
  const prev = basePrev();
  const before = JSON.stringify(prev);
  const now = new Date("2026-04-22T13:00:00Z");
  merge(prev, [{
    status: "ok", name: "gas", targetKey: "gasPrices", sourceLabel: "AAA",
    stateBlocks: { Alabama: { regular: 3.50, midGrade: 3.80, premium: 4.10, diesel: 4.40 } }
  }], now);
  assert.equal(JSON.stringify(prev), before);
});

test("merge does not touch meta fields", () => {
  const prev = basePrev();
  const now = new Date("2026-04-22T13:00:00Z");
  const next = merge(prev, [], now);
  assert.deepEqual(next.meta, prev.meta);
});

test("statesChanged false when states identical", () => {
  const a = basePrev();
  const b = basePrev();
  assert.equal(statesChanged(a, b), false);
});

test("statesChanged true when a price changes", () => {
  const a = basePrev();
  const b = basePrev();
  b.states.Alabama.gasPrices.regular = 3.99;
  assert.equal(statesChanged(a, b), true);
});

test("statesChanged ignores meta differences", () => {
  const a = basePrev();
  const b = basePrev();
  b.meta.generatedAt = "2099-01-01T00:00:00Z";
  assert.equal(statesChanged(a, b), false);
});
