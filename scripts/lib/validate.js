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

/**
 * Validates that all values are finite numbers in [min, max].
 * @param {number[]} values - Values to check.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @param {string} label - Dot-prefixed label, e.g. "gas.regular". The part
 *   before the first dot is used as the feed name in thrown RejectedFeedError.
 */
export function assertRange(values, min, max, label) {
  if (values.length === 0) {
    throw new RejectedFeedError(label.split(".")[0], `${label}: no values to validate`);
  }
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
