import { describe, expect, test } from "bun:test";
import baseline from "../../bench/baseline.json";
import { gate, recordBaseline } from "../../scripts/bench.mjs";
import { MEMORY_POLICY, memoryGate } from "../../scripts/bench-memory-gate.mjs";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rssMetric = "gc_memory_growth_mb";
const MiB = 1048576;
const counters = () => ({ docs: 0, ffiRegistrations: 0, wrapperCacheEntries: 0 });
const sample = (rss = 100, heapUsed = 10) => ({ rss: rss * MiB, heapUsed: heapUsed * MiB, counters: counters() });
const evidence = () => ({
  memoryStability: { ...MEMORY_POLICY, warmup: Array.from({ length: 8 }, () => sample()), samples: Array.from({ length: 24 }, () => sample()) },
  memoryEvidence: { status: "ok", rounds: 8, counters: { baseline: counters(), after: counters(), deltas: counters() }, samples: Array.from({ length: 8 }, () => ({ counters: counters() })) },
});

function compare(current, reference, metric = rssMetric) {
  const run = { ...structuredClone(baseline), ...evidence() };
  const base = structuredClone(baseline);
  run.metrics[metric] = current;
  base.metrics[metric] = reference;
  return gate(run, base);
}

function seriesResult(values, key = "rss") {
  const { memoryStability, memoryEvidence } = evidence();
  memoryStability.samples.forEach((sample, i) => { sample[key] = values[i] * MiB; });
  return memoryGate(memoryStability, memoryEvidence);
}

describe("benchmark regression evidence", () => {
  test.each([
    [-22.44, -18.5703125], [-18.5703125, -18.5703125], [-1, -18.5703125],
    [0, -18.5703125], [0.38, -18.5703125], [-1, 0], [0, 0], [0.34, 0],
    [-1, 10], [0, 10], [10, 10], [20, 10], [20.001, 10],
  ])("signed RSS current=%p baseline=%p remains raw evidence", (current, reference) => {
    const result = compare(current, reference);
    expect(result.failures).toHaveLength(0);
    expect(result.rows.find(row => row.name === rssMetric).status).toBe("info");
    expect(result.rows.filter(row => row.name.startsWith("memory_")).every(row => row.status === "pass")).toBe(true);
  });

  test.each([
    [undefined, undefined, "both sides"], [undefined, 1, "run"], [1, undefined, "baseline"],
  ])("missing evidence current=%p baseline=%p fails", (current, reference, side) => {
    const result = compare(current, reference);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain(`missing from ${side}`);
    expect(result.rows.find(row => row.name === rssMetric).status).toBe("n/a");
  });

  test.each([NaN, Infinity, -Infinity, null, "1", true, {}, []].map(value => [value]))("invalid evidence %p fails on either side", value => {
    for (const [current, reference] of [[value, 1], [1, value], [value, value]]) {
      const result = compare(current, reference);
      expect(result.failures).toHaveLength(1);
      expect(result.rows.find(row => row.name === rssMetric).status).toBe("invalid");
    }
  });

  test("historical signed RSS cannot substitute for missing stability evidence", () => {
    const result = gate(baseline, baseline);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("memory_stability_evidence");
  });

  test("empty reports never claim a regression pass", () => {
    const result = gate({}, {});
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.rows.every(row => ["n/a", "FAIL"].includes(row.status))).toBe(true);
    expect(result.failures).toHaveLength(result.rows.length);
  });

  test("throughput and capacity retain their original thresholds", () => {
    expect(compare(50, 100, "arena_alloc_ops_s").failures).toHaveLength(0);
    expect(compare(49.99, 100, "arena_alloc_ops_s").failures).toHaveLength(1);
    expect(compare(1.1, 1, "arena_capacity_retention_ratio").failures).toHaveLength(0);
    expect(compare(1.101, 1, "arena_capacity_retention_ratio").failures).toHaveLength(1);
    expect(compare(0.999, 1, "wrapper_identity_hit_rate").failures).toHaveLength(1);
    expect(compare(0.999, 1, "gc_release_hit_rate").failures).toHaveLength(1);
    expect(compare(NaN, 100, "arena_alloc_ops_s").failures).toHaveLength(1);
  });
});

describe("fixed memory stability contract", () => {
  test.each(["rss", "heapUsed"])("%s allows bounded oscillation, a plateau and a single spike", key => {
    const level = key === "rss" ? 100 : 10;
    for (const value of [
      () => level,
      i => level - i / 100,
      i => level + (i % 2 ? 1 : -1),
      i => level + (i >= 8 ? 1 : 0),
      i => level + (i >= 12 ? 1 : 0),
      i => level + Math.floor(i / 8),
      i => level + (i === 17 ? 5 : 0),
    ]) expect(seriesResult(Array.from({ length: 24 }, (_, i) => value(i)), key).failures).toHaveLength(0);
  });

  test.each(["rss", "heapUsed"])("%s rejects sustained growth even below the stock bound", key => {
    const level = key === "rss" ? 100 : 10;
    for (const step of [1 / MiB, 0.01, 0.1]) {
      const result = seriesResult(Array.from({ length: 24 }, (_, i) => level + i * step), key);
      expect(result.rows.find(row => row.name === `memory_${key}_bound`).status).toBe("pass");
      expect(result.rows.find(row => row.name === `memory_${key}_trend`).status).toBe("FAIL");
    }
  });

  test.each(["rss", "heapUsed"])("%s stock bound uses positive warm memory, with an exact boundary", key => {
    const level = key === "rss" ? 100 : 10;
    expect(seriesResult(Array(24).fill(level * 2), key).failures).toHaveLength(0);
    expect(seriesResult(Array(24).fill(level * 2 + 1 / MiB), key).rows.find(row => row.name === `memory_${key}_bound`).status).toBe("FAIL");
  });

  test("RSS full-curve evidence rejects growth despite a noisy middle block", () => {
    const values = [...Array.from({ length: 8 }, (_, i) => 100 + i),
      108, 114, 113, 104, 112, 105, 114, 115,
      ...Array.from({ length: 8 }, (_, i) => 116 + i)];
    const result = seriesResult(values);
    expect(result.rows.find(row => row.name === "memory_rss_bound").status).toBe("pass");
    expect(result.rows.find(row => row.name === "memory_rss_trend").status).toBe("FAIL");
    expect(result.rows.find(row => row.name === "memory_rss_trend").detail).toContain("full-curve projected block growth");
  });

  test("the earlier local-only policy is not silently accepted as final evidence", () => {
    const { memoryStability, memoryEvidence } = evidence();
    memoryStability.schema = "mad-dom/memory-stability/1";
    expect(memoryGate(memoryStability, memoryEvidence).failures).toHaveLength(1);
  });

  test("every fixed warmup and measurement sample is required", () => {
    for (const field of ["warmup", "samples"]) {
      const { memoryStability, memoryEvidence } = evidence();
      memoryStability[field].pop();
      expect(memoryGate(memoryStability, memoryEvidence).failures).toHaveLength(1);
    }
    const { memoryStability, memoryEvidence } = evidence();
    memoryStability.documents = 1;
    expect(memoryGate(memoryStability, memoryEvidence).failures).toHaveLength(1);
  });

  test.each([NaN, Infinity, -Infinity, null, "1", 0, -1].map(value => [value]))("bad absolute sample %p cannot pass", value => {
    for (const field of ["warmup", "samples"]) {
      for (const key of ["rss", "heapUsed"]) {
        const { memoryStability, memoryEvidence } = evidence();
        memoryStability[field][0][key] = value;
        expect(memoryGate(memoryStability, memoryEvidence).failures).toHaveLength(1);
      }
    }
  });

  test("all owner/cache samples must be exactly zero, even if RSS drops", () => {
    for (const key of Object.keys(counters())) {
      for (const field of ["warmup", "samples"]) {
        const { memoryStability, memoryEvidence } = evidence();
        memoryStability[field][0].counters[key] = 1;
        expect(memoryGate(memoryStability, memoryEvidence).failures[0]).toContain("memory_lifecycle_counters");
      }
      const { memoryStability, memoryEvidence } = evidence();
      memoryEvidence.samples[0].counters[key] = 1;
      expect(memoryGate(memoryStability, memoryEvidence).failures[0]).toContain("memory_lifecycle_counters");
    }
  });

  test("missing or malformed independent FFI lifecycle evidence fails", () => {
    for (const ffi of [undefined, {}, { ...evidence().memoryEvidence, samples: [] }, { ...evidence().memoryEvidence, samples: Array(8).fill(null) }]) {
      expect(memoryGate(evidence().memoryStability, ffi).failures[0]).toContain("memory_lifecycle_counters");
    }
  });

  test("first host recording rejects sustained growth and never creates a baseline", () => {
    const directory = mkdtempSync(join(tmpdir(), "mad-dom-bench-record-"));
    const path = join(directory, "baseline.json");
    try {
      for (const key of ["rss", "heapUsed"]) {
        const report = { ...structuredClone(baseline), ...evidence() };
        report.memoryStability.samples.forEach((sample, i) => { sample[key] += i * 1000; });
        expect(recordBaseline(report, path).failures.some(failure => failure.startsWith(`memory_${key}_trend`))).toBe(true);
        expect(existsSync(path)).toBe(false);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("first host recording requires complete valid samples and current metrics", () => {
    const directory = mkdtempSync(join(tmpdir(), "mad-dom-bench-record-"));
    const path = join(directory, "baseline.json");
    try {
      for (const corrupt of [
        report => { delete report.memoryStability; },
        report => { report.memoryStability.samples[0].rss = NaN; },
        report => { report.memoryStability.samples.pop(); },
        report => { report.memoryStability.warmup[0].counters.docs = 1; },
        report => { delete report.metrics[rssMetric]; },
        report => { report.metrics.arena_alloc_ops_s = Infinity; },
        report => { report.metrics.gc_release_hit_rate = 0; },
      ]) {
        const report = { ...structuredClone(baseline), ...evidence() };
        corrupt(report);
        expect(recordBaseline(report, path).failures.length).toBeGreaterThan(0);
        expect(existsSync(path)).toBe(false);
      }
      const report = { ...structuredClone(baseline), ...evidence() };
      expect(recordBaseline(report, path).failures).toHaveLength(0);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(report);
      const saved = readFileSync(path, "utf8");
      delete report.memoryEvidence;
      expect(recordBaseline(report, path).failures.length).toBeGreaterThan(0);
      expect(readFileSync(path, "utf8")).toBe(saved);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
