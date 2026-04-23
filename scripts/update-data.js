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
