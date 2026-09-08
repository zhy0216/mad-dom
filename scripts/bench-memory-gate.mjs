// A signed, single-cycle RSS delta is an observation, not a leak budget.
// This separate, versioned contract uses absolute post-GC samples from a fixed
// workload. Its 2x bound is relative to the *same process's positive warm stock*;
// it is deliberately not the historical 2x signed-delta comparison.
export const MEMORY_POLICY = Object.freeze({
  schema: "mad-dom/memory-stability/2",
  documents: 200,
  childrenPerDocument: 100,
  warmupRounds: 8,
  measuredRounds: 24,
  blockSize: 8,
  stockMultiplier: 2,
});

const COUNTERS = ["docs", "ffiRegistrations", "wrapperCacheEntries"];
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function blockTrend(values) {
  const slopes = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) slopes.push((values[j] - values[i]) / (j - i));
  }
  slopes.sort((a, b) => a - b);
  // At least three quarters of within-block pairs must rise. A flat plateau,
  // isolated spike or oscillation is not sustained growth. This is a
  // deterministic smoke criterion, not a p-value for correlated RSS samples.
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: median(values), lowerQuartileSlope: slopes[Math.floor(slopes.length / 4)],
    interquartileRange: sorted[Math.floor(sorted.length * 3 / 4)] - sorted[Math.floor(sorted.length / 4)],
  };
}

export function memoryGate(series, ffiEvidence) {
  const rows = [];
  const failures = [];
  function add(name, ok, detail) {
    rows.push({ name, status: ok ? "pass" : "FAIL", detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  }
  const configurationValid = series && Object.entries(MEMORY_POLICY).every(([key, value]) => series[key] === value);
  const samplesValid = (samples, length) => Array.isArray(samples) && samples.length === length && samples.every(sample =>
    sample && ["rss", "heapUsed"].every(key => Number.isFinite(sample[key]) && sample[key] > 0) &&
    COUNTERS.every(key => Number.isSafeInteger(sample.counters?.[key]) && sample.counters[key] >= 0));
  if (!configurationValid || !samplesValid(series.warmup, MEMORY_POLICY.warmupRounds) || !samplesValid(series.samples, MEMORY_POLICY.measuredRounds)) {
    add("memory_stability_evidence", false, "requires the complete fixed workload, warmup, finite positive RSS/heap samples and lifecycle counters");
    return { rows, failures };
  }
  const allSamples = [...series.warmup, ...series.samples];
  const countersZero = counters => COUNTERS.every(key => counters?.[key] === 0);
  const ffiValid = ffiEvidence?.status === "ok" && Number.isSafeInteger(ffiEvidence.rounds) && ffiEvidence.rounds > 0 &&
    Array.isArray(ffiEvidence.samples) && ffiEvidence.samples.length === ffiEvidence.rounds &&
    countersZero(ffiEvidence.counters?.baseline) && countersZero(ffiEvidence.counters?.after) && countersZero(ffiEvidence.counters?.deltas) &&
    ffiEvidence.samples.every(sample => countersZero(sample?.counters));
  add("memory_lifecycle_counters", allSamples.every(sample => countersZero(sample.counters)) && ffiValid,
    "documents, FFI registrations and wrapper caches must be zero in every warmup/measured sample and the independent facade/FFI digest");

  for (const key of ["rss", "heapUsed"]) {
    const warm = median(series.warmup.slice(-MEMORY_POLICY.blockSize / 2).map(sample => sample[key]));
    const values = series.samples.map(sample => sample[key]);
    const peak = Math.max(...values);
    const ceiling = MEMORY_POLICY.stockMultiplier * warm;
    add(`memory_${key}_bound`, peak <= ceiling,
      `post-GC peak ${(peak / 1048576).toFixed(3)} MiB <= ${MEMORY_POLICY.stockMultiplier}x warm stock ${(warm / 1048576).toFixed(3)} MiB`);
    const blocks = [];
    for (let i = 0; i < values.length; i += MEMORY_POLICY.blockSize) blocks.push(blockTrend(values.slice(i, i + MEMORY_POLICY.blockSize)));
    const mediansRise = blocks.every((block, i) => i === 0 || block.median > blocks[i - 1].median);
    const localTrend = blocks.every(block => block.lowerQuartileSlope > 0);
    // RSS can reclaim unrelated pages in one block despite ongoing native
    // retention. Also check the whole horizon: its lower-quartile slope must
    // project more growth over one block than the typical within-block spread.
    // This uses the fixed block length and observed spread, not a fitted MiB
    // tolerance. The heap keeps the local rule: it has finer allocation/JIT
    // accounting and already detects the independent retained-JS controls.
    const projectedGrowth = blockTrend(values).lowerQuartileSlope * MEMORY_POLICY.blockSize;
    const typicalSpread = median(blocks.map(block => block.interquartileRange));
    const globalRssTrend = key === "rss" && projectedGrowth > typicalSpread;
    const growing = mediansRise && (localTrend || globalRssTrend);
    add(`memory_${key}_trend`, !growing,
      `three ${MEMORY_POLICY.blockSize}-round blocks: medians MiB [${blocks.map(block => (block.median / 1048576).toFixed(3)).join(", ")}], lower-quartile slopes B/round [${blocks.map(block => block.lowerQuartileSlope.toFixed(1)).join(", ")}]` +
      (key === "rss" ? `; full-curve projected block growth ${projectedGrowth.toFixed(1)} B vs median block IQR ${typicalSpread.toFixed(1)} B` : ""));
  }
  return { rows, failures };
}
