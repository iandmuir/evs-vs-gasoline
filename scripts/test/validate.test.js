import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCoverage,
  assertRange,
  RejectedFeedError
} from "../lib/validate.js";

test("assertCoverage passes when threshold met", () => {
  const covered = new Set(["Alabama", "Alaska", "Arizona"]);
  // threshold 2 is below size 3 → ok
  assert.doesNotThrow(() => assertCoverage(covered, 2, "testFeed"));
});

test("assertCoverage throws RejectedFeedError when below threshold", () => {
  const covered = new Set(["Alabama"]);
  assert.throws(
    () => assertCoverage(covered, 50, "gas"),
    RejectedFeedError
  );
});

test("assertRange passes for in-range values", () => {
  assert.doesNotThrow(() =>
    assertRange([1.5, 3.0, 9.99], 1.5, 10.0, "gas.regular")
  );
});

test("assertRange rejects a below-min value", () => {
  assert.throws(
    () => assertRange([1.49], 1.5, 10.0, "gas.regular"),
    RejectedFeedError
  );
});

test("assertRange rejects an above-max value", () => {
  assert.throws(
    () => assertRange([10.01], 1.5, 10.0, "gas.regular"),
    RejectedFeedError
  );
});

test("assertRange rejects NaN / non-finite", () => {
  assert.throws(
    () => assertRange([NaN], 0, 100, "x"),
    RejectedFeedError
  );
});

test("RejectedFeedError carries feed name and reason", () => {
  const err = new RejectedFeedError("eia", "unit guard failed");
  assert.equal(err.feed, "eia");
  assert.match(err.message, /unit guard failed/);
});
