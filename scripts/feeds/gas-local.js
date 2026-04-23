import { readFile } from "node:fs/promises";
import { STATE_NAMES } from "../lib/states.js";
import { assertCoverage, assertRange, RejectedFeedError } from "../lib/validate.js";

const NAME = "gas";
const TARGET_KEY = "gasPrices";
const SOURCE_LABEL = "AAA";
const MAX_STALENESS_MS = 36 * 3600 * 1000;
const MIN_PRICE = 1.50;
const MAX_PRICE = 10.00;
const MIN_COVERAGE = 50;

// Full ISO 8601 timestamp: requires T separator. A date-only string like
// "2026-04-22" parses to midnight UTC and breaks the freshness math (see
// spec §5). Reject it explicitly so the scraper's bug surfaces loudly.
const FULL_TS_REGEX = /^\d{4}-\d{2}-\d{2}T/;

export async function fetchGasLocal(path = "gas-prices.json") {
  try {
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw);

    if (!json || typeof json !== "object") {
      throw new RejectedFeedError(NAME, "not an object");
    }
    if (typeof json.updated !== "string" || !FULL_TS_REGEX.test(json.updated)) {
      throw new RejectedFeedError(
        NAME,
        `updated must be a full ISO timestamp, got ${JSON.stringify(json.updated)} (date-only strings break the freshness gate — see spec §5)`
      );
    }
    const ts = Date.parse(json.updated);
    if (!Number.isFinite(ts)) {
      throw new RejectedFeedError(NAME, `unparseable timestamp: ${json.updated}`);
    }
    const ageMs = Date.now() - ts;
    if (ageMs > MAX_STALENESS_MS) {
      throw new RejectedFeedError(
        NAME,
        `stale: ${(ageMs / 3600e3).toFixed(1)}h > 36h`
      );
    }

    if (!Array.isArray(json.states)) {
      throw new RejectedFeedError(NAME, "states is not an array");
    }

    const stateBlocks = {};
    const covered = new Set();
    const allPrices = [];

    for (const row of json.states) {
      if (!row || typeof row.state !== "string") continue;
      if (!STATE_NAMES.includes(row.state)) continue;
      const block = {
        regular: row.gas_regular,
        midGrade: row.gas_mid,
        premium: row.gas_premium,
        diesel: row.gas_diesel
      };
      for (const [k, v] of Object.entries(block)) {
        allPrices.push(v);
      }
      stateBlocks[row.state] = block;
      covered.add(row.state);
    }

    assertRange(allPrices, MIN_PRICE, MAX_PRICE, "gas.price");
    assertCoverage(covered, MIN_COVERAGE, NAME);

    return {
      status: "ok",
      name: NAME,
      targetKey: TARGET_KEY,
      sourceLabel: SOURCE_LABEL,
      stateBlocks
    };
  } catch (err) {
    const reason =
      err instanceof RejectedFeedError ? err.reason : `${err.code || err.name}: ${err.message}`;
    return { status: "reject", name: NAME, reason };
  }
}
