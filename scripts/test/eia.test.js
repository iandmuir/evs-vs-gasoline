import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseEiaResponse } from "../feeds/eia.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parseEiaResponse picks latest period per state, converts to $/kWh", async () => {
  const json = JSON.parse(
    await readFile(join(__dirname, "fixtures/eia.valid.json"), "utf8")
  );
  const res = parseEiaResponse(json);
  assert.equal(res.status, "ok");
  assert.equal(res.targetKey, "elecResidential");
  assert.equal(res.sourceLabel, "EIA");
  assert.equal(res.stateBlocks.Alabama.period, "2026-02");
  // 16.06 cents/kWh -> 0.1606 $/kWh
  assert.ok(Math.abs(res.stateBlocks.Alabama.usdPerKwh - 0.1606) < 1e-9);
});

test("parseEiaResponse rejects when units field is not cents/kWh", () => {
  const res = parseEiaResponse({
    response: { data: [], units: "dollars per kilowatthour" }
  });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /unit/i);
});

test("parseEiaResponse rejects empty data", () => {
  const res = parseEiaResponse({
    response: { data: [], units: "cents per kilowatthour" }
  });
  assert.equal(res.status, "reject");
});

test("parseEiaResponse rejects out-of-range cents", async () => {
  const { NAME_TO_ABBR, STATE_NAMES } = await import("../lib/states.js");
  const data = STATE_NAMES.map(name => ({
    period: "2026-02", stateid: NAME_TO_ABBR[name], price: 999.99
  }));
  const res = parseEiaResponse({
    response: { data, units: "cents per kilowatthour" }
  });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /range|outside/i);
});

test("parseEiaResponse rejects low coverage", () => {
  const res = parseEiaResponse({
    response: {
      data: [{ period: "2026-02", stateid: "AL", price: 16.06 }],
      units: "cents per kilowatthour"
    }
  });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /coverage/i);
});
