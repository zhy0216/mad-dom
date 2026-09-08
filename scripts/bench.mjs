#!/usr/bin/env bun
// T50 benchmark driver: run the Core bench + the FFI/GC bench, merge into one
// report, and gate it against a recorded baseline with per-metric degradation
// thresholds.
//
// Usage:
//   bun scripts/bench.mjs --record        # run everything, write bench/baseline.json
//   bun scripts/bench.mjs                 # run everything, gate against bench/baseline.json
//   bun scripts/bench.mjs --report        # run everything and print the gate report
//   bun scripts/bench.mjs --json          # merged report as JSON on stdout
//
// The gate compares throughput/capacity metrics to baseline thresholds
// declared below. Higher-is-better metrics (ops/s, hit rates) fail when they
// drop below `lowerBound` (fraction of baseline); lower-is-better metrics
// (retention ratio drift) fail when they rise above
// `upperBound`. Timing noise is absorbed by generous bounds — the goal is
// catching *obvious* regressions, not single-run absolute speed (plan §6).
//
// Exit codes: 0 = pass (or baseline missing → records it), 1 = regression,
// 2 = infrastructure error.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryGate } from "./bench-memory-gate.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BASELINE_PATH = join(REPO_ROOT, "bench", "baseline.json");
// Host-specific baselines recorded when the gate runs on a host different from
// the committed one (see bench/README.md "Thresholds"); git-ignored.
const HOST_BASELINE_PATH = (os, arch) =>
  join(REPO_ROOT, "bench", `baseline.${os}-${arch}.json`);

const CORE_BENCH_SCHEMA = "mad-dom-core-bench/1";
const FFI_GC_BENCH_SCHEMA = "mad-dom-ffi-gc-bench/1";

// Degradation thresholds per metric:
//   direction  "higher"  — fail when current < baseline * lowerBound
//   direction  "lower"   — fail when current > baseline * upperBound
//   tolerance  0         — exact (hit rates, release counts)
const THRESHOLDS = {
  arena_alloc_ops_s: { direction: "higher", lowerBound: 0.5 },
  arena_remove_ops_s: { direction: "higher", lowerBound: 0.5 },
  arena_reuse_ops_s: { direction: "higher", lowerBound: 0.5 },
  arena_capacity_retention_ratio: { direction: "lower", upperBound: 1.1 },
  mutation_append_ops_s: { direction: "higher", lowerBound: 0.5 },
  mutation_remove_ops_s: { direction: "higher", lowerBound: 0.5 },
  mutation_attr_ops_s: { direction: "higher", lowerBound: 0.5 },
  parser_ops_s: { direction: "higher", lowerBound: 0.5 },
  parser_bytes_s: { direction: "higher", lowerBound: 0.5 },
  serializer_ops_s: { direction: "higher", lowerBound: 0.5 },
  serializer_bytes_s: { direction: "higher", lowerBound: 0.5 },
  selector_cold_ops_s: { direction: "higher", lowerBound: 0.5 },
  selector_hot_ops_s: { direction: "higher", lowerBound: 0.5 },
  selector_matches_ops_s: { direction: "higher", lowerBound: 0.5 },
  ffi_create_element_ops_s: { direction: "higher", lowerBound: 0.5 },
  ffi_batch_append_ops_s: { direction: "higher", lowerBound: 0.5 },
  wrapper_identity_hit_rate: { direction: "higher", lowerBound: 1.0, tolerance: 0 },
  gc_release_hit_rate: { direction: "higher", lowerBound: 1.0, tolerance: 0 },
  gc_memory_growth_mb: { direction: "observation" },
};

function parseArgs(argv) {
  const args = { record: false, report: false, json: false };
  for (const arg of argv) {
    if (arg === "--record") args.record = true;
    else if (arg === "--report") args.report = true;
    else if (arg === "--json") args.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function runJson(cmd, args) {
  const stdout = execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function runCoreBench() {
  const report = runJson("cargo", [
    "run",
    "--release",
    "-p",
    "mad-dom-core",
    "--example",
    "bench",
    "--",
    "--json",
  ]);
  if (report.schema !== CORE_BENCH_SCHEMA) {
    throw new Error(`core bench returned unexpected schema: ${report.schema}`);
  }
  return report;
}

function runFfiGcBench() {
  const report = runJson(process.execPath, ["scripts/bench-ffi-gc.mjs"]);
  if (report.schema !== FFI_GC_BENCH_SCHEMA) {
    throw new Error(`ffi/gc bench returned unexpected schema: ${report.schema}`);
  }
  return report;
}

function hostInfo() {
  return {
    os: process.platform,
    arch: process.arch,
    bun: process.versions.bun,
    bunRevision: Bun.revision,
    bunExecutable: process.execPath,
    rust: (() => {
      try {
        return execFileSync("rustc", ["-vV"], { encoding: "utf8" })
          .split(/\r?\n/)
          .find((line) => line.startsWith("release:"))
          ?.split(":")[1]
          ?.trim() ?? "unknown";
      } catch {
        return "unknown";
      }
    })(),
  };
}

function collect() {
  const core = runCoreBench();
  const ffiGc = runFfiGcBench();
  const metrics = { ...core.metrics, ...ffiGc.metrics };
  return {
    schema: "mad-dom-bench/1",
    host: hostInfo(),
    ffiRuntime: ffiGc.runtime,
    memoryStability: ffiGc.memoryStability,
    memoryEvidence: ffiGc.memoryEvidence,
    memoryCurve: ffiGc.memoryCurve,
    node_bytes_per_node: core.node_bytes_per_node,
    bench_doc_nodes: core.bench_doc_nodes,
    metrics,
  };
}

function formatNumber(value) {
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

export function gate(report, baseline) {
  const failures = [];
  const rows = [];
  for (const [name, rule] of Object.entries(THRESHOLDS)) {
    const current = report.metrics?.[name];
    const base = baseline.metrics?.[name];
    if (current === undefined || base === undefined) {
      const side = current === undefined && base === undefined ? "both sides" : current === undefined ? "run" : "baseline";
      const detail = `metric missing from ${side}; comparison requires both values`;
      rows.push({ name, status: "n/a", detail });
      failures.push(`${name}: ${detail}`);
      continue;
    }
    if (!Number.isFinite(current) || !Number.isFinite(base)) {
      const detail = "run and baseline must both contain finite numeric values";
      rows.push({ name, status: "invalid", detail });
      failures.push(`${name}: ${detail}`);
      continue;
    }
    let ok;
    let detail;
    if (rule.direction === "observation") {
      rows.push({ name, status: "info", detail: `raw signed RSS delta ${formatNumber(current)} MiB; historical ${formatNumber(base)} MiB (different sampling contract; see memory stability gate)` });
      continue;
    } else if (rule.direction === "higher") {
      const floor = base * rule.lowerBound;
      ok = current >= floor;
      detail = `current ${formatNumber(current)} vs floor ${formatNumber(floor)} (${rule.lowerBound}x of ${formatNumber(base)})`;
    } else {
      const ceil = base * rule.upperBound;
      ok = current <= ceil;
      detail = `current ${formatNumber(current)} vs ceiling ${formatNumber(ceil)} (${rule.upperBound}x of ${formatNumber(base)})`;
    }
    if (!ok) failures.push(`${name}: ${detail}`);
    rows.push({ name, status: ok ? "pass" : "FAIL", detail });
  }
  const memory = memoryGate(report.memoryStability, report.memoryEvidence);
  return { failures: [...failures, ...memory.failures], rows: [...rows, ...memory.rows] };
}

// Shared by explicit recording and the normal first-host path. Invalid current
// evidence must not become a baseline merely because no reference exists yet.
export function recordBaseline(report, path) {
  const result = memoryGate(report.memoryStability, report.memoryEvidence);
  for (const [name, rule] of Object.entries(THRESHOLDS)) {
    const value = report.metrics?.[name];
    if (!Number.isFinite(value) || (rule.direction !== "observation" && value <= 0) || (rule.tolerance === 0 && value !== 1)) {
      const detail = "cannot record missing/invalid current metric or a failed identity/release invariant";
      result.failures.push(`${name}: ${detail}`);
      result.rows.push({ name, status: "FAIL", detail });
    }
  }
  if (result.failures.length === 0) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return result;
}

function printReport(report, result) {
  console.log("mad-dom benchmark gate (T50)");
  console.log(
    `host: ${report.host.os}/${report.host.arch} · bun ${report.host.bun} · rust ${report.host.rust}`,
  );
  console.log(`node payload: ${report.node_bytes_per_node} B · bench document: ${report.bench_doc_nodes} nodes`);
  console.log("");
  console.log("metric                                   status   value / bound");
  console.log("-".repeat(78));
  for (const row of result.rows) {
    console.log(`${row.name.padEnd(39)} ${row.status.padEnd(7)} ${row.detail}`);
  }
  if (result.failures.length > 0) {
    console.log("");
    console.log(`FAIL: ${result.failures.length} metric(s) regressed or lack valid evidence`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
    return false;
  }
  console.log("");
  console.log("result: PASS — baseline throughput/capacity and current memory stability contract satisfied; raw RSS delta is observational");
  return true;
}

if (import.meta.main) {
const args = parseArgs(process.argv.slice(2));
const report = collect();

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (args.record) {
  const result = recordBaseline(report, BASELINE_PATH);
  if (result.failures.length) { printReport(report, result); process.exit(1); }
  console.log(`recorded baseline → ${BASELINE_PATH}`);
  process.exit(0);
}

// Selection checks only os/arch, not CPU identity, Bun or Rust versions.
// Version/revision metadata supports review but does not establish hardware
// comparability. A first host-specific recording is not a regression pass.
const hostKey = `${report.host.os}-${report.host.arch}`;
const hostPath = HOST_BASELINE_PATH(report.host.os, report.host.arch);
const committed = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
const hostBaseline = existsSync(hostPath) ? JSON.parse(readFileSync(hostPath, "utf8")) : null;

if (committed && committed.host?.os === report.host.os && committed.host?.arch === report.host.arch) {
  const result = gate(report, committed);
  const ok = printReport(report, result);
  process.exit(ok ? 0 : 1);
}

if (hostBaseline && hostBaseline.host?.os === report.host.os && hostBaseline.host?.arch === report.host.arch) {
  const result = gate(report, hostBaseline);
  const ok = printReport(report, result);
  process.exit(ok ? 0 : 1);
}

// Current-run memory acceptance does not require historical samples and must
// still run on a fresh host. Recording is not a throughput regression pass.
const recording = recordBaseline(report, hostPath);
if (recording.failures.length) { printReport(report, recording); process.exit(1); }
if (committed) {
  console.log(
    `no baseline for this host (${hostKey}); committed baseline is ${committed.host?.os}/${committed.host?.arch} — ` +
      `recording a host-specific baseline → ${hostPath}`,
  );
} else {
  console.log(`no baseline found — recording one → ${hostPath}`);
}
console.log("memory stability: PASS; historical throughput/capacity comparison: NOT RUN (first host recording)");
process.exit(0);
}
