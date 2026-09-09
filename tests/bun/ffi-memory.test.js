import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  createDocument,
  liveDocumentCount,
} from "../../index.js";

// Todo 04 memory/GC protocol. These tests prove, with *deterministic* native
// lifecycle counters (live documents, FFI owner registrations, live weak
// wrapper-cache entries) that a bounded DOM/FFI churn
// releases its tracked owners: the counters must return exactly to their
// baseline after explicit destroy plus GC, on both the FFI-enabled and the
// FFI-disabled channel. RSS/heap deltas are reported but only as corroborating
// evidence. The digest runs in child processes because the loader caches its
// FFI state per process (FFI-enabled vs FFI-disabled cannot share one).
//
// Children run through `process.execPath`, so a baseline-Bun parent launches a
// baseline-Bun child (not a newer `bun` on PATH); the fixture echoes its own
// `Bun.version` and the digest asserts it equals the parent's.

const MEMORY_DIGEST = resolve(import.meta.dir, "fixtures", "ffi-memory-digest.mjs");
const MEMORY_SCENARIOS = resolve(import.meta.dir, "fixtures", "ffi-memory-scenarios.mjs");
const EXTERNAL_SPIKE = resolve(import.meta.dir, "../../scripts/probe-ffi-memory.mjs");
const ARTIFACT = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const hasArtifact = existsSync(ARTIFACT);
const diagnostics = hasArtifact ? createDocument() : null;
diagnostics?.destroy();

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
  Bun.gc(true);
  await drainEventLoop();
}

// One scenario of the loader-level output-memory protocol, in a child that
// states the mode it measures. An explicit MAD_DOM_FFI_DISABLED on the fixture
// command line is the documented contract of this protocol
// (docs/ffi-memory-protocol.md); passing "0" here is what keeps a parent running
// under a global MAD_DOM_FFI_DISABLED=1 from silently downgrading the scenario to
// the Node-API channel.
function runMemoryScenario(scenario) {
  const proc = Bun.spawnSync([process.execPath, MEMORY_SCENARIOS, scenario], {
    env: {
      ...process.env,
      MAD_DOM_FFI_DISABLED: "0",
      MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node"),
      MAD_DOM_FFI_PATH: ARTIFACT,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${scenario}\n${proc.stdout}\n${proc.stderr}`);
  const report = JSON.parse(proc.stdout.toString().match(/^SCENARIO (\{.*\})$/m)?.[1] ?? "{}");
  expect(report.scenario).toBe(scenario);
  expect(report.bunVersion).toBe(Bun.version);
  expect(["available", "partial"]).toContain(report.ffiStatus);
  expect(report.passed).toBe(true);
  return report;
}

function runMemoryDigest(extraEnv = {}) {
  const proc = Bun.spawnSync([process.execPath, MEMORY_DIGEST], {
    env: {
      ...process.env,
      MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node"),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${proc.stdout}\n${proc.stderr}`);
  const json = proc.stdout.toString().match(/^MEMORY (\{.*\})$/m)?.[1];
  if (json === undefined) throw new Error(`no memory digest produced: ${proc.stdout}\n${proc.stderr}`);
  const parsed = JSON.parse(json);
  expect(parsed.bunVersion).toBe(Bun.version);
  return parsed;
}

const FULL_FFI_METHODS = [
  "querySnapshot",
  "preorderSnapshot",
  "childSnapshot",
  "serialize",
  "createElements",
  "readBatch",
];

describe("Bun FFI memory and GC protocol", () => {
  test("bounded churn returns every native lifecycle counter to baseline (FFI-enabled)", () => {
    if (!hasArtifact) return;
    const digest = runMemoryDigest({ MAD_DOM_FFI_DISABLED: "0" });
    expect(digest.status).toBe("ok");
    // Path-hit proof: the enabled run really mounted (and exercised) FFI.
    expect([...digest.ffiMethods].sort()).toEqual([...FULL_FFI_METHODS].sort());
    for (const method of FULL_FFI_METHODS) expect(digest.ffiCalls[method]).toBeGreaterThan(0);
    expect(digest.samples).toHaveLength(8);
    for (const sample of digest.samples) expect(sample.counters).toEqual(digest.counters.baseline);
    expect(digest.counters.deltas).toEqual({ docs: 0, ffiRegistrations: 0, wrapperCacheEntries: 0 });
    expect(digest.finalizerTiming.timing).not.toBe("retained");
    // Corroborating bound: RSS/heap must not grow without limit. The counters
    // above are the deterministic proof; this is a coarse smoke ceiling.
    expect(digest.rssGrowthMb).toBeLessThan(128);
    expect(digest.heapGrowthMb).toBeLessThan(128);
  });

  test("the same churn returns the same counters to baseline on the Node-API channel", () => {
    if (!hasArtifact) return;
    const digest = runMemoryDigest({ MAD_DOM_FFI_DISABLED: "1" });
    expect(digest.status).toBe("ok");
    expect(digest.ffiMethods).toEqual([]);
    expect(digest.counters.deltas).toEqual({ docs: 0, ffiRegistrations: 0, wrapperCacheEntries: 0 });
    expect(digest.finalizerTiming.timing).not.toBe("retained");
    expect(digest.rssGrowthMb).toBeLessThan(128);
  });

  test("explicit destroy releases documents without any GC, and counters drain after collect", async () => {
    if (!hasArtifact) return;
    await collectGarbage();
    const docsBefore = liveDocumentCount();
    const ffiBefore = diagnostics.memoryDiagnostics()[1];

    // The deterministic free path: destroy() drops the Core document
    // immediately. No Bun.gc(), no finalizer wait, no event-loop turn.
    const frame = () => {
      const doc = createDocument();
      doc.createElement("div");
      doc.destroy();
    };
    frame();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(diagnostics.memoryDiagnostics()[1]).toBe(ffiBefore);

    // An abandoned (never destroyed) document is released by GC + macrotask,
    // proving the deferred napi finalizer path reclaims the FFI registration.
    const abandon = () => {
      const doc = createDocument();
      doc.ffiContext();
      doc.createElement("span");
      return new WeakRef(doc);
    };
    const wr = abandon();
    Bun.gc(true);
    expect(wr.deref()).toBeUndefined();
    await collectGarbage();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(diagnostics.memoryDiagnostics()[1]).toBe(ffiBefore);
  });

  test("native external ArrayBuffer callbacks honor retain/destroy/GC and release once", () => {
    if (!hasArtifact) return;
    const proc = Bun.spawnSync([process.execPath, EXTERNAL_SPIKE], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_NATIVE_PATH: ARTIFACT, MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const report = JSON.parse(proc.stdout.toString());
    expect(report.bunVersion).toBe(Bun.version);
    expect(report.externalArrayBuffer.status).toBe("verified");
    expect(report.externalArrayBuffer.productionEnabled).toBe(false);
    expect(report.externalArrayBuffer.final).toMatchObject({
      allocations: 258, frees: 258, callbacks: 258,
      duplicateReleasesSuppressed: 2, invalidCallbacks: 0, liveBytes: 0,
    });
    expect(report.jscPrivateApi.defaultPath).toBe(false);
  });
});

// Loader-level protocol checks assert the *enabled* FFI adapter. The loader
// resolves FFI once per process, so a child is the only way to observe the
// enabled channel when this file itself was launched with FFI globally
// disabled; see runMemoryScenario, which states the mode in the child env.
describe("FFI loader output memory protocol", () => {
  test("bounded hints and length leases isolate real reentrant calls and recover after faults", () => {
    if (!hasArtifact) return;
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "fixtures/ffi-adapter-reuse.mjs")], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_NATIVE_PATH: ARTIFACT, MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ bunVersion: Bun.version, passed: true });
  });

  // The child allowance is process start-up (module + native image load) on top
  // of the same work the in-process version did; no assertion or bound changed.
  test("all owned adapter outputs survive alternating multi-document results and destroy", () => {
    if (!hasArtifact) return;
    runMemoryScenario("owned-outputs-survive-multi-document-churn");
  }, 120_000);

  test("live Worker adapters isolate owners and transferred results survive churn and destroy", () => {
    if (!hasArtifact) return;
    runMemoryScenario("worker-adapters-isolate-owners");
  }, 120_000);

  test("corrupt output lengths cannot cause duplicate mutations or unbounded allocation", () => {
    if (!hasArtifact) return;
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "fixtures/ffi-output-faults.mjs")], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ bunVersion: Bun.version, passed: true });
  });

  test("createElements is served single-shot at any legal batch size", () => {
    if (!hasArtifact) return;
    runMemoryScenario("create-elements-single-shot");
  }, 60_000);

  test("destroyed-document FFI calls surface the frozen error, not a crash", () => {
    if (!hasArtifact) return;
    runMemoryScenario("destroyed-document-frozen-error");
  }, 60_000);

  test("FFI copies and Node-API token buffers survive later calls, transfer, GC and destroy", () => {
    if (!hasArtifact) return;
    runMemoryScenario("copies-survive-transfer-gc-destroy");
  }, 60_000);

  test("input lengths use the real view and mutable/detached stores are rejected", () => {
    if (!hasArtifact) return;
    runMemoryScenario("input-lengths-real-view");
  }, 60_000);
});
