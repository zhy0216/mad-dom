#!/usr/bin/env bun
// DOM-intensive benchmark: mad-dom vs happy-dom.
//
// Spawns benchmark/dom-bench/worker.mjs once per engine (isolated processes),
// each running the same deterministic workload through the shared public API
// shape — parse of a ~10k-element page, mixed 20k-node tree build plus its
// create/attr/append/text/bulk decomposition, hot/cold selector queries,
// separate getById / getByTag phases, serialization, warm/cold full tree
// walks, read-heavy per-node reads, and mutation churn — and prints the
// per-phase comparison.
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
// buildMixed keeps the old build slot; the decomposition + read/mutation
// phases print as their own groups below.
const PHASES_MAIN = ["parse", "buildMixed", "queryHot", "queryCold", "getById", "getByTag", "serialize", "traverseWarm", "traverseCold"];
const PHASES_BUILD = ["buildCreate", "buildAttr", "buildAppend", "buildText", "buildBulk"];
const PHASES_READ_MUTATION = ["readHeavy", "mutationChurn"];
const PHASES = [...PHASES_MAIN, ...PHASES_BUILD, ...PHASES_READ_MUTATION];
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
  if (report.schema !== "mad-dom-dom-bench/2" || report.engine !== engine) {
    console.error(
      `worker for ${engine} returned an unexpected report (schema=${JSON.stringify(report.schema)}, engine=${JSON.stringify(report.engine)})`,
    );
    process.exit(1);
  }
  return report;
}

function workloadsMatch(mad, happy) {
  const decompMatch = (key) => JSON.stringify(mad.checks.buildDecomp[key]) === JSON.stringify(happy.checks.buildDecomp[key]);
  return (
    mad.workload.elementCount === happy.workload.elementCount &&
    mad.checks.queryHits.hot.item3 === happy.checks.queryHits.hot.item3 &&
    mad.checks.queryHits.hot.descendant === happy.checks.queryHits.hot.descendant &&
    mad.checks.queryHits.cold.item3 === happy.checks.queryHits.cold.item3 &&
    mad.checks.queryHits.cold.descendant === happy.checks.queryHits.cold.descendant &&
    mad.checks.queryHits.byId === happy.checks.queryHits.byId &&
    mad.checks.queryHits.byTag === happy.checks.queryHits.byTag &&
    mad.checks.buildMixed.treeNodes === happy.checks.buildMixed.treeNodes &&
    mad.checks.buildMixed.probeIds === happy.checks.buildMixed.probeIds &&
    PHASES_BUILD.every(decompMatch) &&
    mad.checks.readHeavy.hash === happy.checks.readHeavy.hash &&
    mad.checks.readHeavy.textLen === happy.checks.readHeavy.textLen &&
    mad.checks.readHeavy.count === happy.checks.readHeavy.count &&
    mad.checks.mutation.fpHash === happy.checks.mutation.fpHash &&
    mad.checks.mutation.ops === happy.checks.mutation.ops &&
    mad.checks.serializeHash === happy.checks.serializeHash &&
    mad.checks.traverseCount === happy.checks.traverseCount &&
    mad.checks.traverseColdCount === happy.checks.traverseColdCount
  );
}

function checkHosts(mad, happy) {
  if (mad.host.os !== happy.host.os || mad.host.arch !== happy.host.arch) {
    console.error(
      `host mismatch: mad-dom ${mad.host.os}/${mad.host.arch} vs happy-dom ${happy.host.os}/${happy.host.arch} — comparison is invalid`,
    );
    process.exit(1);
  }
}

function bunLabel(mad, happy) {
  return mad.host.bun === happy.host.bun
    ? `bun ${mad.host.bun}`
    : `bun (mad-dom ${mad.host.bun} / happy-dom ${happy.host.bun})`;
}

function formatRatio(madMs, happyMs) {
  const ratio = happyMs / madMs;
  return ratio >= 1 ? `${ratio.toFixed(1)}x` : `${ratio.toFixed(2)}x (mad-dom slower)`;
}

function formatCell(s) {
  return `${s.medianMs.toFixed(2)} ms [${s.minMs.toFixed(2)}-${s.p90Ms.toFixed(2)}] MAD ${s.madMs.toFixed(2)}`;
}

function printReport(reports) {
  const [mad, happy] = reports;
  const width = 40;
  const row = (cells) => cells.map((cell) => String(cell).padEnd(width)).join("");

  console.log("dom-intensive benchmark: mad-dom vs happy-dom");
  console.log(
    `${bunLabel(mad, happy)} · ${mad.host.os}/${mad.host.arch} · median of ${mad.workload.runs} measured rounds per phase; total = median of ${mad.total.samples.length} per-round pipeline totals`,
  );
  console.log(
    `workload: ${mad.workload.elementCount} elements (${Math.round(mad.workload.htmlBytes / 1024)} KB HTML) · ` +
      `${mad.workload.builtElements} elements + ${mad.workload.builtTextNodes} text nodes`,
  );
  if (!workloadsMatch(mad, happy)) {
    console.log("WARNING: engines saw different workloads — comparison is invalid");
  }
  console.log("");
  console.log(row(["phase", "mad-dom", "happy-dom", "mad-dom speedup"]));
  console.log("-".repeat(width * 4));
  for (const phase of PHASES_MAIN) {
    console.log(
      row([
        phase,
        formatCell(mad.phases[phase]),
        formatCell(happy.phases[phase]),
        formatRatio(mad.phases[phase].medianMs, happy.phases[phase].medianMs),
      ]),
    );
  }
  console.log("");
  console.log("build decomposition (per-phase FFI isolation)");
  for (const phase of PHASES_BUILD) {
    console.log(
      row([
        phase,
        formatCell(mad.phases[phase]),
        formatCell(happy.phases[phase]),
        formatRatio(mad.phases[phase].medianMs, happy.phases[phase].medianMs),
      ]),
    );
  }
  console.log("");
  console.log("read-heavy / mutation churn");
  for (const phase of PHASES_READ_MUTATION) {
    console.log(
      row([
        phase,
        formatCell(mad.phases[phase]),
        formatCell(happy.phases[phase]),
        formatRatio(mad.phases[phase].medianMs, happy.phases[phase].medianMs),
      ]),
    );
  }
  console.log("-".repeat(width * 4));
  console.log(
    row(["total", formatCell(mad.total), formatCell(happy.total), formatRatio(mad.total.medianMs, happy.total.medianMs)]),
  );
  for (const [name, report] of [["mad-dom", mad], ["happy-dom", happy]]) {
    for (const phase of [...PHASES, "total"]) {
      const s = phase === "total" ? report.total : report.phases[phase];
      if (s.medianMs > 0 && s.madMs > 0.2 * s.medianMs) {
        console.log(`WARNING: ${name} ${phase} unstable (MAD > 20% of median)`);
      }
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const reports = ENGINES.map((engine) => runEngine(engine, args.runs));
checkHosts(reports[0], reports[1]);
const valid =
  workloadsMatch(reports[0], reports[1]) && reports.every((r) => r.checks.roundsIdentical !== false);

if (args.json) {
  console.log(
    JSON.stringify(
      {
        schema: "mad-dom-dom-bench-comparison/1",
        phases: PHASES,
        reports,
        valid,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

printReport(reports);
