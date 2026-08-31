#!/usr/bin/env bun
// T50 benchmark driver: run the Core bench + the FFI/GC bench, merge into one
// report, and gate it against a recorded baseline with per-metric degradation
// thresholds.
//
// Usage:
//   bun scripts/bench.mjs --record        # run everything, write bench/baseline.json
//   bun scripts/bench.mjs                 # run everything, gate against bench/baseline.json
//   bun scripts/bench.mjs --report        # run everything, print merged report, no gate
//   bun scripts/bench.mjs --json          # merged report as JSON on stdout
//
// The gate compares every metric to its baseline value with the thresholds
// declared below. Higher-is-better metrics (ops/s, hit rates) fail when they
// drop below `lowerBound` (fraction of baseline); lower-is-better metrics
// (memory growth, retention ratio drift) fail when they rise above
// `upperBound`. Timing noise is absorbed by generous bounds — the goal is
// catching *obvious* regressions, not single-run absolute speed (plan §6).
//
// Exit codes: 0 = pass (or baseline missing → records it), 1 = regression,
// 2 = infrastructure error.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  gc_memory_growth_mb: { direction: "lower", upperBound: 2.0 },
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
  const report = runJson("bun", ["scripts/bench-ffi-gc.mjs"]);
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

function gate(report, baseline) {
  const failures = [];
  const rows = [];
  for (const [name, rule] of Object.entries(THRESHOLDS)) {
    const current = report.metrics[name];
    const base = baseline.metrics?.[name];
    if (current === undefined || base === undefined) {
      rows.push({ name, status: "n/a", detail: "metric missing on one side" });
      if (baseline.metrics && baseline.metrics[name] !== undefined && report.metrics[name] === undefined) {
        failures.push(`${name}: present in baseline but missing from the run`);
      }
      continue;
    }
    let ok;
    let detail;
    if (rule.direction === "higher") {
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
  return { failures, rows };
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
    console.log(`FAIL: ${result.failures.length} metric(s) regressed`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
    return false;
  }
  console.log("");
  console.log("result: PASS — no metric regressed beyond its degradation threshold");
  return true;
}

const args = parseArgs(process.argv.slice(2));
const report = collect();

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (args.record) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`recorded baseline → ${BASELINE_PATH}`);
  process.exit(0);
}

// Baselines are host-specific (os/arch/bun/rust). The committed baseline.json
// is the reference recorded by `bench:record`; when this run's host differs,
// we record a host-specific baseline and pass instead of comparing numbers
// measured on different hardware/toolchains (that comparison is meaningless).
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

// No baseline exists for this host: record one and pass (the first run on a
// fresh host establishes its own baseline rather than failing).
if (committed) {
  console.log(
    `no baseline for this host (${hostKey}); committed baseline is ${committed.host?.os}/${committed.host?.arch} — ` +
      `recording a host-specific baseline → ${hostPath}`,
  );
} else {
  console.log(`no baseline found — recording one → ${hostPath}`);
}
writeFileSync(hostPath, `${JSON.stringify(report, null, 2)}\n`);
process.exit(0);
