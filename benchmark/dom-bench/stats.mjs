function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Per-round samples, ceil-rank p90, and median absolute deviation.
export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = median(sorted);
  return {
    samples: [...samples], medianMs, minMs: sorted[0],
    p90Ms: sorted[Math.ceil(0.9 * sorted.length) - 1],
    madMs: median(sorted.map((x) => Math.abs(x - medianMs))),
  };
}

// Both workers use the same untimed GC boundary. Two event-loop drains let
// deferred Node-API finalizers settle before the next phase.
export async function collectAndDrain() {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
