// Re-evaluate every retained fixed-workload curve under the final policy.
// Original JSON stays unchanged; only the schema tag in an in-memory copy is
// translated so the *same numeric samples* can be evaluated by the v2 rule.
import assert from "node:assert/strict";
import { MEMORY_POLICY, memoryGate } from "../../scripts/bench-memory-gate.mjs";
const read = name => Bun.file(new URL(name, import.meta.url)).json();
const history = await read("memory-policy.json");
const reviewed = [];
function evaluate(source, series, ffi, expectedGrowth) {
  assert.ok(["mad-dom/memory-stability/1", MEMORY_POLICY.schema].includes(series.schema));
  const evaluation = memoryGate({ ...series, schema: MEMORY_POLICY.schema }, ffi);
  reviewed.push({ source, originalSchema: series.schema, evaluatedPolicy: MEMORY_POLICY.schema, expectedGrowth, evaluation });
  assert.equal(evaluation.failures.length > 0, expectedGrowth, source);
  assert.equal(evaluation.rows.find(row => row.name === "memory_lifecycle_counters").status, "pass");
  if (source.includes("native-rss")) {
    assert.equal(evaluation.rows.find(row => row.name === "memory_rss_trend").status, "FAIL", source);
    assert.equal(evaluation.rows.find(row => row.name === "memory_heapUsed_trend").status, "pass", source);
  }
}
for (const [name, value] of Object.entries(history)) {
  if (value.series) evaluate(`memory-policy.json#${name}`, value.series, value.ffiEvidence, value.control !== "normal");
}
for (const [lane, value] of Object.entries(history.formalReports)) {
  evaluate(`memory-policy.json#formalReports/${lane}`, value.memoryStability, value.memoryEvidence, false);
}
for (const name of ["coordinator-native-rss-latest.json", "coordinator-native-rss-baseline.json", "native-rss-portable-baseline.json", "native-rss-portable-latest-with-log.json"]) {
  const value = await read(name);
  evaluate(name, value.series, value.ffiEvidence, true);
}
const current = await read("memory-policy-v2.json");
for (const [name, value] of Object.entries(current.runs)) {
  if (value.series) evaluate(`memory-policy-v2.json#${name}`, value.series, value.ffiEvidence, value.control !== "normal");
}
for (const [lane, value] of Object.entries(current.formalReports)) {
  evaluate(`memory-policy-v2.json#formalReports/${lane}`, value.memoryStability, value.memoryEvidence, false);
}
console.log(JSON.stringify({ policy: MEMORY_POLICY, reviewed, excluded: [
  { source: "native-rss-portable-latest.json", reason: "zero-byte original; only the AssertionError log exists, so the missed curve cannot be regraded" },
  { source: "memory-policy-v2-latest-native-3.json", reason: "digest round 7 raised ffiRegistrations=1 before evaluation; original stdout records only releasedBlocks:24, no curve" },
  { source: "rss-diagnostics.json", reason: "legacy/isolated/full-shallow 11-round activation diagnostics have a different sampling contract, not 8 warmup + 24 samples" },
  { source: "measurements.json (memory digests)", reason: "Window digests (8 x 30 or 20 x 100) exercise a different facade/FFI workload; preserve raw counters/RSS/heap without claiming equivalence" },
] }, null, 2));
