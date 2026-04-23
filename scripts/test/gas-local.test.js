import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { fetchGasLocal } from "../feeds/gas-local.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function writeFixtureWithFreshTimestamp(srcPath, destPath) {
  const raw = JSON.parse(await readFile(srcPath, "utf8"));
  if (raw.updated === "__UPDATED__") {
    raw.updated = new Date().toISOString();
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
  assert.equal(res.stateBlocks.Alabama.regular, 3.50);
  assert.equal(res.stateBlocks.Alabama.midGrade, 3.80);
  assert.equal(res.stateBlocks.Alabama.premium, 4.10);
  assert.equal(res.stateBlocks.Alabama.diesel, 4.40);
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
  // Build a file with 51 states but one has a bad price
  const { STATE_NAMES } = await import("../lib/states.js");
  const states = STATE_NAMES.map((s, i) => ({
    state: s,
    gas_regular: i === 0 ? 99.99 : 3.50,  // Alabama has a bad price
    gas_mid: 3.80,
    gas_premium: 4.10,
    gas_diesel: 4.40
  }));
  await writeFile(file, JSON.stringify({
    updated: new Date().toISOString(),
    source: "AAA",
    states
  }));
  const res = await fetchGasLocal(file);
  assert.equal(res.status, "reject");
  assert.match(res.reason, /outside|range/i);
  await rm(dir, { recursive: true });
});
