// Real retained-memory negative controls for the fixed benchmark gate.
// Run in a fresh process with the same local native image as bench:check.
import assert from "node:assert/strict";
import { benchMemoryStability } from "../../../scripts/bench-ffi-gc.mjs";
import { MEMORY_POLICY, memoryGate } from "../../../scripts/bench-memory-gate.mjs";
import { memoryDigest } from "./ffi-memory-digest.mjs";

const control = process.argv[2] ?? "normal";
assert.ok(["normal", "buffer", "heap"].includes(control));
assert.equal(process.execPath, Bun.which("bun"));
const retained = Array(MEMORY_POLICY.warmupRounds + MEMORY_POLICY.measuredRounds).fill(null);
const series = await benchMemoryStability({ afterRound(index, measured) {
  if (!measured) return;
  if (control === "buffer") retained[index] = new Uint8Array(1048576).fill(index);
  if (control === "heap") retained[index] = Array(131072).fill(index + 0.5);
} });
const report = { control, bunVersion: Bun.version, bunRevision: Bun.revision, execPath: process.execPath, retainedBytes: control === "normal" ? 0 : retained.filter(Boolean).length * 1048576, series };
try {
const ffiEvidence = await memoryDigest();
report.ffiEvidence = ffiEvidence;
const result = memoryGate(series, ffiEvidence);
report.result = result;
if (control === "normal") assert.deepEqual(result.failures, []);
// Bun includes these TypedArray backing bytes in heapUsed as well. RSS alone
// can still retreat while other pages are reclaimed; do not mislabel this as
// an RSS-only/native-malloc negative control.
else assert.equal(result.rows.find(row => row.name === "memory_heapUsed_trend").status, "FAIL", "real retained growth must fail the trend gate, independently of the stock bound");
assert.equal(result.rows.find(row => row.name === "memory_lifecycle_counters").status, "pass", "these controls retain allocations, not document owners");
} finally { console.log(JSON.stringify(report, null, 2)); }
