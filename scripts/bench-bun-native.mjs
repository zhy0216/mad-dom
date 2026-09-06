#!/usr/bin/env bun
// Same-input Node-API versus candidate bun:ffi boundary benchmark (T1).
//
// T2 owns the FFI cdylib. Until it is present, this benchmark reports an
// explicit unavailable FFI row and measures the current Node-API path. It
// never fills a missing FFI result with a guessed number.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isNativeAvailable, loadNative } from "../js/native-loader.js";
import { FFI_CONTRACT } from "./bun-capability-probe.mjs";

export const BENCHMARK_SCHEMA = "mad-dom/bun-native-boundary-bench/1";

function now() {
  return performance.now();
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
}

function forceGc() {
  if (typeof globalThis.Bun?.gc === "function") {
    try {
      globalThis.Bun.gc(true);
    } catch {
      // GC is diagnostic only; a runtime that exposes a non-callable GC must
      // not turn a boundary benchmark into a correctness failure.
    }
  }
}

function unavailable(reason, extra = {}) {
  return { status: "unavailable", reason, ...extra };
}

function measured(operation, validate, iterations, operationUnits = 1) {
  const before = memorySnapshot();
  let result;
  const start = now();
  try {
    for (let i = 0; i < iterations; i++) result = operation();
  } catch (error) {
    return unavailable(error?.message ?? String(error), { errorName: error?.name ?? "Error" });
  }
  const elapsedMs = now() - start;
  const after = memorySnapshot();
  const elapsedNs = Math.max(0, elapsedMs * 1e6);
  const calls = Math.max(1, iterations);
  const operations = calls * Math.max(1, operationUnits);
  let validation;
  try {
    validation = validate(result);
  } catch (error) {
    validation = { passed: false, reason: error?.message ?? String(error) };
  }
  return {
    status: "measured",
    metrics: {
      iterations,
      calls,
      operations,
      operationUnits: Math.max(1, operationUnits),
      elapsedMs,
      boundaryCostNs: elapsedNs / calls,
      operationsPerSecond: elapsedMs === 0 ? Number.MAX_SAFE_INTEGER : (operations * 1000) / elapsedMs,
      rssBeforeBytes: before.rssBytes,
      rssAfterBytes: after.rssBytes,
      rssDeltaBytes: after.rssBytes - before.rssBytes,
      heapUsedBeforeBytes: before.heapUsedBytes,
      heapUsedAfterBytes: after.heapUsedBytes,
      allocationEstimateBytes: after.heapUsedBytes - before.heapUsedBytes,
    },
    validation,
  };
}

function destroy(document) {
  try {
    document?.destroy?.();
  } catch {
    // Preserve the original workload result. The native tests cover destroy
    // error semantics; this benchmark only records the measured operation.
  }
}

function htmlFixture(count = 32) {
  return `<main data-bench="t1">${Array.from({ length: count }, (_, i) =>
    `<span data-index="${i}">value-${i}</span>`,
  ).join("")}</main>`;
}

function runWorkload(native, id, options) {
  const iterations = id === "large-document.snapshot"
    ? Math.min(options.iterations, 128)
    : options.iterations;
  const batchSize = options.batchSize;
  const document = native.createDocument();
  try {
    if (id === "boundary.single-call") {
      const create = typeof document.createElementToken === "function"
        ? document.createElementToken.bind(document)
        : document.createElement?.bind(document);
      if (!create) return unavailable("DocumentHandle has neither createElementToken nor createElement");
      const result = measured(() => create("span"), (value) => ({
        passed: typeof value === "number" || (value !== null && typeof value === "object"),
        type: typeof value,
      }), iterations);
      if (result.metrics) result.metrics.operations = iterations;
      return result;
    }

    if (id === "token.batch") {
      if (typeof document.createElementTokenBatch !== "function") {
        return unavailable("DocumentHandle.createElementTokenBatch is unavailable");
      }
      const result = measured(
        () => document.createElementTokenBatch("span", batchSize),
        (value) => ({ passed: Array.isArray(value) && value.length === batchSize, length: value?.length ?? null }),
        iterations,
        batchSize,
      );
      return result;
    }

    if (id === "query.snapshot") {
      if (typeof document.parseHtml !== "function" || typeof document.querySelectorAll !== "function") {
        return unavailable("DocumentHandle parseHtml/querySelectorAll surface is unavailable");
      }
      document.parseHtml(htmlFixture(batchSize));
      const expected = batchSize;
      return measured(
        () => document.querySelectorAll("span[data-index]") ?? [],
        (value) => ({ passed: Array.isArray(value) && value.length === expected, length: value?.length ?? null }),
        iterations,
      );
    }

    if (id === "serialize.string") {
      if (typeof document.parseHtml !== "function" || typeof document.querySelector !== "function") {
        return unavailable("DocumentHandle parseHtml/querySelector surface is unavailable");
      }
      document.parseHtml(htmlFixture(batchSize));
      const element = document.querySelector("main");
      if (!element || typeof element.outerHTML !== "function") return unavailable("NodeHandle.outerHTML is unavailable");
      return measured(
        () => element.outerHTML(),
        (value) => ({
          passed: typeof value === "string" && value.includes('data-bench="t1"'),
          bytes: typeof value === "string" ? new TextEncoder().encode(value).byteLength : 0,
        }),
        iterations,
      );
    }

    if (id === "snapshot.bytes") {
      if (typeof document.createElementToken !== "function" || typeof document.createElementTokenBatch !== "function" ||
          typeof document.appendChildToken !== "function" || typeof document.preorderTokenSnapshot !== "function") {
        return unavailable("token snapshot methods are unavailable");
      }
      const root = document.createElementToken("main");
      const children = document.createElementTokenBatch("span", batchSize);
      for (const child of children) document.appendChildToken(root, child);
      return measured(
        () => document.preorderTokenSnapshot(root),
        (value) => ({ passed: value instanceof Uint32Array && value.length >= 3, words: value?.length ?? 0 }),
        iterations,
      );
    }

    if (id === "large-document.snapshot") {
      if (typeof document.parseHtml !== "function" || typeof document.querySelectorAll !== "function") {
        return unavailable("DocumentHandle parseHtml/querySelectorAll surface is unavailable");
      }
      const expected = options.largeDocumentSize;
      document.parseHtml(htmlFixture(expected));
      return measured(
        () => document.querySelectorAll("span[data-index]") ?? [],
        (value) => ({ passed: Array.isArray(value) && value.length === expected, length: value?.length ?? null }),
        iterations,
      );
    }
    return unavailable(`unknown workload: ${id}`);
  } catch (error) {
    return unavailable(error?.message ?? String(error), { errorName: error?.name ?? "Error" });
  } finally {
    destroy(document);
  }
}

function probeFfiCandidate(env) {
  if (/^(1|true|yes)$/i.test(String(env.MAD_DOM_FFI_DISABLED ?? ""))) {
    return unavailable("MAD_DOM_FFI_DISABLED is set", { mode: "disabled", contract: FFI_CONTRACT });
  }
  const configured = env.MAD_DOM_FFI_PATH ? resolve(process.cwd(), env.MAD_DOM_FFI_PATH) : null;
  if (!configured) {
    return unavailable("no MAD_DOM_FFI_PATH; T2 cdylib is not installed", { contract: FFI_CONTRACT });
  }
  if (!existsSync(configured)) {
    return unavailable("MAD_DOM_FFI_PATH does not exist", { path: configured, contract: FFI_CONTRACT });
  }
  return unavailable(
    "candidate cdylib is present but no T2 adapter is available in this benchmark",
    { path: configured, contract: FFI_CONTRACT },
  );
}

function fallbackWorkloads(reason) {
  return Object.fromEntries(
    ["boundary.single-call", "token.batch", "query.snapshot", "serialize.string", "snapshot.bytes", "large-document.snapshot"].map((id) => [
      id,
      unavailable(reason),
    ]),
  );
}

export async function runBenchmark({
  env = process.env,
  iterations = Number.parseInt(env.MAD_DOM_BENCH_ITERATIONS ?? "1000", 10),
  batchSize = Number.parseInt(env.MAD_DOM_BENCH_BATCH_SIZE ?? "32", 10),
  largeDocumentSize = Number.parseInt(env.MAD_DOM_BENCH_LARGE_DOCUMENT_SIZE ?? "512", 10),
} = {}) {
  const safeIterations = Number.isFinite(iterations) && iterations > 0 ? Math.min(iterations, 100_000) : 1000;
  const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 4096) : 32;
  const safeLargeDocumentSize = Number.isFinite(largeDocumentSize) && largeDocumentSize > 0
    ? Math.min(largeDocumentSize, 32_768)
    : 512;
  const workloads = [
    "boundary.single-call",
    "token.batch",
    "query.snapshot",
    "serialize.string",
    "snapshot.bytes",
    "large-document.snapshot",
  ];
  let nodeApi;
  if (!isNativeAvailable()) {
    nodeApi = unavailable("Node-API native binding unavailable; run bun run dev:build", {
      workloads: fallbackWorkloads("Node-API native binding unavailable"),
    });
  } else {
    try {
      const native = loadNative();
      nodeApi = {
        status: "measured",
        workloads: Object.fromEntries(workloads.map((id) => [id, runWorkload(native, id, {
          iterations: safeIterations,
          batchSize: safeBatchSize,
          largeDocumentSize: safeLargeDocumentSize,
        })])),
      };
    } catch (error) {
      nodeApi = unavailable(error?.message ?? String(error), { workloads: fallbackWorkloads(error?.message ?? String(error)) });
    }
  }
  forceGc();

  const ffi = probeFfiCandidate(env);
  const comparisons = Object.fromEntries(workloads.map((id) => [id, {
    sameInput: true,
    nodeApi: nodeApi.workloads?.[id] ?? unavailable("Node-API result missing"),
    ffi,
    comparable: nodeApi.workloads?.[id]?.status === "measured" && ffi.status === "measured",
  }]));
  const measuredCount = Object.values(nodeApi.workloads ?? {}).filter((result) => result.status === "measured").length;
  return {
    schema: BENCHMARK_SCHEMA,
    status: measuredCount > 0 ? "measured-node-api-only" : "unavailable",
    runtime: { name: "bun", version: globalThis.Bun?.version ?? process.versions?.bun ?? null },
    input: {
      iterations: safeIterations,
      batchSize: safeBatchSize,
      largeDocumentSize: safeLargeDocumentSize,
      fixture: "same fixture and iteration counts are supplied to both paths",
    },
    paths: { nodeApi, ffi },
    comparisons,
    validation: {
      resultChecks: "each measured workload reports validation.passed; unavailable paths are explicit",
      noSyntheticFfiMetrics: true,
    },
  };
}

export function assertBenchmarkReport(report) {
  if (report?.schema !== BENCHMARK_SCHEMA) throw new Error("benchmark schema mismatch");
  if (!report.paths?.nodeApi || !report.paths?.ffi) throw new Error("benchmark paths are incomplete");
  for (const [id, comparison] of Object.entries(report.comparisons ?? {})) {
    if (comparison.sameInput !== true) throw new Error(`workload input mismatch: ${id}`);
    if (comparison.ffi.status === "unavailable" && comparison.comparable) {
      throw new Error(`unavailable FFI path reported comparable metrics: ${id}`);
    }
  }
  return true;
}

if (import.meta.main) {
  const selftest = process.argv.includes("--selftest");
  const json = process.argv.includes("--json");
  const report = await runBenchmark();
  assertBenchmarkReport(report);
  if (selftest) {
    console.log("bun native boundary benchmark selftest: ok");
  } else if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}
