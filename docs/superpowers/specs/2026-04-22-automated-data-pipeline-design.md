# Automated Data Pipeline Design

**Date:** 2026-04-22
**Status:** Approved — ready for implementation plan
**Repo:** [iandmuir/evs-vs-gasoline](https://github.com/iandmuir/evs-vs-gasoline)

---

## 1. Overview

The EV-vs-gasoline comparison tool currently ships as a single `index.html`
with all data hardcoded as inline JS objects. This spec defines a scheduled
data pipeline that keeps three of those data sources fresh automatically.

The tool becomes a two-file frontend (`index.html` + `data.json`) served by
GitHub Pages, plus a Node.js pipeline running on GitHub Actions that rewrites
`data.json` daily. A third data source (AAA gas prices) is scraped on the
user's local NUC and committed to the repo separately; the pipeline reads it
from the checkout.

## 2. Goals & non-goals

### Goals

- Automate daily refresh of AAA EV charging prices, EIA residential
  electricity prices, and AAA gas prices (via NUC).
- Track freshness per data point so the frontend can flag lagging values.
- Keep the pipeline simple: no build step, zero runtime dependencies, one
  language (Node.js 20+ native `fetch`).
- Preserve the existing UI and its rendering logic unchanged — decoupling
  happens at the data-loading boundary only.
- Fail gracefully: a broken feed leaves the previous values in place, not
  garbage.

### Non-goals (V1)

- Automating the Ember CO₂ intensity dataset (stays as a static 2025
  snapshot).
- Automating the EV efficiency database (~400 models; stays static).
- Live L2-vs-DCFC split for EV charging (AAA source only exposes a blended
  rate).
- A dashboard or alerting system beyond GitHub's default red-build emails.

## 3. Architecture

### Data flow

```
 ┌────────────────┐      daily 3 AM       ┌──────────────────────────────┐
 │  NUC (Proxmox) │ ────────────────────> │  gas-prices.json in the repo │
 │  scrape_gas.py │  GitHub Contents API  │  (committed by the NUC)      │
 └────────────────┘                       └──────────┬───────────────────┘
                                                     │
                                                     │ read from checkout
                                                     │
 ┌────────────────┐      daily 13:00 UTC  ┌──────────▼───────────────────┐
 │ GitHub Actions │ ────────────────────> │  scripts/update-data.js      │
 │     cron       │                       │  ├─ feeds/gas-local.js       │
 └────────────────┘                       │  ├─ feeds/aaa-ev.js          │
                                          │  └─ feeds/eia.js             │
                                          └──────────┬───────────────────┘
                                                     │ merge + validate
                                                     │
                             ┌───────────────────────▼──────────────┐
                             │  data.json  (committed if changed)   │
                             └───────────────────────┬──────────────┘
                                                     │
                                                     │ served by GH Pages
                                                     │
                                          ┌──────────▼─────────────┐
                                          │  index.html fetches    │
                                          │  data.json +           │
                                          │  ev-database.json      │
                                          └────────────────────────┘
```

### Key properties

- **Same-origin:** `index.html`, `data.json`, `ev-database.json`, and
  `gas-prices.json` all live at the repo root and are served by GitHub
  Pages. No CORS configuration needed.
- **Git is the durable store:** every data update is a commit; history is
  automatic and auditable.
- **Decoupled publishing:** the NUC doesn't need to be online when the
  pipeline runs — it publishes asynchronously.
- **Diff-only commits:** the pipeline only commits `data.json` when its
  bytes change, keeping history clean on no-op days.

## 4. Data sources

| Source | Field(s) | Cadence | Fetched by | Status |
|---|---|---|---|---|
| AAA gas prices | regular, mid, premium, diesel $/gal | daily | NUC scraper (HTML) | live |
| AAA EV charging | public $/kWh (blended) | daily | GH Actions (Google Sheets API) | live |
| EIA residential | ¢/kWh by state, monthly | monthly (polled daily) | GH Actions (EIA v2 API) | live |
| Ember grid CO₂ | gCO₂/kWh by state, 2025 | yearly | — | static seed |
| EV efficiency DB | Wh/mi by model/year | — | — | static seed |

### Endpoint details

**AAA EV charging** (Google Sheets API):

- URL: `GET https://sheets.googleapis.com/v4/spreadsheets/1R5Km2MEFBMJoaptRSPbKhJSLCgMcyPEyITFSvAvUdHo/values/Sheet1!A:F?key={AAA_SHEETS_API_KEY}`
- Returned columns: `LOCATION_ID | LOCATION_NAME | LOCATION_STATE | LOCATION_TYPE | ev_totalchargers | ev_costperkwh`.
- Data is keyed by state abbreviation in `LOCATION_STATE`.
- The key is referer-restricted and technically public, but is stored as a
  GitHub Action secret per project policy.

**EIA residential electricity** (EIA v2):

- URL: `GET https://api.eia.gov/v2/electricity/retail-sales/data/`
- Query params: `api_key={EIA_API_KEY}`, `frequency=monthly`,
  `data[0]=price`, `facets[sectorid][]=RES`, `sort[0][column]=period`,
  `sort[0][direction]=desc`, `length=200`.
- No `stateid` facet → all states returned. EIA reporting is staggered, so
  the pipeline buckets by state and picks the row with the highest
  `period` per state.
- Prices arrive in cents/kWh; convert to dollars/kWh before storing.

**AAA gas prices** (NUC-scraped):

- The NUC's `scrape_gas.py` parses
  `https://gasprices.aaa.com/state-gas-price-averages/`, extracts the
  state table, and writes `gas-prices.json` into the repo via the GitHub
  Contents API.
- Pipeline reads the file from its checkout — no HTTP fetch needed.

## 5. JSON schema

### `data.json` (pipeline-managed)

```jsonc
{
  "meta": {
    "generatedAt": "2026-04-22T13:00:00Z",
    "pipelineVersion": "1.0.0",
    "feedsRefreshedThisRun": ["gas", "aaaEv", "eiaResidential"]
  },
  "constants": {
    "gasolineKgCo2PerGallon": 8.887,
    "chargingEfficiency": 0.9
  },
  "states": {
    "Alabama": {
      "stateCode": "AL",
      "gasPrices": {
        "regular": 3.676,
        "midGrade": 4.098,
        "premium": 4.501,
        "diesel": 5.248,
        "updated": "2026-04-22",
        "source": "AAA"
      },
      "evChargingPublic": {
        "usdPerKwh": 0.431,
        "updated": "2026-04-22",
        "source": "AAA"
      },
      "elecResidential": {
        "usdPerKwh": 0.1606,
        "period": "2026-01",
        "updated": "2026-04-22",
        "source": "EIA"
      },
      "gridCo2": {
        "gCo2PerKwh": 359.41,
        "year": 2025,
        "source": "Ember"
      }
    }
    // ...50 more (49 states + DC)
  }
}
```

Per-datapoint freshness: every feed's block carries `updated` (ISO date) and
`source`. Live feeds add source-specific metadata (`period` for EIA).

### `gas-prices.json` (NUC-managed)

```jsonc
{
  "updated": "2026-04-22T07:02:15+00:00",   // ISO 8601, UTC, full timestamp
  "source": "AAA",
  "states": [
    {
      "state": "Alabama",
      "gas_regular": 3.676,
      "gas_mid": 4.098,
      "gas_premium": 4.501,
      "gas_diesel": 5.248
    }
    // ...50 more
  ]
}
```

`updated` **must be a full UTC timestamp**, not a date-only string. A
date-only string (`"2026-04-22"`) is parsed by JavaScript as midnight UTC,
which would cause the 36-hour freshness gate to reject after a single
missed NUC run: if the NUC scrapes at 03:00 UTC on day N, stamps
`"2026-04-22"` (midnight), and then misses day N+1, the pipeline at 13:00
UTC on day N+1 would compute a 37-hour gap and incorrectly reject the
feed. Full timestamps make the math reflect actual elapsed wall-clock
hours. The NUC produces this via
`datetime.now(timezone.utc).isoformat()` (see §12.3).

### `ev-database.json` (static)

```jsonc
{
  "Tesla Model 3 Long Range AWD": { "2022": 260, "2023": 260, "2024": 260, "2025": 260 },
  "Ford F-150 Lightning 4WD": { "2022": 490, "2023": 490, "2024": 490 }
  // ...~400 more
}
```

Committed once on migration; never touched by the pipeline in V1.

## 6. Repository layout

```
evs-vs-gasoline/
├── .github/
│   └── workflows/
│       └── update-data.yml           # cron + job definition
├── scripts/
│   ├── update-data.js                # orchestrator
│   ├── feeds/
│   │   ├── gas-local.js              # reads gas-prices.json from checkout
│   │   ├── aaa-ev.js                 # fetches AAA Google Sheets
│   │   └── eia.js                    # fetches EIA v2 API
│   └── lib/
│       ├── states.js                 # 50+DC canonical names, abbr ↔ name maps
│       ├── validate.js               # shape + coverage + range helpers
│       └── merge.js                  # piece-meal merge with prev data.json
├── data.json                         # pipeline output, committed by Actions
├── gas-prices.json                   # NUC output, committed by NUC
├── ev-database.json                  # static, committed once
├── index.html                        # refactored to fetch JSONs
├── package.json                      # engines.node pin, no runtime deps
└── README.md
```

### `package.json` minimum

```json
{
  "name": "evs-vs-gasoline",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "update": "node scripts/update-data.js"
  }
}
```

No dependencies for V1. Node 20+ native `fetch` covers all feed fetches.

## 7. Pipeline behavior

### Orchestrator flow (`scripts/update-data.js`)

1. Read previous `data.json` from disk. Abort loudly if missing (seed must
   exist).
2. Run all three feeds in parallel via `Promise.allSettled`. Each feed
   function returns either `{ status: "ok", name, stateBlocks }` or
   `{ status: "reject", name, reason }`.
3. Log each feed's outcome to stdout (visible in Action logs).
4. Call `merge(prev, results, new Date())` → `next`. The merger updates
   state-level values and their `updated` fields but does **not** yet
   stamp `meta.generatedAt` or `meta.feedsRefreshedThisRun`.
5. Compare `next` against `prev` ignoring the `meta` block. If every
   `states[*]` subtree is identical, log "no changes" and exit 0. (The
   Action step that commits won't fire, and `meta.generatedAt` does not
   get bumped for a no-op run.)
6. Otherwise, set `next.meta.generatedAt = now.toISOString()` and
   `next.meta.feedsRefreshedThisRun = <names of ok feeds>`. Stringify
   with stable key order + trailing newline. Write the file. Exit 0.
7. If **all feeds rejected** AND the most recent `updated` date across
   every state's live-feed blocks (gas, ev-charging, residential-elec) is
   more than 3 days old, exit 1 so the Action run goes red. In practice:
   compute `max(states[*].{gasPrices,evChargingPublic,elecResidential}.updated)`;
   if `today - max > 3 days`, alarm.

Excluding `meta` from the change-detection comparison is deliberate: a
no-op run should produce zero commits and zero timestamp churn. The
`generatedAt` field only advances on runs that actually change data.

### Merge algorithm (`scripts/lib/merge.js`)

```js
function merge(prev, feedResults, now) {
  const next = structuredClone(prev);
  // NOTE: meta fields are stamped by the orchestrator only if a write
  // will actually happen. merge() leaves prev.meta intact.

  for (const feed of feedResults) {
    if (feed.status !== "ok") continue;

    const today = now.toISOString().slice(0, 10);

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

function statesChanged(prev, next) {
  return JSON.stringify(prev.states) !== JSON.stringify(next.states);
}
```

Rejected feeds contribute nothing to `next` — their values + `updated`
stamps remain as they were.

## 8. Validation gates

Every feed function must pass all applicable gates before its results are
used. Any single gate failure rejects the whole feed for this run.

### `feeds/gas-local.js`

- **Shape:** parsed JSON has top-level `updated` (ISO 8601 **full UTC
  timestamp**, e.g. `"2026-04-22T07:02:15+00:00"`), `states` (array),
  each array element has `state`, `gas_regular`, `gas_mid`,
  `gas_premium`, `gas_diesel`. If `updated` is a date-only string,
  reject the feed (that's a scraper-side mistake — see §5 for why).
- **Freshness:** `Date.now() - Date.parse(updated) < 36 * 3600 * 1000`
  (36 hours in ms). With a full timestamp, the gap is real elapsed
  wall-clock time; 36 h comfortably tolerates one missed daily run
  regardless of what hour the NUC normally scrapes.
- **Coverage:** ≥50 of 51 states (50 states + DC) present.
- **Range:** `1.50 ≤ price ≤ 10.00` (USD/gallon) for every price in every
  row.

### `feeds/aaa-ev.js`

- **Shape:** response has `values[]`, header row (values[0]) contains both
  `LOCATION_STATE` and `ev_costperkwh`.
- **Coverage:** ≥50 of 51 states after state-abbrev-to-name mapping.
- **Range:** `0.10 ≤ usdPerKwh ≤ 1.00` for every state.

### `feeds/eia.js`

- **Shape:** response has `response.data[]` with non-empty array, each row
  has `stateid`, `period`, `price`.
- **Unit guard:** response metadata reports `cents per kilowatthour`; if
  units change, bail (prevents silent unit errors).
- **Coverage:** after picking the latest period per state, ≥50 states
  covered.
- **Range:** `5 ≤ price_cents ≤ 60` for every state.

### State name normalization

`lib/states.js` exports the canonical list of 51 state names (exactly
matching the keys in `data.json`) plus lookup maps:

```js
export const STATE_NAMES = ["Alabama", "Alaska", ..., "District of Columbia"];
export const ABBR_TO_NAME = { AL: "Alabama", AK: "Alaska", ... };
export const NAME_TO_ABBR = { Alabama: "AL", ... };
```

Every feed normalizes its rows to these canonical names before handing
results to the merger.

## 9. Frontend refactor

### Adapter pattern

`index.html` currently renders synchronously against inline `const` data.
After the refactor, the existing rendering code stays untouched; a new
bootstrap shim fetches the JSONs and populates the old global names before
calling the rest.

```html
<script>
  let elecHomeData = {}, evPublicData = {}, gasData = {},
      gridCO2Data = {}, evDatabase = {};

  async function bootstrap() {
    try {
      const [dataRes, evRes] = await Promise.all([
        fetch("./data.json", { cache: "no-cache" }),
        fetch("./ev-database.json", { cache: "no-cache" })
      ]);
      if (!dataRes.ok || !evRes.ok) throw new Error("Data fetch failed");

      const data = await dataRes.json();
      evDatabase = await evRes.json();

      for (const [state, blk] of Object.entries(data.states)) {
        elecHomeData[state] = blk.elecResidential.usdPerKwh * 100; // ¢/kWh
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
      initApp();  // was the top-level D3 init block
    } catch (err) {
      showErrorState(err);
    }
  }
  bootstrap();
</script>
```

### Loading state

Before bootstrap resolves, `#map-container` shows a centered, muted
"Loading data…" message. The element is the same one the map SVG
ultimately renders into, so there's no layout shift.

### Error state

If either fetch fails or returns non-200, the map panel shows a
non-scary banner: *"Couldn't load the latest data. Try reloading."* The
rest of the UI stays visible (tabs, controls) but empty.

### Cache strategy

`fetch("./data.json", { cache: "no-cache" })` forces HTTP cache
validation on each load. GitHub Pages returns ETags, so revisits are
typically 304 responses — fast but always current.

### Deferred to a future task

Rendering per-state freshness badges in tooltips (e.g., *"EIA data:
Jan 2026"*). The data is in the JSON; the UI plumbing can land in a
follow-up. Not V1.

## 10. GitHub Actions workflow

`.github/workflows/update-data.yml`:

```yaml
name: Update data
on:
  schedule:
    - cron: "0 13 * * *"       # 13:00 UTC daily
  workflow_dispatch: {}         # manual trigger for testing

permissions:
  contents: write               # needed to commit data.json

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run pipeline
        env:
          EIA_API_KEY: ${{ secrets.EIA_API_KEY }}
          AAA_SHEETS_API_KEY: ${{ secrets.AAA_SHEETS_API_KEY }}
        run: node scripts/update-data.js

      - name: Commit changes (if any)
        run: |
          git config user.name  "evs-data-bot"
          git config user.email "evs-data-bot@users.noreply.github.com"
          git diff --quiet data.json && echo "No changes" && exit 0
          git add data.json
          git commit -m "data: daily refresh $(date -u +%F)"
          git push
```

The `git diff --quiet` check ensures commits only happen on real changes.
If the pipeline itself exited 1 (all feeds broken, >3 days stale), the
"Run pipeline" step fails and nothing is committed.

## 11. Secrets & env vars

### GitHub Action secrets (repo settings)

| Name | Source | Used for |
|---|---|---|
| `EIA_API_KEY` | [eia.gov/opendata](https://www.eia.gov/opendata/) registration | `feeds/eia.js` |
| `AAA_SHEETS_API_KEY` | The key already baked into AAA's frontend (`AIzaSy...`) | `feeds/aaa-ev.js` |

No PAT for the Action itself — `GITHUB_TOKEN` (provided automatically) has
the `contents: write` permission granted in the workflow file.

### NUC-local env vars

| Name | Used for |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT (`contents: write` on `iandmuir/evs-vs-gasoline` only) for the scraper's commit call |

## 12. NUC-side setup instructions

The NUC's scraper needs two additions to what the user has already built:

1. Add the `"updated"` field to the JSON it produces.
2. Commit the JSON to the GitHub repo instead of writing it to a local
   file only.

### 12.1 Generate a fine-grained GitHub PAT

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** `evs-vs-gasoline-nuc-scraper`
3. **Expiration:** **No expiration**. (GitHub now permits this for
   fine-grained PATs scoped to personal repositories. The 1-year
   maximum only applies to organization-owned resources. Since the
   token is narrowly scoped — Contents: write on a single personal
   repo — this is safe and eliminates a silent-failure class: missed
   90-day rotation reminder → NUC commits stop working → no one
   notices for days.)
4. **Resource owner:** your account.
5. **Repository access:** "Only select repositories" → `iandmuir/evs-vs-gasoline`.
6. **Permissions:** under *Repository permissions*, set **Contents** to
   **Read and write**. Leave everything else at "No access".
7. Copy the token once; you can't see it again.

### 12.2 Store the token on the NUC

Add to `/opt/scrape_gas/.env` (mode `600`, owned by the scraper's user):

```env
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxx
GITHUB_REPO=iandmuir/evs-vs-gasoline
```

### 12.3 Modify `scrape_gas.py`

The scraper currently writes a local `aaa_gas_prices.json`. Change it to:

1. Wrap its output in the schema from §5 (adds `updated` and `source`).
2. Upload via the GitHub Contents API.

```python
import base64
import json
import os
import requests
from datetime import datetime, timezone

# ... existing scraping code produces `rows` list ...

# IMPORTANT: full UTC timestamp (not date-only). The pipeline's freshness
# gate parses this and computes elapsed hours; a date-only string would
# be parsed as midnight UTC and would falsely trip the 36 h gate after a
# single missed run. See spec §5 for details.
payload = {
    "updated": datetime.now(timezone.utc).isoformat(),
    "source": "AAA",
    "states": rows
}

new_content = json.dumps(payload, indent=2) + "\n"
b64 = base64.b64encode(new_content.encode("utf-8")).decode("ascii")

token = os.environ["GITHUB_TOKEN"]
repo = os.environ["GITHUB_REPO"]
path = "gas-prices.json"

headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
}

# 1. Get the current file's sha (required to update).
r = requests.get(
    f"https://api.github.com/repos/{repo}/contents/{path}",
    headers=headers, timeout=30
)
sha = r.json()["sha"] if r.status_code == 200 else None

# 2. PUT the new content.
body = {
    "message": f"gas prices: daily refresh {payload['updated']}",
    "content": b64,
    "committer": {
        "name": "evs-data-bot",
        "email": "evs-data-bot@users.noreply.github.com"
    }
}
if sha:
    body["sha"] = sha

r = requests.put(
    f"https://api.github.com/repos/{repo}/contents/{path}",
    headers=headers, json=body, timeout=30
)
r.raise_for_status()
print(f"Committed gas-prices.json ({r.json()['commit']['sha'][:7]})")
```

### 12.4 Confirm cron sources the env file

The existing crontab entry likely looks like:

```cron
0 3 * * * /opt/scrape_gas/.venv/bin/python /opt/scrape_gas/scrape_gas.py
```

Change to:

```cron
0 3 * * * . /opt/scrape_gas/.env && /opt/scrape_gas/.venv/bin/python /opt/scrape_gas/scrape_gas.py >> /var/log/scrape_gas.log 2>&1
```

(Or have the script itself read `.env` — whatever matches the existing
setup best.)

### 12.5 First-run verification

From the NUC, run the updated scraper manually once. Confirm the commit
appears in the repo's history and `gas-prices.json` at root has the new
shape.

## 13. Bootstrapping & initial deploy

### 13.1 Seed data

Before the first pipeline run, the repo must contain a valid
`data.json`. Generate it by exporting the current hardcoded values from
`index.html` into the new schema, stamping every `updated` field with
today's date and marking `source: "seed"` for values that a feed will
eventually overwrite. Commit this file.

Similarly, generate `ev-database.json` from the existing inline
`evDatabase` object. Commit once; it stays static.

### 13.2 Initial `gas-prices.json`

The NUC will create this file on its first successful run. For an
immediate start, a one-time hand-seeded version (with current AAA
values) can be committed first; the NUC will overwrite it the next day.

### 13.3 GitHub Pages

Repo settings → Pages → Source: `main` branch, `/ (root)`. The site URL
will be `https://iandmuir.github.io/evs-vs-gasoline/`.

### 13.4 First Action run

Trigger `workflow_dispatch` manually once to verify secrets are set and
the pipeline runs end-to-end. On success, confirm the commit history
shows `data: daily refresh YYYY-MM-DD` (or that the run logged "No
changes" if the seed already matched what the feeds returned).

## 14. Monitoring

V1 monitoring is deliberately minimal:

- **Red Action runs** → GitHub emails the user by default.
- **Stale dates on the frontend** → the refactor (deferred task) will
  surface per-datapoint freshness, so a stuck feed becomes visible.
- **The 3-days-all-rejected guard** → if every feed is broken for 3+
  consecutive days, the Action exits 1 and alerting fires.

Future additions (out of scope for V1): Discord/ntfy webhook on failure,
a `status.json` published alongside `data.json` for a status page, a
GitHub Issue auto-opened on repeated failures.

## 15. Out of scope / deferred

- **AAA gas prices fetched from GitHub Actions directly.** Cloudflare
  bot protection makes this infeasible from runner IPs; the NUC is the
  right answer for now.
- **Ember CO₂ data automation.** Their dataset updates ~yearly; manual
  refresh is reasonable.
- **EV efficiency database automation** from fueleconomy.gov. Possible
  but out of scope; V1 ships with a static snapshot.
- **L2 vs. DCFC EV charging split.** AAA source exposes only a blended
  rate.
- **Frontend freshness-badge UI.** Data is available; visible badges
  land in a follow-up.

## 16. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Google Sheets API key rotation | AAA EV feed breaks | Referer-restricted key is public; if AAA rotates it, update the secret. Validation rejects the feed, data stays stale until fixed. |
| EIA API schema change | EIA feed breaks | Unit guard + shape validation reject the feed; old values persist. |
| Sheets API column reorder | AAA EV feed silently mis-reads | Shape validation checks header row explicitly; detects this. |
| NUC offline or scraper fails | Gas prices stale | Freshness check in pipeline rejects stale `gas-prices.json` (>36 h); old values persist. |
| AAA changes HTML structure | Scraper breaks | Scraper maintained separately on NUC; user owns that detection. |
| PAT leaked or compromised | Attacker can write to repo contents | Fine-grained PAT scoped to this single repo with only `contents: write`. Stored in `.env` with `chmod 600` on NUC. If compromised, revoke in GitHub settings and regenerate. (No-expiration PATs are used to eliminate silent-failure risk from missed rotation reminders.) |
| GH Pages CDN caches `data.json` aggressively | Users see yesterday's data | `cache: "no-cache"` forces revalidation; ETags keep it fast. |

## 17. Success criteria

1. `data.json` receives a successful commit with refreshed feeds on three
   consecutive days after deployment.
2. `index.html` loads on GH Pages in <1 s on a fresh load, data
   visible within another ~200 ms.
3. A deliberate single-feed failure test (e.g., revoking the EIA key) leaves
   that feed's values at their prior `updated` date, commits refreshed
   values from the other feeds, and the Action run stays green. Log output
   names the rejected feed and its reason.
4. A deliberate NUC freshness test (e.g., skipping a night) leaves gas
   values at their prior `updated` date and does not poison the JSON.
5. A deliberate all-feeds-broken scenario lasting more than 3 days produces
   a red Action run, surfacing the outage to the user.
