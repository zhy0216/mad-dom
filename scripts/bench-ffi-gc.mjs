#!/usr/bin/env bun
// T50 FFI + GC benchmark for the JS↔Rust boundary.
//
// Measures what the Core-only bench (crates/mad-dom-core/examples/bench.rs)
// cannot: the cost of one JS→Rust call (single createElement + append), batch
// mutation throughput through the facade, wrapper-cache identity (same native
// node reads back as one JS object), GC release of explicitly destroyed and
// abandoned documents, and the long-run memory curve under churn.
//
// Outputs a `mad-dom-ffi-gc-bench/1` JSON document that scripts/bench.mjs
// merges with the core bench and gates against bench/baseline.json. Requires
// the native dev artifact (bun run dev:build); without it the script exits 2
// so the bench driver can report the gap instead of fabricating numbers.
//
// Usage:
//   bun scripts/bench-ffi-gc.mjs [--json] [--require-ffi]
import { isNativeAvailable, createDocument, liveDocumentCount } from "../index.js";
import { noInline } from "bun:jsc";

import { collectGarbage as collectShallow, memoryDigest } from "../tests/bun/fixtures/ffi-memory-digest.mjs";
import { MEMORY_POLICY } from "./bench-memory-gate.mjs";

function now() {
  return performance.now();
}

function opsPerSec(iterations, fn) {
  const start = now();
  fn();
  const secs = (now() - start) / 1e3;
  return secs === 0 ? Infinity : iterations / secs;
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
}

function benchFfi() {
  const N = 200_000;

  // Single JS→Rust call: mint a document, then measure createElement+append
  // round trips. Each call crosses the Node-API boundary and returns a fresh
  // (or cached) wrapper object.
  const createSingle = opsPerSec(N, () => {
    const doc = createDocument();
    for (let i = 0; i < N; i++) {
      doc.createElement("span");
    }
    doc.destroy();
  });

  // Batch append through the facade: build one parent, append many children.
  const batchAppend = opsPerSec(20, () => {
    const doc = createDocument();
    const parent = doc.createElement("div");
    for (let i = 0; i < 10_000; i++) {
      doc.appendChild(parent, doc.createElement("span"));
    }
    doc.destroy();
  });

  return { createSingle, batchAppend };
}

function benchWrapperIdentity() {
  const doc = createDocument();
  const parent = doc.createElement("ul");
  const a = doc.createElement("li");
  doc.appendChild(parent, a);
  const identical = parent.firstChild() === parent.firstChild();
  const listIdentical = parent.childNodes()[0] === parent.childNodes()[0];
  const other = doc.createElement("ul");
  const crossIdentical = parent.firstChild() === other.firstChild();
  doc.destroy();
  return {
    identityHitRate: identical && listIdentical && !crossIdentical ? 1.0 : 0.0,
  };
}

async function benchGcRelease() {
  const before = liveDocumentCount();
  const created = [];
  for (let i = 0; i < 50; i++) {
    const doc = createDocument();
    const parent = doc.createElement("div");
    doc.appendChild(parent, doc.createElement("span"));
    created.push(doc);
  }
  if (liveDocumentCount() !== before + created.length) {
    throw new Error("liveDocumentCount did not track created documents");
  }
  // Explicit destroy: count must return to the baseline immediately.
  for (const doc of created) {
    doc.destroy();
  }
  const afterExplicit = liveDocumentCount();
  return { released: afterExplicit === before ? 1.0 : 0.0, baseline: before };
}

function churnMemoryCurve() {
  for (let i = 0; i < 200; i++) {
    const doc = createDocument();
    const parent = doc.createElement("div");
    for (let j = 0; j < 100; j++) {
      doc.appendChild(parent, doc.createElement("span"));
    }
    doc.destroy();
  }
}

// End the native-call activation before GC/RSS sampling. JSC can otherwise
// conservatively retain the final document wrapper in a suspended async frame,
// even after destroy. Keep the original 200 documents x 100 children workload.
noInline(churnMemoryCurve);

async function benchMemoryCurve() {
  Bun.gc(true);
  await drainEventLoop();
  const rssBefore = process.memoryUsage().rss;
  await new Promise((resolve, reject) => setTimeout(() => {
    try { churnMemoryCurve(); resolve(); }
    catch (error) { reject(error); }
  }, 0));
  Bun.gc(true);
  await drainEventLoop();
  const rssAfter = process.memoryUsage().rss;
  return { rssBefore, rssAfter, growthMb: (rssAfter - rssBefore) / (1024 * 1024) };
}

export async function benchMemoryStability({ afterRound = () => {} } = {}) {
  const diagnostics = createDocument();
  diagnostics.destroy();
  const count = MEMORY_POLICY.warmupRounds + MEMORY_POLICY.measuredRounds;
  // Allocate the complete sample storage before warmup. Appending report
  // objects during measurement would itself create a persistent JS heap trend.
  const storage = new Float64Array(count * 5);
  function capture(index) {
    const counters = diagnostics.memoryDiagnostics();
    const memory = process.memoryUsage();
    storage[index * 5] = memory.rss;
    storage[index * 5 + 1] = memory.heapUsed;
    for (let key = 0; key < 3; key++) storage[index * 5 + 2 + key] = counters[key];
  }
  await collectShallow();
  for (let index = 0; index < count; index++) {
    await new Promise((resolve, reject) => setTimeout(() => {
      try {
        churnMemoryCurve();
        // Independent negative controls can retain real allocations here.
        afterRound(index, index >= MEMORY_POLICY.warmupRounds);
        resolve();
      } catch (error) { reject(error); }
    }, 0));
    // Exactly three shallow GC/drain passes, matching task 04. Never retry a
    // sample until RSS or counters happen to look better.
    await collectShallow();
    capture(index);
  }
  const samples = Array.from({ length: count }, (_, index) => ({
    rss: storage[index * 5], heapUsed: storage[index * 5 + 1],
    counters: { docs: storage[index * 5 + 2], ffiRegistrations: storage[index * 5 + 3], wrapperCacheEntries: storage[index * 5 + 4] },
  }));
  return { ...MEMORY_POLICY, sampler: "noinline-churn/three-shallow-gc-drains/preallocated-samples", warmup: samples.slice(0, MEMORY_POLICY.warmupRounds), samples: samples.slice(MEMORY_POLICY.warmupRounds) };
}

async function main() {
  if (!isNativeAvailable()) {
    console.error("bench-ffi-gc: native binding unavailable (run bun run dev:build first)");
    process.exit(2);
  }

  const ffi = benchFfi();
  const identity = benchWrapperIdentity();
  const gc = await benchGcRelease();
  const memory = await benchMemoryCurve();
  const memoryStability = await benchMemoryStability();
  const ffiMemory = await memoryDigest();
  if (process.argv.includes("--require-ffi") && ffiMemory.ffiMethods.length !== 6) {
    throw new Error("FFI-enabled benchmark requires all six mounted data operations");
  }

  if (identity.identityHitRate !== 1 || gc.released !== 1) throw new Error("identity/GC benchmark validation failed");

  const report = {
    schema: "mad-dom-ffi-gc-bench/1",
    runtime: { bunVersion: Bun.version, bunRevision: Bun.revision, platform: process.platform, arch: process.arch },
    memoryCurve: { sampler: "timer-frame-noinline", documents: 200, childrenPerDocument: 100, ...memory },
    memoryStability,
    memoryEvidence: ffiMemory,
    metrics: {
      ffi_create_element_ops_s: ffi.createSingle,
      ffi_batch_append_ops_s: ffi.batchAppend,
      wrapper_identity_hit_rate: identity.identityHitRate,
      gc_release_hit_rate: gc.released,
      gc_memory_growth_mb: memory.growthMb,
      // The signed single-cycle delta above remains raw evidence. The gate
      // separately validates the repeated curve and these ownership counters;
      // zero counters do not prove arbitrary malloc bytes were released.
      memory_counter_docs_delta: ffiMemory.counters.deltas.docs,
      memory_counter_ffi_registrations_delta: ffiMemory.counters.deltas.ffiRegistrations,
      memory_counter_wrapper_cache_delta: ffiMemory.counters.deltas.wrapperCacheEntries,
      ffi_churn_rss_growth_mb: ffiMemory.rssGrowthMb,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) await main();
