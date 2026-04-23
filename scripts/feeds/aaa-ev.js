import { ABBR_TO_NAME } from "../lib/states.js";
import { assertCoverage, assertRange, RejectedFeedError } from "../lib/validate.js";

const NAME = "aaaEv";
const TARGET_KEY = "evChargingPublic";
const SOURCE_LABEL = "AAA";
const MIN_PRICE = 0.10;
const MAX_PRICE = 1.00;
const MIN_COVERAGE = 50;

const SHEETS_URL = (key) =>
  `https://sheets.googleapis.com/v4/spreadsheets/1R5Km2MEFBMJoaptRSPbKhJSLCgMcyPEyITFSvAvUdHo/values/Sheet1!A:F?key=${key}`;

export async function fetchAaaEv(apiKey = process.env.AAA_SHEETS_API_KEY) {
  try {
    if (!apiKey) {
      throw new RejectedFeedError(NAME, "AAA_SHEETS_API_KEY not set");
    }
    const res = await fetch(SHEETS_URL(apiKey));
    if (!res.ok) {
      throw new RejectedFeedError(NAME, `HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseAaaEvResponse(json);
  } catch (err) {
    const reason =
      err instanceof RejectedFeedError ? err.reason : `${err.name}: ${err.message}`;
    return { status: "reject", name: NAME, reason };
  }
}

// Pure function for testability. Takes the already-parsed Sheets API JSON.
export function parseAaaEvResponse(json) {
  try {
    if (!json || !Array.isArray(json.values) || json.values.length < 2) {
      throw new RejectedFeedError(NAME, "missing or empty values[]");
    }
    const header = json.values[0];
    const stateIdx = header.indexOf("LOCATION_STATE");
    const priceIdx = header.indexOf("ev_costperkwh");
    if (stateIdx === -1 || priceIdx === -1) {
      throw new RejectedFeedError(
        NAME,
        `header row missing required columns (got ${JSON.stringify(header)})`
      );
    }

    // Bucket by state name; average per state.
    const buckets = {}; // name -> { sum, n }
    for (let i = 1; i < json.values.length; i++) {
      const row = json.values[i];
      const abbr = row[stateIdx];
      const priceStr = row[priceIdx];
      const name = ABBR_TO_NAME[abbr];
      if (!name) continue;
      const price = parseFloat(priceStr);
      if (!Number.isFinite(price)) continue;
      if (!buckets[name]) buckets[name] = { sum: 0, n: 0 };
      buckets[name].sum += price;
      buckets[name].n += 1;
    }

    const stateBlocks = {};
    const covered = new Set();
    const allPrices = [];
    for (const [name, { sum, n }] of Object.entries(buckets)) {
      if (n === 0) continue;
      const avg = sum / n;
      stateBlocks[name] = { usdPerKwh: avg };
      covered.add(name);
      allPrices.push(avg);
    }

    assertRange(allPrices, MIN_PRICE, MAX_PRICE, "aaaEv.usdPerKwh");
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
      err instanceof RejectedFeedError ? err.reason : `${err.name}: ${err.message}`;
    return { status: "reject", name: NAME, reason };
  }
}
