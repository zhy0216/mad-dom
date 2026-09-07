#!/usr/bin/env bun
// Bun-native host IO versus the pre-migration Node fallback benchmark (T5).
//
// Every row runs the SAME workload through two transports and reports both:
//   - the migrated path that the T5 source uses on this runtime (Bun.file /
//     Bun.write / Bun.spawnSync / the capability-gated facade functions);
//   - the Node-compatible fallback it replaces (node:fs / node:crypto /
//     node:child_process, or the same facade functions under
//     MAD_DOM_BUN_IO_DISABLED=1).
//
// The migration-path rows drive the actual facade entry points
// (`virtualServerResponse`, `syncFetch`) so the measured delta is the real
// before/after cost of the T5 change, not a synthetic micro-operation.
//
//   bun run bench:bun-io            # machine-readable report on stdout
//   MAD_DOM_BENCH_IO_ITERATIONS=50 bun scripts/bench-bun-io.mjs --selftest
//
// Output schema: mad-dom/bun-host-io-bench/1.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { promises as FS } from "node:fs";

import { bunHostIO } from "../js/facade/bun-host-io.js";
import { virtualServerResponse } from "../js/facade/virtual-server.js";
import { syncFetch } from "../js/facade/sync-fetch.js";

export const IO_BENCH_SCHEMA = "mad-dom/bun-host-io-bench/1";

const DISABLED = "MAD_DOM_BUN_IO_DISABLED";

function now() {
  return performance.now();
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
}

function unavailable(reason, extra = {}) {
  return { status: "unavailable", reason, ...extra };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// A measured row either succeeds (status "measured" with validation.passed) or
// becomes an explicit "error". `unavailable` is reserved for capability gaps
// detected BEFORE an operation runs; an operation that throws once its path is
// available, or that produces a wrong result, is a real failure and must fail
// the CLI/selftest — it is never downgraded to "unavailable".
function executionError(error, extra = {}) {
  return { status: "error", reason: error?.message ?? String(error), errorName: error?.name ?? "Error", ...extra };
}

function measuredResult(metrics, validation) {
  if (validation?.passed !== true) {
    return {
      status: "error",
      reason: `result validation failed: ${JSON.stringify(validation ?? null)}`,
    };
  }
  return { status: "measured", metrics, validation };
}

function measuredSync(operation, validate, iterations) {
  const before = memorySnapshot();
  let result;
  const start = now();
  try {
    for (let i = 0; i < iterations; i++) result = operation();
  } catch (error) {
    return executionError(error);
  }
  const elapsedMs = Math.max(0, now() - start);
  const after = memorySnapshot();
  let validation;
  try {
    validation = validate(result);
  } catch (error) {
    return executionError(error, { validationError: true });
  }
  return measuredResult(
    {
      iterations,
      elapsedMs,
      latencyMs: elapsedMs / Math.max(1, iterations),
      opsPerSecond: elapsedMs === 0 ? Number.MAX_SAFE_INTEGER : (iterations * 1000) / elapsedMs,
      rssBeforeBytes: before.rssBytes,
      rssAfterBytes: after.rssBytes,
      rssDeltaBytes: after.rssBytes - before.rssBytes,
    },
    validation,
  );
}

async function measuredAsync(operation, validate, iterations) {
  const before = memorySnapshot();
  let result;
  const start = now();
  try {
    for (let i = 0; i < iterations; i++) result = await operation(i);
  } catch (error) {
    return executionError(error);
  }
  const elapsedMs = Math.max(0, now() - start);
  const after = memorySnapshot();
  let validation;
  try {
    validation = await validate(result);
  } catch (error) {
    return executionError(error, { validationError: true });
  }
  return measuredResult(
    {
      iterations,
      elapsedMs,
      latencyMs: elapsedMs / Math.max(1, iterations),
      opsPerSecond: elapsedMs === 0 ? Number.MAX_SAFE_INTEGER : (iterations * 1000) / elapsedMs,
      rssBeforeBytes: before.rssBytes,
      rssAfterBytes: after.rssBytes,
      rssDeltaBytes: after.rssBytes - before.rssBytes,
    },
    validation,
  );
}

function row(bunResult, fallbackResult) {
  const valid = (result) => result.status === "measured" && result.validation?.passed === true;
  const comparable = valid(bunResult) && valid(fallbackResult);
  return {
    sameInput: true,
    bun: bunResult,
    fallback: fallbackResult,
    comparable,
  };
}

// Migration rows select their transport from `process.env` (the facade
// functions read it at call time), so measuring both sides of a migration row
// means temporarily overriding the capability gate around each measurement.
async function withEnvOverride(envOverride, fn) {
  const previous = process.env[DISABLED];
  if (envOverride === undefined) {
    delete process.env[DISABLED];
  } else {
    process.env[DISABLED] = envOverride;
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[DISABLED];
    } else {
      process.env[DISABLED] = previous;
    }
  }
}

async function startResponder() {
  const child = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--responder"], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const chunk = await new Promise((resolve, reject) => {
    child.stdout.getReader().read().then(
      ({ value }) => resolve(new TextDecoder().decode(value)),
      reject,
    );
  });
  const match = /^READY (\S+)/.exec(chunk);
  if (!match) {
    child.kill();
    throw new Error(`bench responder failed to start: ${chunk.trim()}`);
  }
  return {
    url: match[1],
    kill: async () => {
      try {
        child.kill();
        await child.exited;
      } catch {
        // The child already exited; nothing to clean up.
      }
    },
  };
}

export async function runBunIOBenchmark({
  env = process.env,
  iterations = Number.parseInt(env.MAD_DOM_BENCH_IO_ITERATIONS ?? "0", 10),
  fileSizeBytes = Number.parseInt(env.MAD_DOM_BENCH_IO_FILE_SIZE ?? String(1024 * 1024), 10),
} = {}) {
  const safeIterations = (n, fallback) => (Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : fallback);
  const workdir = mkdtempSync(join(tmpdir(), "mad-dom-bun-io-bench-"));
  const readPath = join(workdir, "payload.bin");
  const writePath = join(workdir, "out.bin");
  const serverRoot = join(workdir, "vs");
  const largePath = join(serverRoot, "large.bin");
  const payload = Buffer.alloc(fileSizeBytes);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) & 0xff;
  await FS.writeFile(readPath, payload);
  const expectedDigest = digest(payload);
  await FS.mkdir(serverRoot, { recursive: true });
  await FS.writeFile(largePath, payload);
  const responder = await startResponder();
  const windowStub = { DOMException: globalThis.DOMException, happyDOM: { settings: { fetch: {} } } };
  const workloads = {};
  try {
    const iters = {
      read: safeIterations(iterations, 300),
      write: safeIterations(iterations, 200),
      spawn: safeIterations(iterations, 40),
      virtualServer: safeIterations(iterations, 300),
      syncFetch: safeIterations(iterations, 20),
    };

    if (bunHostIO("file")) {
      workloads["read.file"] = row(
        await measuredAsync(
          () => Bun.file(readPath).arrayBuffer(),
          (bytes) => ({ passed: bytes.byteLength === fileSizeBytes && digest(Buffer.from(bytes)) === expectedDigest, bytes: bytes.byteLength }),
          iters.read,
        ),
        await measuredAsync(
          () => FS.readFile(readPath),
          (bytes) => ({ passed: bytes.length === fileSizeBytes && digest(bytes) === expectedDigest, bytes: bytes.length }),
          iters.read,
        ),
      );
    } else {
      workloads["read.file"] = row(unavailable("Bun.file unavailable"), unavailable("Bun.file unavailable"));
    }

    if (bunHostIO("write")) {
      // Full-content validation: the re-read must reproduce the exact bytes.
      const validateWritten = async () => {
        const written = await FS.readFile(writePath);
        return { passed: written.length === fileSizeBytes && digest(written) === expectedDigest, bytes: written.length };
      };
      workloads["write.file"] = row(
        await measuredAsync(() => Bun.write(writePath, payload), validateWritten, iters.write),
        await measuredAsync(() => FS.writeFile(writePath, payload), validateWritten, iters.write),
      );
    } else {
      workloads["write.file"] = row(unavailable("Bun.write unavailable"), unavailable("Bun.write unavailable"));
    }

    if (bunHostIO("spawnSync")) {
      const child = [process.execPath, "-e", "console.log('{\"ok\":true,\"tag\":\"t5\"}')"];
      const validateSpawn = (result) => ({ passed: result?.ok === true && result?.tag === "t5", tag: result?.tag ?? null });
      workloads["spawn.child"] = row(
        measuredSync(
          () => {
            const proc = Bun.spawnSync(child, { stdout: "pipe", stderr: "pipe", env });
            return JSON.parse(proc.stdout?.toString() ?? "");
          },
          validateSpawn,
          iters.spawn,
        ),
        measuredSync(
          () => {
            const proc = spawnSync(child[0], child.slice(1), { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env });
            return JSON.parse(proc.stdout ?? "");
          },
          validateSpawn,
          iters.spawn,
        ),
      );
    } else {
      workloads["spawn.child"] = row(unavailable("Bun.spawnSync unavailable"), unavailable("Bun.spawnSync unavailable"));
    }

    // Migration rows: same facade entry points the T5 source uses, measured on
    // the capability-enabled path and on the forced Node fallback.
    workloads["virtual-server.file"] = row(
      await withEnvOverride(undefined, () =>
        measuredAsync(
          () =>
            virtualServerResponse([{ url: "https://vs.local", directory: serverRoot }], "https://vs.local/large.bin", "https://vs.local/"),
          async (response) => {
            const bytes = Buffer.from(await response.arrayBuffer());
            return { passed: response.status === 200 && bytes.length === fileSizeBytes && digest(bytes) === expectedDigest, bytes: bytes.length };
          },
          iters.virtualServer,
        )),
      await withEnvOverride("1", () =>
        measuredAsync(
          () =>
            virtualServerResponse([{ url: "https://vs.local", directory: serverRoot }], "https://vs.local/large.bin", "https://vs.local/"),
          async (response) => {
            const bytes = Buffer.from(await response.arrayBuffer());
            return { passed: response.status === 200 && bytes.length === fileSizeBytes && digest(bytes) === expectedDigest, bytes: bytes.length };
          },
          iters.virtualServer,
        )),
    );

    workloads["sync-fetch.child"] = row(
      await withEnvOverride(undefined, () =>
        measuredSync(
          () => syncFetch(windowStub, "GET", responder.url, [], null),
          (result) => ({
            passed:
              result?.ok === true &&
              result.status === 200 &&
              Buffer.from(result.body, "base64").toString("utf8") === "hello-sync" &&
              result.headers?.["x-bench"] === "t5",
            body: result?.body === undefined ? null : Buffer.from(result.body, "base64").toString("utf8"),
            header: result?.headers?.["x-bench"] ?? null,
          }),
          iters.syncFetch,
        )),
      await withEnvOverride("1", () =>
        measuredSync(
          () => syncFetch(windowStub, "GET", responder.url, [], null),
          (result) => ({
            passed:
              result?.ok === true &&
              result.status === 200 &&
              Buffer.from(result.body, "base64").toString("utf8") === "hello-sync" &&
              result.headers?.["x-bench"] === "t5",
            body: result?.body === undefined ? null : Buffer.from(result.body, "base64").toString("utf8"),
            header: result?.headers?.["x-bench"] ?? null,
          }),
          iters.syncFetch,
        )),
    );
  } finally {
    await responder.kill();
    rmSync(workdir, { recursive: true, force: true });
  }

  const hasError = Object.values(workloads).some(
    (r) => r.bun.status === "error" || r.fallback.status === "error",
  );
  const measuredCount = Object.values(workloads).filter((r) => r.bun.status === "measured" || r.fallback.status === "measured").length;
  return {
    schema: IO_BENCH_SCHEMA,
    status: hasError ? "error" : measuredCount === 0 ? "unavailable" : "measured",
    runtime: { name: "bun", version: globalThis.Bun?.version ?? null },
    input: {
      iterations,
      fileSizeBytes,
      fixture: "identical payload, iteration counts and result checks on both paths",
    },
    workloads,
    validation: {
      resultChecks: "each measured row reports validation.passed; unavailable rows are explicit",
      sameWorkloadBothPaths: true,
    },
  };
}

export function assertBunIOReport(report) {
  if (report?.schema !== IO_BENCH_SCHEMA) throw new Error("IO benchmark schema mismatch");
  if (!report.workloads || Object.keys(report.workloads).length === 0) throw new Error("IO benchmark workloads are empty");
  for (const [id, entry] of Object.entries(report.workloads)) {
    if (entry.sameInput !== true) throw new Error(`workload input mismatch: ${id}`);
    if (!entry.bun || !entry.fallback) throw new Error(`workload paths incomplete: ${id}`);
    for (const [side, result] of [["bun", entry.bun], ["fallback", entry.fallback]]) {
      if (result.status === "error") {
        throw new Error(`workload ${id} ${side} failed: ${result.reason}`);
      }
      if (result.status === "measured") {
        if (result.validation?.passed !== true) {
          throw new Error(`workload ${id} ${side} measured but failed result validation: ${JSON.stringify(result.validation)}`);
        }
        if (!result.metrics) throw new Error(`workload ${id} ${side} measured without metrics`);
      } else if (result.status !== "unavailable") {
        throw new Error(`workload ${id} ${side} has unknown status ${result.status}`);
      } else if (!result.reason) {
        throw new Error(`workload ${id} ${side} unavailable without a reason`);
      }
    }
    // `comparable` means both sides measured AND the measured results are valid.
    if (entry.comparable) {
      for (const [side, result] of [["bun", entry.bun], ["fallback", entry.fallback]]) {
        if (result.status !== "measured" || result.validation?.passed !== true) {
          throw new Error(`workload ${id} claims comparable but ${side} is not a valid measurement`);
        }
      }
    }
  }
  return true;
}

// Fails the CLI/selftest with a non-zero exit when a benchmark run is invalid.
async function runCli(selftest) {
  const report = await runBunIOBenchmark();
  assertBunIOReport(report);
  if (report.status !== "measured") {
    throw new Error(`benchmark status is ${report.status}, expected measured`);
  }
  if (selftest) {
    // Prove the guard rejects wrong results and execution failures instead of
    // silently passing an invalid row.
    const withInvalidValidation = structuredClone(report);
    withInvalidValidation.workloads["read.file"].bun.validation = { passed: false, bytes: -1 };
    expectAssertThrows(() => assertBunIOReport(withInvalidValidation), "measured row with failed validation must be rejected");

    const withErrorRow = structuredClone(report);
    withErrorRow.workloads["spawn.child"].fallback = { status: "error", reason: "forced execution failure" };
    expectAssertThrows(() => assertBunIOReport(withErrorRow), "an available-path execution failure must be rejected");

    const notComparable = structuredClone(report);
    notComparable.workloads["write.file"].comparable = true;
    notComparable.workloads["write.file"].bun = { status: "unavailable", reason: "forced" };
    expectAssertThrows(() => assertBunIOReport(notComparable), "comparable rows must carry valid measurements on both sides");
    console.log("bun host IO benchmark selftest: ok");
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

function expectAssertThrows(fn, label) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`selftest failed: ${label}`);
}

if (import.meta.main) {
  if (process.argv.includes("--responder")) {
    // Standalone responder process hosting the sync-fetch benchmark target.
    // It must live outside the measuring process: the synchronous spawn
    // blocks the caller's event loop, so a same-process target would deadlock.
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("hello-sync", { headers: { "x-bench": "t5" } });
      },
    });
    console.log(`READY ${server.url.href}`);
    process.on("SIGTERM", () => {
      server.stop(true);
      process.exit(0);
    });
    setInterval(() => {}, 1 << 30);
  } else {
    try {
      await runCli(process.argv.includes("--selftest"));
    } catch (error) {
      console.error(`bench-bun-io: ${error?.message ?? error}`);
      process.exit(1);
    }
  }
}
