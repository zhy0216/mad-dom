// Task 07 reproducible sampling harness. Run from the repository root:
// bun docs/bun-native-runtime-evidence/measure.mjs boundary|io
// Keep MAD_DOM_NATIVE_PATH and MAD_DOM_FFI_PATH on this checkout's same image.
import assert from "node:assert/strict";
import { runBenchmark, assertBenchmarkReport } from "../../scripts/bench-bun-native.mjs";
import { runBunIOBenchmark, assertBunIOReport } from "../../scripts/bench-bun-io.mjs";

const kind = process.argv[2];
assert.ok(["boundary", "io"].includes(kind));
assert.equal(process.execPath, Bun.which("bun"));
const run = kind === "boundary"
  ? () => runBenchmark({ iterations: 10_000, batchSize: 32, largeDocumentSize: 4096 })
  : () => runBunIOBenchmark(); // 1 MiB; read/virtual 300, write 200, spawn 40, sync fetch 20
async function measure() {
  const start = performance.now();
  const report = await run();
  if (kind === "boundary") {
    assertBenchmarkReport(report);
    for (const row of Object.values(report.comparisons)) {
      assert.equal(row.comparable, true);
      assert.equal(row.nodeApi.validation.passed, true);
      assert.equal(row.ffi.validation.passed, true);
    }
  } else {
    assertBunIOReport(report);
    for (const row of Object.values(report.workloads)) assert.equal(row.comparable, true);
  }
  return { elapsedMs: performance.now() - start, report };
}

const cold = await measure(); // first complete workload invocation in this process
const warmup = [];
for (let i = 0; i < 2; i++) warmup.push(await measure());
const samples = [];
for (let i = 0; i < 5; i++) samples.push(await measure());
console.log(JSON.stringify({
  schema: "mad-dom/bun-integration-samples/1", kind,
  runtime: { version: Bun.version, revision: Bun.revision, execPath: process.execPath },
  methodology: "First invocation reported separately; two warmups, five measured invocations. Fixed path order. Cold is not disk-cache eviction or import timing. All raw samples retained.",
  cold, warmup, samples,
}, null, 2));
