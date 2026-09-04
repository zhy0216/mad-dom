#!/usr/bin/env bun
// DOM-intensive benchmark: mad-dom vs happy-dom.
//
// Spawns benchmark/dom-bench/worker.mjs once per engine (isolated processes),
// each running the same deterministic workload through the shared public API
// shape — parse of a ~10k-element page, 20k-node tree build, selector queries,
// serialization, full tree walk — and prints the per-phase comparison.
//
// This complements the integration-test benchmark (benchmark/run.mjs): that
// one measures wall-clock of a small, fixed-cost-dominated suite; this one
// exercises the DOM engine itself, where the native parser / selector /
// serializer win (and where the FFI boundary shows its per-call cost).
//
// Usage:
//   bun benchmark/dom-bench/run.mjs                # print comparison
//   bun benchmark/dom-bench/run.mjs --json         # machine-readable JSON
//   bun benchmark/dom-bench/run.mjs --runs 7       # measured runs per phase
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER = join(SCRIPT_DIR, "worker.mjs");

const ENGINES = ["mad-dom", "happy-dom"];
const PHASES = ["parse", "build", "query", "serialize", "traverse"];
const USAGE = "usage: bun benchmark/dom-bench/run.mjs [--runs <n>] [--json]";

function parseRuns(raw) {
  const runs = Number(raw);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(USAGE);
    process.exit(2);
  }
  return runs;
}

function parseArgs(argv) {
  const args = { json: false, runs: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--runs") args.runs = parseRuns(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function runEngine(engine, runs) {
  const result = spawnSync(process.execPath, [WORKER, "--engine", engine, "--runs", String(runs), "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`failed to spawn worker for ${engine}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`worker for ${engine} was killed by signal ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`worker for ${engine} failed (exit ${result.status}):\n${result.stderr}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error(
      `worker for ${engine} produced invalid JSON\n` +
        `stderr: ${String(result.stderr).slice(0, 500)}\n` +
        `stdout: ${String(result.stdout).slice(0, 500)}`,
    );
    process.exit(1);
  }
  if (report.schema !== "mad-dom-dom-bench/1" || report.engine !== engine) {
    console.error(
      `worker for ${engine} returned an unexpected report (schema=${JSON.stringify(report.schema)}, engine=${JSON.stringify(report.engine)})`,
    );
    process.exit(1);
  }
  return report;
}

function formatRatio(madMs, happyMs) {
  const ratio = happyMs / madMs;
  return ratio >= 1 ? `${ratio.toFixed(1)}x` : `${ratio.toFixed(2)}x (mad-dom slower)`;
}

function printReport(reports) {
  const [mad, happy] = reports;
  const width = 24;
  const row = (cells) => cells.map((cell) => String(cell).padEnd(width)).join("");

  console.log("dom-intensive benchmark: mad-dom vs happy-dom");
  console.log(`bun ${mad.host.bun} · ${mad.host.os}/${mad.host.arch} · median of ${mad.workload.runs} measured runs per phase`);
  console.log(
    `workload: ${mad.workload.elementCount} elements (${Math.round(mad.workload.htmlBytes / 1024)} KB HTML) · ` +
      `${mad.workload.builtElements} elements + ${mad.workload.builtTextNodes} text nodes`,
  );
  if (mad.workload.elementCount !== happy.workload.elementCount || mad.sink.serialize !== happy.sink.serialize) {
    console.log("WARNING: engines saw different workloads — comparison is invalid");
  }
  console.log("");
  console.log(row(["phase", "mad-dom", "happy-dom", "mad-dom speedup"]));
  console.log("-".repeat(width * 4));
  for (const phase of PHASES) {
    console.log(
      row([
        phase,
        `${mad.phases[phase].toFixed(2)} ms`,
        `${happy.phases[phase].toFixed(2)} ms`,
        formatRatio(mad.phases[phase], happy.phases[phase]),
      ]),
    );
  }
  console.log("-".repeat(width * 4));
  const madTotal = PHASES.reduce((sum, p) => sum + mad.phases[p], 0);
  const happyTotal = PHASES.reduce((sum, p) => sum + happy.phases[p], 0);
  console.log(row(["total", `${madTotal.toFixed(2)} ms`, `${happyTotal.toFixed(2)} ms`, formatRatio(madTotal, happyTotal)]));
}

const args = parseArgs(process.argv.slice(2));
const reports = ENGINES.map((engine) => runEngine(engine, args.runs));

if (args.json) {
  console.log(
    JSON.stringify(
      {
        schema: "mad-dom-dom-bench-comparison/1",
        phases: PHASES,
        reports,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

printReport(reports);
