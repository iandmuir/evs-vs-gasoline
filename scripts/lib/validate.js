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
