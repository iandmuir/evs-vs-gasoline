import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAaaEvResponse } from "../feeds/aaa-ev.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parseAaaEvResponse accepts valid fixture", async () => {
  const json = JSON.parse(
    await readFile(join(__dirname, "fixtures/aaa-ev.valid.json"), "utf8")
  );
  const res = parseAaaEvResponse(json);
  assert.equal(res.status, "ok");
  assert.equal(res.targetKey, "evChargingPublic");
  assert.equal(res.sourceLabel, "AAA");
  assert.equal(res.stateBlocks.Alabama.usdPerKwh, 0.43);
  assert.ok(res.stateBlocks["District of Columbia"]);
});

test("parseAaaEvResponse rejects when header row lacks ev_costperkwh", () => {
  const res = parseAaaEvResponse({
    values: [
      ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers"],
      ["1","x","AL","EV","5"]
    ]
  });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /header|column/i);
});

test("parseAaaEvResponse rejects out-of-range price", async () => {
  // Build a 51-state fixture with a bad price for one state
  const { NAME_TO_ABBR, STATE_NAMES } = await import("../lib/states.js");
  const values = [
    ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"]
  ];
  for (const name of STATE_NAMES) {
    values.push(["1","x",NAME_TO_ABBR[name],"EV","5", name === "Alabama" ? "5.00" : "0.43"]);
  }
  const res = parseAaaEvResponse({ values });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /range|outside/i);
});

test("parseAaaEvResponse rejects low coverage", () => {
  const res = parseAaaEvResponse({
    values: [
      ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"],
      ["1","x","AL","EV","5","0.43"]
    ]
  });
  assert.equal(res.status, "reject");
  assert.match(res.reason, /coverage/i);
});

test("parseAaaEvResponse averages multiple rows per state", async () => {
  const { NAME_TO_ABBR, STATE_NAMES } = await import("../lib/states.js");
  const values = [
    ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"]
  ];
  // 51 states, each with 2 rows: 0.40 and 0.50 → avg 0.45
  for (const name of STATE_NAMES) {
    values.push(["1","x",NAME_TO_ABBR[name],"EV","5","0.40"]);
    values.push(["2","y",NAME_TO_ABBR[name],"EV","5","0.50"]);
  }
  const res = parseAaaEvResponse({ values });
  assert.equal(res.status, "ok");
  assert.ok(Math.abs(res.stateBlocks.Alabama.usdPerKwh - 0.45) < 1e-9);
});
