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
// Key order in JSON.stringify is insertion-order-stable for plain objects
// parsed from JSON; this is sufficient for data.json-shaped state blocks.
export function statesChanged(prev, next) {
  return JSON.stringify(prev.states) !== JSON.stringify(next.states);
}
