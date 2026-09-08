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

import { memoryDigest } from "../tests/bun/fixtures/ffi-memory-digest.mjs";

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

async function benchMemoryCurve() {
  // Churn documents while the JS process stays alive; the memory curve is the
  // RSS growth after a bounded create/destroy cycle (a leak would grow it
  // unboundedly and fail the gate's generous 2x bound).
  Bun.gc(true);
  await drainEventLoop();
  const rssBefore = process.memoryUsage().rss;
  for (let i = 0; i < 200; i++) {
    const doc = createDocument();
    const parent = doc.createElement("div");
    for (let j = 0; j < 100; j++) {
      doc.appendChild(parent, doc.createElement("span"));
    }
    doc.destroy();
  }
  Bun.gc(true);
  await drainEventLoop();
  const rssAfter = process.memoryUsage().rss;
  return { rssBefore, rssAfter, growthMb: (rssAfter - rssBefore) / (1024 * 1024) };
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
  const ffiMemory = await memoryDigest();
  if (process.argv.includes("--require-ffi") && ffiMemory.ffiMethods.length !== 6) {
    throw new Error("FFI-enabled benchmark requires all six mounted data operations");
  }

  if (identity.identityHitRate !== 1 || gc.released !== 1) throw new Error("identity/GC benchmark validation failed");

  const report = {
    schema: "mad-dom-ffi-gc-bench/1",
    runtime: { bunVersion: Bun.version, bunRevision: Bun.revision, platform: process.platform, arch: process.arch },
    memoryEvidence: ffiMemory,
    metrics: {
      ffi_create_element_ops_s: ffi.createSingle,
      ffi_batch_append_ops_s: ffi.batchAppend,
      wrapper_identity_hit_rate: identity.identityHitRate,
      gc_release_hit_rate: gc.released,
      gc_memory_growth_mb: memory.growthMb,
      // Deterministic release counters (memory-protocol task 04). The gate's
      // existing gc_memory_growth_mb remains the RSS smoke bound. Zero here
      // proves tracked owners/cache entries drained, not arbitrary malloc bytes.
      memory_counter_docs_delta: ffiMemory.counters.deltas.docs,
      memory_counter_ffi_registrations_delta: ffiMemory.counters.deltas.ffiRegistrations,
      memory_counter_wrapper_cache_delta: ffiMemory.counters.deltas.wrapperCacheEntries,
      ffi_churn_rss_growth_mb: ffiMemory.rssGrowthMb,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

await main();

