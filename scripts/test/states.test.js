import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATE_NAMES,
  ABBR_TO_NAME,
  NAME_TO_ABBR
} from "../lib/states.js";

test("STATE_NAMES has 51 entries (50 states + DC)", () => {
  assert.equal(STATE_NAMES.length, 51);
});

test("STATE_NAMES includes District of Columbia", () => {
  assert.ok(STATE_NAMES.includes("District of Columbia"));
});

test("ABBR_TO_NAME maps AL to Alabama", () => {
  assert.equal(ABBR_TO_NAME.AL, "Alabama");
});

test("ABBR_TO_NAME maps DC to District of Columbia", () => {
  assert.equal(ABBR_TO_NAME.DC, "District of Columbia");
});

test("NAME_TO_ABBR is the inverse of ABBR_TO_NAME", () => {
  for (const [abbr, name] of Object.entries(ABBR_TO_NAME)) {
    assert.equal(NAME_TO_ABBR[name], abbr);
  }
});

test("every STATE_NAMES entry has a NAME_TO_ABBR mapping", () => {
  for (const name of STATE_NAMES) {
    assert.ok(NAME_TO_ABBR[name], `missing abbr for ${name}`);
  }
});
