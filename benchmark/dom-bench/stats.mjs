function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Per-round samples, ceil-rank p90, and median absolute deviation.
export function summarize(samples) {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new RangeError("timing samples must be nonempty, finite and nonnegative");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = median(sorted);
  return {
    samples: [...samples], medianMs, minMs: sorted[0],
    p90Ms: sorted[Math.ceil(0.9 * sorted.length) - 1],
    madMs: median(sorted.map((x) => Math.abs(x - medianMs))),
  };
}

// Pair samples by round before summarizing: summing phase medians can invent a
// pipeline that never occurred. GC, fixture setup and verification stay outside
// this operation-only total, just as they do for the individual phase samples.
export function summarizeOperations(phases) {
  const entries = Object.values(phases);
  const rounds = entries[0]?.samples.length;
  if (!rounds || entries.some(({ samples }) => samples.length !== rounds)) {
    throw new RangeError("all phases must contain the same nonzero number of samples");
  }
  return summarize(Array.from({ length: rounds }, (_, round) =>
    entries.reduce((sum, { samples }) => sum + samples[round], 0)));
}

// Both workers use the same untimed GC boundary. Two event-loop drains let
// deferred Node-API finalizers settle before the next phase.
export async function collectAndDrain() {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
