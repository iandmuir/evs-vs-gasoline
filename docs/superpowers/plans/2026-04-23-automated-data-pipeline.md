# Automated Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the EV-vs-gasoline tool's hardcoded state data with a scheduled pipeline that refreshes AAA EV charging, EIA residential electricity, and NUC-scraped AAA gas prices daily, writing a `data.json` the frontend fetches at runtime.

**Architecture:** Node.js 20+ scripts (zero runtime deps, native `fetch`) orchestrated by a daily GitHub Action. The NUC commits `gas-prices.json` to the repo via the GitHub Contents API; the Action reads it from the checkout, fetches the two remote feeds, merges piece-meal against the previous `data.json`, validates per-feed, and commits the result only on real changes. The frontend (`index.html`) fetches `data.json` + `ev-database.json` at load and populates the existing global data objects before rendering.

**Tech Stack:** Node.js 20 (native `fetch`, `node:test`, `node:assert`, `structuredClone`), GitHub Actions, GitHub Contents API, Python 3 / `requests` on the NUC, D3.js (existing frontend, unchanged), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-04-22-automated-data-pipeline-design.md`

**Repo:** https://github.com/iandmuir/evs-vs-gasoline — all file paths below are relative to this repo's root unless noted.

---

## File structure

Files created or modified in this plan:

**Scripts (pipeline):**
- `package.json` — engines pin, `update` and `test` scripts, no runtime deps
- `scripts/lib/states.js` — canonical 51 state names + abbr↔name maps
- `scripts/lib/validate.js` — shape/coverage/range helpers
- `scripts/lib/merge.js` — piece-meal merge + `statesChanged` diff
- `scripts/feeds/gas-local.js` — reads `gas-prices.json` from checkout
- `scripts/feeds/aaa-ev.js` — Google Sheets API
- `scripts/feeds/eia.js` — EIA v2 API
- `scripts/update-data.js` — orchestrator
- `scripts/test/*.test.js` — one test file per lib/feed

**Data files:**
- `data.json` — pipeline output (seeded once, then rewritten daily)
- `gas-prices.json` — NUC output (seeded once, then rewritten by NUC)
- `ev-database.json` — static, committed once

**Workflow:**
- `.github/workflows/update-data.yml` — daily cron + manual dispatch

**Frontend:**
- `index.html` — bootstrap shim populates old globals from fetched JSON

**NUC side (lives outside this repo, on the NUC at `/opt/scrape_gas/`):**
- `scrape_gas.py` — modified to emit full UTC timestamp and commit via GitHub API
- `/opt/scrape_gas/.env` — holds `GITHUB_TOKEN`, `GITHUB_REPO`

Each file has one responsibility: feeds only fetch+validate+normalize, `merge.js` only merges, `update-data.js` only orchestrates, `states.js` only knows state names. Tests live beside what they test in `scripts/test/`.

---

## Task 1: Repo scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `scripts/test/.gitkeep`

- [ ] **Step 1: Verify you're in the repo root**

Run: `git rev-parse --show-toplevel && ls`
Expected: path ends in `/evs-vs-gasoline`; listing includes existing HTML file.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "evs-vs-gasoline",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "update": "node scripts/update-data.js",
    "test": "node --test scripts/test"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.env
.DS_Store
*.log
```

- [ ] **Step 4: Create test directory placeholder**

Run: `mkdir -p scripts/test scripts/lib scripts/feeds && touch scripts/test/.gitkeep`
Expected: directories exist.

- [ ] **Step 5: Verify Node version**

Run: `node --version`
Expected: `v20.x.x` or higher. If older, install/update Node 20 before continuing.

- [ ] **Step 6: Verify `node --test` works**

Run: `node --test scripts/test`
Expected: `tests 0`, exit 0 (no tests yet — confirms runner is wired).

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore scripts/test/.gitkeep
git commit -m "chore: scaffold Node pipeline skeleton"
```

---

## Task 2: `scripts/lib/states.js` — canonical state registry

**Files:**
- Create: `scripts/lib/states.js`
- Create: `scripts/test/states.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/test/states.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/states.test.js`
Expected: FAIL — cannot find module `../lib/states.js`.

- [ ] **Step 3: Write `scripts/lib/states.js`**

```js
// Canonical list of 51 U.S. state-equivalents the pipeline tracks.
// Ordered alphabetically. Keys in data.json.states MUST match these exactly.
export const STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California",
  "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana",
  "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
  "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin",
  "Wyoming"
];

export const ABBR_TO_NAME = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

export const NAME_TO_ABBR = Object.fromEntries(
  Object.entries(ABBR_TO_NAME).map(([abbr, name]) => [name, abbr])
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test/states.test.js`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/states.js scripts/test/states.test.js
git commit -m "feat(lib): canonical state registry"
```

---

## Task 3: `scripts/lib/validate.js` — reusable validators

**Files:**
- Create: `scripts/lib/validate.js`
- Create: `scripts/test/validate.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/validate.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `scripts/lib/validate.js`**

```js
// Validation helpers shared across feeds. Every failure throws
// RejectedFeedError; callers catch and convert to a { status: "reject" }
// result so one bad feed doesn't poison the rest.

export class RejectedFeedError extends Error {
  constructor(feed, reason) {
    super(`[${feed}] ${reason}`);
    this.name = "RejectedFeedError";
    this.feed = feed;
    this.reason = reason;
  }
}

export function assertCoverage(coveredSet, minCount, feed) {
  if (coveredSet.size < minCount) {
    throw new RejectedFeedError(
      feed,
      `coverage too low: ${coveredSet.size} < ${minCount}`
    );
  }
}

export function assertRange(values, min, max, label) {
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new RejectedFeedError(
        label.split(".")[0],
        `${label}: non-finite value (${v})`
      );
    }
    if (v < min || v > max) {
      throw new RejectedFeedError(
        label.split(".")[0],
        `${label}: ${v} outside [${min}, ${max}]`
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/validate.test.js`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/validate.js scripts/test/validate.test.js
git commit -m "feat(lib): validation helpers with RejectedFeedError"
```

---

## Task 4: `scripts/lib/merge.js` — piece-meal merge + diff

**Files:**
- Create: `scripts/lib/merge.js`
- Create: `scripts/test/merge.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/merge.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `scripts/lib/merge.js`**

```js
// Piece-meal merge: successful feeds overwrite their target block +
// stamp updated/source. Rejected feeds contribute nothing. meta is
// untouched here — the orchestrator stamps meta only when a write
// will actually happen, so no-op runs produce zero commits.

export function merge(prev, feedResults, now) {
  const next = structuredClone(prev);
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  for (const feed of feedResults) {
    if (feed.status !== "ok") continue;
    for (const [stateName, newBlock] of Object.entries(feed.stateBlocks)) {
      if (!next.states[stateName]) continue; // unknown state → skip
      next.states[stateName][feed.targetKey] = {
        ...newBlock,
        updated: today,
        source: feed.sourceLabel
      };
    }
  }
  return next;
}

// Compare only the states subtree; meta changes don't count as real changes.
export function statesChanged(prev, next) {
  return JSON.stringify(prev.states) !== JSON.stringify(next.states);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/merge.test.js`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/merge.js scripts/test/merge.test.js
git commit -m "feat(lib): piece-meal merge with meta-preserving diff"
```

---

## Task 5: `scripts/feeds/gas-local.js` — read NUC-committed gas prices

**Files:**
- Create: `scripts/feeds/gas-local.js`
- Create: `scripts/test/gas-local.test.js`
- Create: `scripts/test/fixtures/gas-prices.valid.json`
- Create: `scripts/test/fixtures/gas-prices.stale.json`
- Create: `scripts/test/fixtures/gas-prices.dateonly.json`

- [ ] **Step 1: Create a valid fixture**

`scripts/test/fixtures/gas-prices.valid.json`:

```json
{
  "updated": "__UPDATED__",
  "source": "AAA",
  "states": [
    { "state": "Alabama", "gas_regular": 3.676, "gas_mid": 4.098, "gas_premium": 4.501, "gas_diesel": 5.248 },
    { "state": "Alaska", "gas_regular": 3.900, "gas_mid": 4.200, "gas_premium": 4.500, "gas_diesel": 4.800 }
  ]
}
```

(The test will rewrite `__UPDATED__` at runtime with a fresh timestamp so it doesn't bit-rot.)

- [ ] **Step 2: Create a stale fixture**

`scripts/test/fixtures/gas-prices.stale.json`:

```json
{
  "updated": "2020-01-01T00:00:00+00:00",
  "source": "AAA",
  "states": [
    { "state": "Alabama", "gas_regular": 3.00, "gas_mid": 3.30, "gas_premium": 3.60, "gas_diesel": 3.90 }
  ]
}
```

- [ ] **Step 3: Create a date-only-timestamp fixture**

`scripts/test/fixtures/gas-prices.dateonly.json`:

```json
{
  "updated": "2026-04-22",
  "source": "AAA",
  "states": [
    { "state": "Alabama", "gas_regular": 3.00, "gas_mid": 3.30, "gas_premium": 3.60, "gas_diesel": 3.90 }
  ]
}
```

- [ ] **Step 4: Write the failing test**

`scripts/test/gas-local.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { fetchGasLocal } from "../feeds/gas-local.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function writeFixtureWithFreshTimestamp(srcPath, destPath, isoOverride) {
  const raw = JSON.parse(await readFile(srcPath, "utf8"));
  if (raw.updated === "__UPDATED__") {
    raw.updated = isoOverride ?? new Date().toISOString();
  }
  await writeFile(destPath, JSON.stringify(raw, null, 2));
}

test("fetchGasLocal returns ok for a valid fresh file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gas-"));
  const file = join(dir, "gas-prices.json");
  await writeFixtureWithFreshTimestamp(
    join(__dirname, "fixtures/gas-prices.valid.json"),
    file
  );
  const res = await fetchGasLocal(file);
  assert.equal(res.status, "ok");
  assert.equal(res.targetKey, "gasPrices");
  assert.equal(res.sourceLabel, "AAA");
  assert.equal(res.stateBlocks.Alabama.regular, 3.676);
  assert.equal(res.stateBlocks.Alabama.midGrade, 4.098);
  assert.equal(res.stateBlocks.Alabama.premium, 4.501);
  assert.equal(res.stateBlocks.Alabama.diesel, 5.248);
  await rm(dir, { recursive: true });
});

test("fetchGasLocal rejects when timestamp is stale (>36h)", async () => {
  const res = await fetchGasLocal(
    join(__dirname, "fixtures/gas-prices.stale.json")
  );
  assert.equal(res.status, "reject");
  assert.match(res.reason, /stale|freshness/i);
});

test("fetchGasLocal rejects date-only timestamp", async () => {
  const res = await fetchGasLocal(
    join(__dirname, "fixtures/gas-prices.dateonly.json")
  );
  assert.equal(res.status, "reject");
  assert.match(res.reason, /timestamp|date-only/i);
});

test("fetchGasLocal rejects when file missing", async () => {
  const res = await fetchGasLocal("/definitely/does/not/exist.json");
  assert.equal(res.status, "reject");
});

test("fetchGasLocal rejects out-of-range price", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gas-"));
  const file = join(dir, "gas-prices.json");
  await writeFile(file, JSON.stringify({
    updated: new Date().toISOString(),
    source: "AAA",
    states: [
      { state: "Alabama", gas_regular: 99.99, gas_mid: 3.3, gas_premium: 3.6, gas_diesel: 3.9 }
    ]
  }));
  const res = await fetchGasLocal(file);
  assert.equal(res.status, "reject");
  assert.match(res.reason, /outside|range/i);
  await rm(dir, { recursive: true });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `node --test scripts/test/gas-local.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 6: Write `scripts/feeds/gas-local.js`**

```js
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
```

- [ ] **Step 7: Add full-coverage fixture data**

The test only supplies 2 states, but the feed requires ≥50. Update `scripts/test/fixtures/gas-prices.valid.json` to include all 51 states. Generate by hand or with a one-shot Node snippet — here's the snippet (copy/paste into terminal, it writes the fixture for you):

Run:
```bash
node -e '
import("./scripts/lib/states.js").then(({ STATE_NAMES }) => {
  const payload = {
    updated: "__UPDATED__",
    source: "AAA",
    states: STATE_NAMES.map(s => ({
      state: s, gas_regular: 3.50, gas_mid: 3.80, gas_premium: 4.10, gas_diesel: 4.40
    }))
  };
  require("fs").writeFileSync(
    "scripts/test/fixtures/gas-prices.valid.json",
    JSON.stringify(payload, null, 2) + "\n"
  );
});
'
```

Expected: `scripts/test/fixtures/gas-prices.valid.json` now has 51 state entries with `updated: "__UPDATED__"`.

- [ ] **Step 8: Update the coverage-sensitive test to accept the 51-state fixture**

The first test (`returns ok for a valid fresh file`) still works — it just asserts Alabama's values, which are still there. But you need to also assert Alabama's price is what the regenerated fixture now contains (3.50). Edit that test's assertions to:

```js
assert.equal(res.stateBlocks.Alabama.regular, 3.50);
assert.equal(res.stateBlocks.Alabama.midGrade, 3.80);
assert.equal(res.stateBlocks.Alabama.premium, 4.10);
assert.equal(res.stateBlocks.Alabama.diesel, 4.40);
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test scripts/test/gas-local.test.js`
Expected: all 5 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/feeds/gas-local.js scripts/test/gas-local.test.js scripts/test/fixtures/
git commit -m "feat(feeds): gas-local reads NUC-committed gas-prices.json"
```

---

## Task 6: `scripts/feeds/aaa-ev.js` — Google Sheets EV charging

**Files:**
- Create: `scripts/feeds/aaa-ev.js`
- Create: `scripts/test/aaa-ev.test.js`
- Create: `scripts/test/fixtures/aaa-ev.valid.json`

- [ ] **Step 1: Create the valid fixture**

Generate `scripts/test/fixtures/aaa-ev.valid.json` (shape of the Sheets API response). Run:

```bash
node -e '
import("./scripts/lib/states.js").then(({ NAME_TO_ABBR, STATE_NAMES }) => {
  const values = [
    ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"]
  ];
  for (const name of STATE_NAMES) {
    values.push([
      "id1","AAA loc",NAME_TO_ABBR[name],"EV","10","0.43"
    ]);
  }
  require("fs").writeFileSync(
    "scripts/test/fixtures/aaa-ev.valid.json",
    JSON.stringify({ range: "Sheet1!A:F", majorDimension: "ROWS", values }, null, 2) + "\n"
  );
});
'
```

Expected: fixture file with 52 rows (1 header + 51 states), every row has `ev_costperkwh=0.43`.

- [ ] **Step 2: Write the failing test**

`scripts/test/aaa-ev.test.js`:

```js
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

test("parseAaaEvResponse rejects out-of-range price", () => {
  const res = parseAaaEvResponse({
    values: [
      ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"],
      ...Array(51).fill(0).map((_, i) => ["1","x","AL","EV","5","5.00"])
    ]
  });
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

test("parseAaaEvResponse averages multiple rows per state", () => {
  const rows = [
    ["LOCATION_ID","LOCATION_NAME","LOCATION_STATE","LOCATION_TYPE","ev_totalchargers","ev_costperkwh"]
  ];
  // 51 states, each with 2 rows: 0.40 and 0.50 → avg 0.45
  const { NAME_TO_ABBR, STATE_NAMES } = await import("../lib/states.js");
  for (const name of STATE_NAMES) {
    rows.push(["1","x",NAME_TO_ABBR[name],"EV","5","0.40"]);
    rows.push(["2","y",NAME_TO_ABBR[name],"EV","5","0.50"]);
  }
  const res = parseAaaEvResponse({ values: rows });
  assert.equal(res.status, "ok");
  assert.ok(Math.abs(res.stateBlocks.Alabama.usdPerKwh - 0.45) < 1e-9);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/test/aaa-ev.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write `scripts/feeds/aaa-ev.js`**

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/test/aaa-ev.test.js`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/feeds/aaa-ev.js scripts/test/aaa-ev.test.js scripts/test/fixtures/aaa-ev.valid.json
git commit -m "feat(feeds): AAA EV charging via Google Sheets"
```

---

## Task 7: `scripts/feeds/eia.js` — EIA v2 residential electricity

**Files:**
- Create: `scripts/feeds/eia.js`
- Create: `scripts/test/eia.test.js`
- Create: `scripts/test/fixtures/eia.valid.json`

- [ ] **Step 1: Create the valid fixture**

Generate `scripts/test/fixtures/eia.valid.json` mimicking the EIA v2 response shape. Run:

```bash
node -e '
import("./scripts/lib/states.js").then(({ NAME_TO_ABBR, STATE_NAMES }) => {
  const data = [];
  for (const name of STATE_NAMES) {
    // Two months; Feb is more recent. Pipeline should pick Feb.
    data.push({ period: "2026-02", stateid: NAME_TO_ABBR[name], price: 16.06 });
    data.push({ period: "2026-01", stateid: NAME_TO_ABBR[name], price: 15.80 });
  }
  require("fs").writeFileSync(
    "scripts/test/fixtures/eia.valid.json",
    JSON.stringify({
      response: {
        data,
        description: "Electric Power Monthly Table 5.6.A",
        "units": "cents per kilowatthour"
      }
    }, null, 2) + "\n"
  );
});
'
```

Expected: `scripts/test/fixtures/eia.valid.json` with 102 rows (51 states × 2 months).

- [ ] **Step 2: Write the failing test**

`scripts/test/eia.test.js`:

```js
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

test("parseEiaResponse rejects out-of-range cents", () => {
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/test/eia.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write `scripts/feeds/eia.js`**

```js
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
    // Unit guard. EIA reports the unit in response.units or response.data[i].units;
    // prefer response.units when present.
    const units = resp.units || (resp.data[0] && resp.data[0].units) || "";
    if (!/cents per kilowatthour/i.test(units)) {
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/test/eia.test.js`
Expected: all 5 tests PASS.

- [ ] **Step 6: Run the full suite to catch cross-task breakage**

Run: `npm test`
Expected: all previous tests still pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/feeds/eia.js scripts/test/eia.test.js scripts/test/fixtures/eia.valid.json
git commit -m "feat(feeds): EIA v2 residential with staggered-period bucketing"
```

---

## Task 8: `scripts/update-data.js` — orchestrator

**Files:**
- Create: `scripts/update-data.js`
- Create: `scripts/test/update-data.test.js`

- [ ] **Step 1: Write the failing test**

The orchestrator is integration-flavored. Test it by writing a temp `prev-data.json`, a temp `gas-prices.json`, stubbing the two network feeds via function injection, running the orchestrator, and asserting the resulting `next-data.json`.

`scripts/test/update-data.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
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
  const gasPath = join(dir, "gas-prices.json");
  await writeFile(prevPath, JSON.stringify(seedPrev()));
  await writeFile(gasPath, "unused"); // orchestrator uses stubs, not the file

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
  const mtimeBefore = (await import("node:fs")).statSync(prevPath).mtimeMs;

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
  const mtimeAfter = (await import("node:fs")).statSync(prevPath).mtimeMs;
  assert.equal(exitCode, 0);
  assert.equal(mtimeBefore, mtimeAfter, "file should not be rewritten");
  await rm(dir, { recursive: true });
});

test("runPipeline returns exit 1 when all feeds reject AND data is >3 days stale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const prevPath = join(dir, "data.json");
  const prev = seedPrev();
  // All feed updated dates are 2026-04-10; 'now' is 2026-04-20 (10 days later)
  await writeFile(prevPath, JSON.stringify(prev));

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/update-data.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `scripts/update-data.js`**

```js
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { merge, statesChanged } from "./lib/merge.js";
import { fetchGasLocal } from "./feeds/gas-local.js";
import { fetchAaaEv } from "./feeds/aaa-ev.js";
import { fetchEia } from "./feeds/eia.js";

const DEFAULT_DATA_PATH = "data.json";
const STALE_ALARM_DAYS = 3;

// Exported for tests. `feeds` is an array of async functions returning
// { status, name, targetKey?, sourceLabel?, stateBlocks? } | { status:"reject", name, reason }.
export async function runPipeline({
  dataPath = DEFAULT_DATA_PATH,
  now = new Date(),
  feeds,
  log = console.log
} = {}) {
  const prev = JSON.parse(await readFile(dataPath, "utf8"));

  const results = await Promise.all(feeds.map(f => f()));
  for (const r of results) {
    if (r.status === "ok") {
      const count = Object.keys(r.stateBlocks).length;
      log(`[${r.name}] OK — ${count} states`);
    } else {
      log(`[${r.name}] REJECTED — ${r.reason}`);
    }
  }

  const next = merge(prev, results, now);

  if (!statesChanged(prev, next)) {
    // No-op run: don't bump meta, don't rewrite file, but still decide
    // whether to alarm on all-feeds-broken-for->3-days.
    const allRejected = results.every(r => r.status !== "ok");
    if (allRejected && isEverythingStale(next, now, STALE_ALARM_DAYS)) {
      log(`[orchestrator] ALARM: all feeds rejected AND data is >${STALE_ALARM_DAYS} days stale`);
      return 1;
    }
    log("[orchestrator] no changes");
    return 0;
  }

  next.meta = {
    ...next.meta,
    generatedAt: now.toISOString(),
    feedsRefreshedThisRun: results.filter(r => r.status === "ok").map(r => r.name)
  };

  const serialized = JSON.stringify(next, null, 2) + "\n";
  await writeFile(dataPath, serialized);
  log(`[orchestrator] wrote ${dataPath}`);
  return 0;
}

function isEverythingStale(data, now, days) {
  const cutoffMs = now.getTime() - days * 86400 * 1000;
  for (const s of Object.values(data.states)) {
    for (const key of ["gasPrices", "evChargingPublic", "elecResidential"]) {
      const upd = s[key] && s[key].updated;
      if (!upd) continue;
      // updated is YYYY-MM-DD; parse as UTC midnight of that day.
      const t = Date.parse(upd + "T00:00:00Z");
      if (Number.isFinite(t) && t >= cutoffMs) return false;
    }
  }
  return true;
}

// Entrypoint when invoked directly via `node scripts/update-data.js`.
if (import.meta.url === `file://${process.argv[1]}` ||
    fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await runPipeline({
    feeds: [
      () => fetchGasLocal("gas-prices.json"),
      () => fetchAaaEv(),
      () => fetchEia()
    ]
  });
  process.exit(code);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/update-data.test.js`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: everything still passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-data.js scripts/test/update-data.test.js
git commit -m "feat: orchestrator with piece-meal merge, no-op skip, 3-day alarm"
```

---

## Task 9: Seed `data.json`, `ev-database.json`, and initial `gas-prices.json`

**Files:**
- Create: `data.json`
- Create: `ev-database.json`
- Create: `gas-prices.json`
- Create: `scripts/seed/build-seed.mjs` (throwaway; delete after run)

The seed is generated from the current hardcoded values inside `EV-vs-ICE-vApr2.html`. The script pulls them out by sourcing the HTML, evaluating the `<script>`-level `const` declarations in a sandboxed Node context, and emitting JSON.

- [ ] **Step 1: Copy the existing HTML into the repo**

The working HTML (the one with the CO₂ Map) currently lives at
`C:\Users\IanDM\My Drive\Personal\Claude Projects\EV Charging vs Gasoline\EV-vs-ICE-vApr2.html`.
Copy it to the repo root as `index.html`:

```bash
cp "../EV Charging vs Gasoline/EV-vs-ICE-vApr2.html" ./index.html
```

(Adjust path based on your shell / actual checkout location. End result: the repo contains a working `index.html` that still has its inline data.)

- [ ] **Step 2: Commit the copy before modifying it**

```bash
git add index.html
git commit -m "chore: import current EV-vs-ICE tool as index.html"
```

This preserves a known-good baseline before the refactor.

- [ ] **Step 3: Write `scripts/seed/build-seed.mjs`**

This script uses regex extraction (not `vm` — too brittle) to pull the five data objects out of the HTML as text, then `eval`s them in a restricted context. The extracted object names are: `elecHomeData` (cents/kWh), `evPublicData` ($/kWh), `gasData` (object per state), `gridCO2Data` (g/kWh), `evDatabase` (nested model→year→Wh/mi).

```js
// Usage: node scripts/seed/build-seed.mjs
// Reads ./index.html, extracts the five inline data objects, emits
// data.json (seed) and ev-database.json.

import { readFile, writeFile } from "node:fs/promises";
import { STATE_NAMES, NAME_TO_ABBR } from "../lib/states.js";

const html = await readFile("index.html", "utf8");

function extractObjectLiteral(source, varName) {
  // Match: const varName = { ... };  or  let/var
  // Greedy-but-balanced: find the first `{` after the name, then track braces.
  const declRe = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*`);
  const m = declRe.exec(source);
  if (!m) throw new Error(`${varName} declaration not found`);
  let i = m.index + m[0].length;
  if (source[i] !== "{") throw new Error(`${varName} not an object literal`);
  let depth = 0;
  const start = i;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const body = source.slice(start, i);
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${body});`)();
}

const elecHomeData = extractObjectLiteral(html, "elecHomeData");
const evPublicData = extractObjectLiteral(html, "evPublicData");
const gasData      = extractObjectLiteral(html, "gasData");
const gridCO2Data  = extractObjectLiteral(html, "gridCO2Data");
const evDatabase   = extractObjectLiteral(html, "evDatabase");

const today = new Date().toISOString().slice(0, 10);

const states = {};
for (const name of STATE_NAMES) {
  const gd = gasData[name] || {};
  states[name] = {
    stateCode: NAME_TO_ABBR[name],
    gasPrices: {
      regular: gd.Regular ?? null,
      midGrade: gd["Mid-Grade"] ?? null,
      premium: gd.Premium ?? null,
      diesel: gd.Diesel ?? null,
      updated: today,
      source: "seed"
    },
    evChargingPublic: {
      usdPerKwh: evPublicData[name] ?? null,
      updated: today,
      source: "seed"
    },
    elecResidential: {
      // elecHomeData is cents/kWh; convert to $/kWh.
      usdPerKwh: elecHomeData[name] != null ? elecHomeData[name] / 100 : null,
      period: null,
      updated: today,
      source: "seed"
    },
    gridCo2: {
      gCo2PerKwh: gridCO2Data[name] ?? null,
      year: 2025,
      source: "Ember"
    }
  };
}

const dataJson = {
  meta: {
    generatedAt: new Date().toISOString(),
    pipelineVersion: "1.0.0",
    feedsRefreshedThisRun: []
  },
  constants: {
    gasolineKgCo2PerGallon: 8.887,
    chargingEfficiency: 0.9
  },
  states
};

await writeFile("data.json", JSON.stringify(dataJson, null, 2) + "\n");
await writeFile("ev-database.json", JSON.stringify(evDatabase, null, 2) + "\n");

// Hand-seed an initial gas-prices.json from gasData so the pipeline can run
// before the NUC has published its first commit.
const gasPricesSeed = {
  updated: new Date().toISOString(),
  source: "AAA",
  states: STATE_NAMES.map(name => {
    const gd = gasData[name] || {};
    return {
      state: name,
      gas_regular: gd.Regular ?? null,
      gas_mid: gd["Mid-Grade"] ?? null,
      gas_premium: gd.Premium ?? null,
      gas_diesel: gd.Diesel ?? null
    };
  })
};
await writeFile("gas-prices.json", JSON.stringify(gasPricesSeed, null, 2) + "\n");

console.log("Seeded data.json, ev-database.json, gas-prices.json");
```

- [ ] **Step 4: Run the seed script**

Run: `node scripts/seed/build-seed.mjs`
Expected: stdout `Seeded data.json, ev-database.json, gas-prices.json`.

- [ ] **Step 5: Verify the seed**

Run:
```bash
node -e "const d = require('./data.json'); console.log(Object.keys(d.states).length); console.log(d.states.Alabama);"
```
Expected: prints `51`, followed by Alabama's full block with non-null `regular`, `usdPerKwh`, etc.

- [ ] **Step 6: Smoke-test the orchestrator end-to-end against the seed**

Run:
```bash
node -e "
import('./scripts/update-data.js').then(async m => {
  const code = await m.runPipeline({
    feeds: [
      () => import('./scripts/feeds/gas-local.js').then(x => x.fetchGasLocal('gas-prices.json')),
      async () => ({ status: 'reject', name: 'aaaEv', reason: 'skipped in smoke test' }),
      async () => ({ status: 'reject', name: 'eiaResidential', reason: 'skipped in smoke test' })
    ]
  });
  process.exit(code);
});
"
```
Expected: logs `[gas] OK — 51 states`, two REJECTED lines, and either `wrote data.json` (if values differ) or `no changes`.

- [ ] **Step 7: Delete the seed script**

The seed is a one-off. Remove it:

```bash
rm -rf scripts/seed
```

- [ ] **Step 8: Commit seeds**

```bash
git add data.json ev-database.json gas-prices.json
git commit -m "data: seed data.json, ev-database.json, and initial gas-prices.json"
```

---

## Task 10: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/update-data.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Update data

on:
  schedule:
    - cron: "0 13 * * *"        # 13:00 UTC daily
  workflow_dispatch: {}          # manual trigger for testing

permissions:
  contents: write                # needed to commit data.json

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run tests
        run: npm test

      - name: Run pipeline
        env:
          EIA_API_KEY: ${{ secrets.EIA_API_KEY }}
          AAA_SHEETS_API_KEY: ${{ secrets.AAA_SHEETS_API_KEY }}
        run: npm run update

      - name: Commit changes (if any)
        run: |
          git config user.name  "evs-data-bot"
          git config user.email "evs-data-bot@users.noreply.github.com"
          if git diff --quiet data.json; then
            echo "No changes"
            exit 0
          fi
          git add data.json
          git commit -m "data: daily refresh $(date -u +%F)"
          git push
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/update-data.yml
git commit -m "ci: daily pipeline workflow with test gate"
```

- [ ] **Step 3: Add the secrets in GitHub**

Manual step (cannot be automated — secrets go in the web UI):

1. Open: `https://github.com/iandmuir/evs-vs-gasoline/settings/secrets/actions`
2. Click **New repository secret**.
3. Name: `EIA_API_KEY`. Value: the key from https://www.eia.gov/opendata/ (register if needed).
4. Click **New repository secret** again.
5. Name: `AAA_SHEETS_API_KEY`. Value: `AIzaSyB6scf9i9c1kA7ZLvw4SAMLSFCvWhKc0Eo` (the key AAA already exposes in their frontend).

Expected: both secrets appear in the list (values hidden).

- [ ] **Step 4: Trigger the workflow manually to smoke-test**

Manual step:
1. Push the branch.
2. Open: `https://github.com/iandmuir/evs-vs-gasoline/actions/workflows/update-data.yml`
3. Click **Run workflow** → **Run workflow**.
4. Watch the run. Expected: green. Logs show `[gas] OK`, `[aaaEv] OK`, `[eiaResidential] OK` (or reasonable REJECTED with reason if a key is missing).

---

## Task 11: Frontend refactor — fetch `data.json` at load

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Read `index.html` and locate the three inline data blocks**

Run: `grep -n "const elecHomeData\|const evPublicData\|const gasData\|const gridCO2Data\|const evDatabase" index.html`
Expected: five line numbers. Note the starting line of `const elecHomeData` (call it `L1`) and the ending line of `const evDatabase` (call it `L2`).

- [ ] **Step 2: Replace the five inline constants with empty `let` declarations**

Edit `index.html`. Find:

```js
const elecHomeData = { ... };
const evPublicData = { ... };
const gasData = { ... };
const gridCO2Data = { ... };
const evDatabase = { ... };
```

Replace with:

```js
let elecHomeData = {};
let evPublicData = {};
let gasData = {};
let gridCO2Data = {};
let evDatabase = {};
```

(The data will be populated by `bootstrap()` below.)

- [ ] **Step 3: Wrap the existing top-level D3 / init code in an `initApp()` function**

Find the block that currently runs at script top level (the D3 `ready()` call, tab wiring, etc.). Locate its opening line and its closing `}`. Wrap it:

```js
function initApp() {
  // ...existing top-level rendering code, unchanged...
}
```

Do not modify anything inside `initApp`'s body.

- [ ] **Step 4: Add the bootstrap function + loader/error UI**

Just before `initApp` is defined (or at the end of the script block — anywhere in scope works), add:

```js
function showErrorState(err) {
  console.error(err);
  const el = document.getElementById("map-container");
  if (el) {
    el.innerHTML =
      '<div style="padding:2rem;text-align:center;color:#666;">' +
      "Couldn't load the latest data. Try reloading." +
      "</div>";
  }
}

function hideLoader() {
  const el = document.getElementById("data-loader");
  if (el) el.remove();
}

async function bootstrap() {
  try {
    const [dataRes, evRes] = await Promise.all([
      fetch("./data.json", { cache: "no-cache" }),
      fetch("./ev-database.json", { cache: "no-cache" })
    ]);
    if (!dataRes.ok || !evRes.ok) {
      throw new Error(`Data fetch failed: data=${dataRes.status}, ev=${evRes.status}`);
    }
    const data = await dataRes.json();
    evDatabase = await evRes.json();

    for (const [state, blk] of Object.entries(data.states)) {
      elecHomeData[state] = blk.elecResidential.usdPerKwh != null
        ? blk.elecResidential.usdPerKwh * 100  // convert $/kWh -> ¢/kWh for the UI's existing math
        : null;
      evPublicData[state] = blk.evChargingPublic.usdPerKwh;
      gasData[state] = {
        Regular: blk.gasPrices.regular,
        "Mid-Grade": blk.gasPrices.midGrade,
        Premium: blk.gasPrices.premium,
        Diesel: blk.gasPrices.diesel
      };
      gridCO2Data[state] = blk.gridCo2.gCo2PerKwh;
    }

    hideLoader();
    initApp();
  } catch (err) {
    showErrorState(err);
  }
}

bootstrap();
```

- [ ] **Step 5: Add a simple inline loader to the map container**

Find the `<div id="map-container">` (or whatever the existing container is — confirm the id) and insert, as its first child:

```html
<div id="data-loader" style="padding:2rem;text-align:center;color:#888;">Loading data…</div>
```

- [ ] **Step 6: Verify locally**

Start a static server in the repo root and open the page:

```bash
npx --yes serve . -l 8080
```

Then browse to `http://localhost:8080`. Expected: "Loading data…" appears briefly, then the map renders exactly as before.

- [ ] **Step 7: Verify error path**

Rename `data.json` temporarily (`mv data.json data.json.bak`), reload the page. Expected: "Couldn't load the latest data. Try reloading." banner, tabs still visible. Restore the file (`mv data.json.bak data.json`).

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(frontend): fetch data.json + ev-database.json at load"
```

---

## Task 12: Enable GitHub Pages + verify live

- [ ] **Step 1: Push all commits to GitHub**

```bash
git push -u origin main
```

- [ ] **Step 2: Enable Pages**

Manual step:
1. Open `https://github.com/iandmuir/evs-vs-gasoline/settings/pages`
2. **Source:** Deploy from a branch.
3. **Branch:** `main`, `/ (root)`. Save.
4. Wait 1–2 minutes. A green banner should show: *"Your site is live at https://iandmuir.github.io/evs-vs-gasoline/"*.

- [ ] **Step 3: Visit the live URL**

Open `https://iandmuir.github.io/evs-vs-gasoline/` in a browser.
Expected: the tool loads and renders the maps. Open DevTools → Network; confirm `data.json` and `ev-database.json` both 200 (or 304 on reload).

---

## Task 13: NUC scraper — add timestamp + commit via GitHub API

**Files (on the NUC, not in the repo):**
- Modify: `/opt/scrape_gas/scrape_gas.py`
- Create: `/opt/scrape_gas/.env`
- Modify: the NUC's crontab (`crontab -e`)

- [ ] **Step 1: Generate a fine-grained PAT**

Manual step:
1. Open: `https://github.com/settings/personal-access-tokens/new`
2. **Token name:** `evs-vs-gasoline-nuc-scraper`
3. **Expiration:** **No expiration** (per spec §12.1 — eliminates silent-failure from missed rotation).
4. **Resource owner:** your account.
5. **Repository access:** "Only select repositories" → `iandmuir/evs-vs-gasoline`.
6. **Permissions → Repository permissions → Contents:** Read and write. Leave all others at "No access".
7. Click **Generate token**. Copy the token (starts with `github_pat_...`).

- [ ] **Step 2: Create `/opt/scrape_gas/.env` on the NUC**

SSH into the NUC. Run:

```bash
sudo tee /opt/scrape_gas/.env > /dev/null <<'EOF'
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxx_REPLACE_ME
GITHUB_REPO=iandmuir/evs-vs-gasoline
EOF
sudo chown scrape_gas:scrape_gas /opt/scrape_gas/.env  # or whatever user runs the scraper
sudo chmod 600 /opt/scrape_gas/.env
```

Replace `REPLACE_ME` with the token from Step 1.

- [ ] **Step 3: Back up the current scraper**

```bash
sudo cp /opt/scrape_gas/scrape_gas.py /opt/scrape_gas/scrape_gas.py.bak
```

- [ ] **Step 4: Modify `scrape_gas.py`**

Open `/opt/scrape_gas/scrape_gas.py`. The existing script produces a `rows` list (or whatever variable name; adapt) of dicts with keys `state`, `gas_regular`, `gas_mid`, `gas_premium`, `gas_diesel`, then writes them to a local JSON file. Replace the final "write to disk" block with the following:

```python
import base64
import json
import os
import requests
from datetime import datetime, timezone

# ... existing scraping code produces `rows` list above ...

# IMPORTANT: full UTC timestamp (not date-only). The pipeline's freshness
# gate parses this and computes elapsed hours; a date-only string would
# be parsed as midnight UTC and would falsely trip the 36 h gate after a
# single missed run. See spec §5 for details.
payload = {
    "updated": datetime.now(timezone.utc).isoformat(),
    "source": "AAA",
    "states": rows,
}

new_content = json.dumps(payload, indent=2) + "\n"
b64 = base64.b64encode(new_content.encode("utf-8")).decode("ascii")

token = os.environ["GITHUB_TOKEN"]
repo = os.environ["GITHUB_REPO"]
path = "gas-prices.json"

headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

# 1. Get current sha (required by the API to update an existing file).
r = requests.get(
    f"https://api.github.com/repos/{repo}/contents/{path}",
    headers=headers,
    timeout=30,
)
sha = r.json()["sha"] if r.status_code == 200 else None

# 2. PUT the new content.
body = {
    "message": f"gas prices: daily refresh {payload['updated']}",
    "content": b64,
    "committer": {
        "name": "evs-data-bot",
        "email": "evs-data-bot@users.noreply.github.com",
    },
}
if sha:
    body["sha"] = sha

r = requests.put(
    f"https://api.github.com/repos/{repo}/contents/{path}",
    headers=headers,
    json=body,
    timeout=30,
)
r.raise_for_status()
print(f"Committed gas-prices.json ({r.json()['commit']['sha'][:7]})")
```

(Keep any pre-existing imports; only the output block changes.)

- [ ] **Step 5: Update the crontab to source `.env`**

```bash
crontab -e
```

Change:
```
0 3 * * * /opt/scrape_gas/.venv/bin/python /opt/scrape_gas/scrape_gas.py
```

To:
```
0 3 * * * set -a; . /opt/scrape_gas/.env; set +a; /opt/scrape_gas/.venv/bin/python /opt/scrape_gas/scrape_gas.py >> /var/log/scrape_gas.log 2>&1
```

(`set -a` / `set +a` exports every variable sourced from `.env`.)

- [ ] **Step 6: Manual test the scraper**

```bash
set -a; . /opt/scrape_gas/.env; set +a
/opt/scrape_gas/.venv/bin/python /opt/scrape_gas/scrape_gas.py
```

Expected: stdout `Committed gas-prices.json (abc1234)`. No traceback.

- [ ] **Step 7: Confirm the commit appears in GitHub**

Open `https://github.com/iandmuir/evs-vs-gasoline/commits/main`. Expected: newest commit authored by `evs-data-bot`, message `gas prices: daily refresh 2026-04-23T…`.

- [ ] **Step 8: Verify `gas-prices.json` shape**

Open `https://github.com/iandmuir/evs-vs-gasoline/blob/main/gas-prices.json`. Expected: top-level `"updated"` is a full ISO 8601 timestamp with `T` separator and timezone offset. `states` is an array with ~51 rows.

---

## Task 14: End-to-end verification against success criteria

- [ ] **Step 1: Criterion 1 — three consecutive successful days**

Wait for three cron cycles (or trigger the workflow manually via `workflow_dispatch` three times with real values). Confirm commits appear on each day labeled `data: daily refresh YYYY-MM-DD`, or a "No changes" run when the feeds return identical values.

- [ ] **Step 2: Criterion 2 — live page performance**

Open `https://iandmuir.github.io/evs-vs-gasoline/` with DevTools → Network, disable cache, reload.
Expected: `index.html` loads in <1 s; `data.json` + `ev-database.json` complete within another ~200 ms.

- [ ] **Step 3: Criterion 3 — single-feed failure resilience**

In GitHub secrets, temporarily rename `EIA_API_KEY` (e.g., append `_BROKEN`). Trigger the workflow manually. Expected:
- Run stays green (exit 0).
- Logs show `[eiaResidential] REJECTED — EIA_API_KEY not set` (or HTTP error).
- `data.json` gets a commit; `states.*.elecResidential.updated` is unchanged from the prior run; `gasPrices.updated` and `evChargingPublic.updated` advance to today.

Restore the secret name.

- [ ] **Step 4: Criterion 4 — NUC freshness gate works**

Stop the NUC's cron for a day (or manually set `gas-prices.json`'s `updated` field to a timestamp >36 h in the past via a test commit). Trigger the Actions workflow. Expected:
- Logs show `[gas] REJECTED — stale: 40.0h > 36h` (or similar).
- `states.*.gasPrices.updated` stays at its prior value in `data.json`.

Revert the test change.

- [ ] **Step 5: Criterion 5 — all-feeds-broken > 3 days → red run**

Break all three secrets simultaneously (rename them) AND bump every `updated` field in `data.json` to a date >3 days ago (one-off commit). Trigger the workflow. Expected:
- Pipeline step exits 1.
- Action run is red.
- GitHub emails you.

Restore everything.

- [ ] **Step 6: Final cleanup commit**

After verification, ensure no test-related modifications remain in `data.json`. Run:

```bash
git status
git diff
```

Expected: clean working tree.

---

## Self-review notes (not steps)

**Spec coverage check:**
- §3 architecture — Tasks 8 (orchestrator), 10 (workflow), 11 (frontend), 13 (NUC).
- §4 data sources — Tasks 5, 6, 7 (one feed each).
- §5 schema — Task 9 (seed) + Tasks 5/6/7 produce matching shapes.
- §6 repo layout — Task 1 scaffolds; Tasks 2–8 fill in.
- §7 pipeline behavior + merge — Tasks 4 (merge), 8 (orchestrator), including no-op skip and >3-day alarm.
- §8 validation gates — Tasks 3, 5, 6, 7 (gate specifics per feed).
- §9 frontend refactor — Task 11 (adapter, loader, error state, cache strategy).
- §10 GH Actions workflow — Task 10.
- §11 secrets — Task 10 step 3, Task 13 step 1–2.
- §12 NUC setup — Task 13.
- §13 bootstrapping — Task 9 (seeds) + Task 12 (Pages) + Task 14 (first run).
- §14 monitoring — covered implicitly by red-run email (Task 14 step 5) and the 3-day alarm (Task 8).
- §15 out of scope — no tasks needed.
- §16 risk register — mitigations implemented in validation (Task 3) and NUC PAT scoping (Task 13 step 1).
- §17 success criteria — Task 14 walks through each one.

**Consistency check:** `fetchGasLocal`, `fetchAaaEv`, `fetchEia` — consistent naming. `parseAaaEvResponse`/`parseEiaResponse` — consistent exported-pure-function naming. `targetKey` values `gasPrices`/`evChargingPublic`/`elecResidential` — match data.json schema (§5). `sourceLabel` values `"AAA"`/`"EIA"` — match spec. `statesChanged` used by orchestrator matches export from `merge.js`.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-23-automated-data-pipeline.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
