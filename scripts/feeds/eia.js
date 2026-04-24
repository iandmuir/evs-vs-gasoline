import { ABBR_TO_NAME } from "../lib/states.js";
import { assertCoverage, assertRange, RejectedFeedError } from "../lib/validate.js";

const NAME = "eiaResidential";
const TARGET_KEY = "elecResidential";
const SOURCE_LABEL = "EIA";
const MIN_CENTS = 5;
const MAX_CENTS = 60;
const MIN_COVERAGE = 50;

const EIA_URL = (apiKey) => {
  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: "monthly",
    "data[0]": "price",
    "facets[sectorid][]": "RES",
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "200"
  });
  return `https://api.eia.gov/v2/electricity/retail-sales/data/?${params}`;
};

export async function fetchEia(apiKey = process.env.EIA_API_KEY) {
  try {
    if (!apiKey) {
      throw new RejectedFeedError(NAME, "EIA_API_KEY not set");
    }
    const res = await fetch(EIA_URL(apiKey));
    if (!res.ok) {
      throw new RejectedFeedError(NAME, `HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseEiaResponse(json);
  } catch (err) {
    const reason =
      err instanceof RejectedFeedError ? err.reason : `${err.name}: ${err.message}`;
    return { status: "reject", name: NAME, reason };
  }
}

// Pure function for testability. Takes the parsed EIA v2 JSON.
export function parseEiaResponse(json) {
  try {
    const resp = json && json.response;
    if (!resp || !Array.isArray(resp.data)) {
      throw new RejectedFeedError(NAME, "missing response.data[]");
    }
    // Unit guard. EIA v2 puts the unit in "price-units" on each data row
    // (following the pattern {fieldname}-units). The string is "cents per
    // kilowatt-hour" (hyphenated), so the regex allows an optional hyphen.
    const units = resp.units || (resp.data[0] && (resp.data[0]["price-units"] || resp.data[0].units)) || "";
    if (!/cents per kilowatt-?hour/i.test(units)) {
      throw new RejectedFeedError(NAME, `unexpected units: ${JSON.stringify(units)}`);
    }
    if (resp.data.length === 0) {
      throw new RejectedFeedError(NAME, "response.data is empty");
    }

    // Bucket by state, keep row with highest period string (YYYY-MM sorts lex).
    const latest = {}; // abbr -> { period, price }
    for (const row of resp.data) {
      const abbr = row.stateid;
      const period = row.period;
      const price = typeof row.price === "number" ? row.price : parseFloat(row.price);
      if (!abbr || !period || !Number.isFinite(price)) continue;
      if (!ABBR_TO_NAME[abbr]) continue;
      const cur = latest[abbr];
      if (!cur || period > cur.period) {
        latest[abbr] = { period, price };
      }
    }

    const stateBlocks = {};
    const covered = new Set();
    const allCents = [];
    for (const [abbr, { period, price }] of Object.entries(latest)) {
      const name = ABBR_TO_NAME[abbr];
      stateBlocks[name] = {
        usdPerKwh: price / 100,
        period
      };
      covered.add(name);
      allCents.push(price);
    }

    assertRange(allCents, MIN_CENTS, MAX_CENTS, "eiaResidential.cents");
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
