#!/usr/bin/env bun
// Black-box differential runner orchestrator (T10).
//
// Contract: ADR-0002 sections 5 (黑盒差分 runner 协议) and 6 (结果规范化格式).
// See tests/compat/runner/README.md for the full documentation.
//
// Usage:
//   bun run.js [paths...] [--report] [--selftest] [--json]
//
//   paths      scenario files or directories (default: the selftest and dom
//              directories under tests/compat/scenarios). Directories named
//              "divergent" hold deliberately-failing self-test scenarios and
//              are skipped during directory walks — they can only run when
//              passed explicitly (they would otherwise always fail the gate
//              by design; the T10 bun test drives them to assert the exact
//              reported difference paths).
//   --selftest only the selftest directory; strict exit codes (this is what
//              `npm run compat:differential:selftest` runs)
//   --report   report mode: differences in scenarios whose target pair is the
//              real pair (happy-dom vs mad-dom) are printed but do NOT fail
//              the run (they are true compatibility gaps, ledgered by T11);
//              mock/selftest differences stay fatal. This is what
//              `npm run compat:differential` runs.
//   --json     print ONLY the machine-readable JSON report on stdout.
//
// Exit codes:
//   0 — every selected scenario produced equal normalized records on both
//       sides (or only non-fatal report-mode differences);
//   1 — at least one fatal difference exists;
//   2 — at least one infrastructure error (probe crash, timeout, scenario
//       contract violation, normalizer failure). Infrastructure errors always
//       fail the run, in every mode, even when both sides fail identically.
//
// Isolation: one fresh Bun subprocess per (scenario, target); the parent
// process never imports an implementation. Crashes/timeouts are captured as
// side-local structured infrastructure errors. The environment passed to
// probes is a whitelist (PATH, HOME, TMPDIR, LANG, LC_ALL, BUN_INSTALL) per
// ADR-0002 section 5.2.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeScenarioProblems } from "./protocol.js";
import { RECORD_SCHEMA } from "./normalize.js";
import { diffNormalizedRecords } from "./compare.js";
import { resolveTargetPair } from "./targets.js";

const RUNNER_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..", "..", "..");
const SCENARIOS_DIR = resolve(RUNNER_DIR, "..", "scenarios");
const CHILD_SCRIPT = join(RUNNER_DIR, "child.js");
const DEFAULT_PATHS = [join(SCENARIOS_DIR, "selftest"), join(SCENARIOS_DIR, "dom")];
const SELFTEST_PATHS = [join(SCENARIOS_DIR, "selftest")];

const ENVELOPE_SCHEMA = "mad-dom-diff-envelope/1";
const REPORT_SCHEMA = "mad-dom-diff-report/1";
const PROBE_TIMEOUT_MS = 10_000;
const ENV_WHITELIST = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "BUN_INSTALL"];
const REAL_PAIR = "happy-dom>mad-dom";
const PREVIEW_LENGTH = 120;

function failInfrastructure(message) {
  console.error(`differential runner error: ${message}`);
  process.exit(2);
}

function parseArguments(argv) {
  const paths = [];
  let report = false;
  let selftest = false;
  let json = false;
  for (const argument of argv) {
    if (argument === "--report") report = true;
    else if (argument === "--selftest") selftest = true;
    else if (argument === "--json") json = true;
    else if (argument.startsWith("--")) failInfrastructure(`unknown flag ${argument}`);
    else paths.push(argument);
  }
  const defaultPaths = selftest ? SELFTEST_PATHS : DEFAULT_PATHS;
  const selected = paths.length > 0 ? paths.map((path) => resolve(path)) : defaultPaths;
  for (const path of selected) {
    if (!existsSync(path)) failInfrastructure(`scenario path does not exist: ${path}`);
  }
  return { selected, mode: report ? "report" : "strict", json };
}

function listScenarioFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith("_") || entry.name === "divergent") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...listScenarioFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(child);
  }
  return files;
}

async function loadScenarios(paths) {
  const files = paths.flatMap(listScenarioFiles);
  if (files.length === 0) failInfrastructure("no scenario modules found");
  const scenarios = [];
  const seenIds = new Map();
  for (const file of files) {
    const moduleNamespace = await import(file);
    const problems = describeScenarioProblems(moduleNamespace, file);
    if (problems.length > 0) failInfrastructure(problems.join("; "));
    const previous = seenIds.get(moduleNamespace.id);
    if (previous !== undefined) {
      failInfrastructure(`duplicate scenario id ${JSON.stringify(moduleNamespace.id)} in ${previous} and ${file}`);
    }
    seenIds.set(moduleNamespace.id, file);
    scenarios.push({
      id: moduleNamespace.id,
      description: moduleNamespace.description,
      targets: resolveTargetPair(moduleNamespace.targets),
      file,
    });
  }
  scenarios.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scenarios;
}

function probeEnvironment() {
  const env = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function runProbe(scenario, targetId, workDir) {
  const outPath = join(workDir, `${scenario.id}__${targetId}.json`);
  const run = spawnSync(process.execPath, [CHILD_SCRIPT, scenario.file, targetId, outPath], {
    cwd: REPO_ROOT,
    env: probeEnvironment(),
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const infrastructureError = (message) => ({
    name: "ProbeInfrastructureError",
    message: `target ${targetId}: ${message}`,
  });

  if (run.error !== undefined && run.error !== null) {
    return { record: null, infraError: infrastructureError(`spawn failed: ${run.error.message}`) };
  }
  if (run.signal !== null) {
    return {
      record: null,
      infraError: infrastructureError(`probe was killed by signal ${run.signal} (timeout is ${PROBE_TIMEOUT_MS}ms)`),
    };
  }
  if (run.status !== 0) {
    const stderrTail = (run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-5).join(" | ");
    return {
      record: null,
      infraError: infrastructureError(`probe exited with code ${run.status}${stderrTail === "" ? "" : `: ${stderrTail}`}`),
    };
  }
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(outPath, "utf8"));
  } catch (error) {
    return { record: null, infraError: infrastructureError(`probe output unreadable: ${error.message}`) };
  }
  if (envelope?.schema !== ENVELOPE_SCHEMA) {
    return { record: null, infraError: infrastructureError(`probe output has unexpected schema: ${JSON.stringify(envelope?.schema ?? null)}`) };
  }
  if (envelope.scenario !== scenario.id || envelope.target !== targetId) {
    return {
      record: null,
      infraError: infrastructureError(
        `probe envelope mismatch (scenario ${JSON.stringify(envelope.scenario)}, target ${JSON.stringify(envelope.target)})`,
      ),
    };
  }
  if (envelope.infraError != null) {
    return { record: null, infraError: { name: envelope.infraError.name ?? "Error", message: envelope.infraError.message } };
  }
  // Normalization already happened inside the probe (see normalize.js); the
  // parent validates the envelope shape but never re-interprets normalized
  // data, so no second code path can rewrite a comparison input.
  if (envelope.record?.schema !== RECORD_SCHEMA) {
    return {
      record: null,
      pid: envelope.pid,
      infraError: infrastructureError("probe record is missing or has an unexpected schema"),
    };
  }
  return { record: envelope.record, pid: envelope.pid, infraError: null };
}

function preview(value) {
  const text = JSON.stringify(value) ?? String(value);
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function segmentCounts(record) {
  if (record == null) return null;
  return {
    values: Object.keys(record.values).length,
    snapshots: Object.keys(record.snapshots).length,
    errors: record.errors.length,
    descriptors: Object.keys(record.descriptors).length,
    identity: Object.keys(record.identity).length,
    events: record.events.length,
  };
}

function isRealPair(targets) {
  return [...targets].sort().join(">") === REAL_PAIR;
}

function evaluate(scenarios, workDir, mode) {
  const results = [];
  for (const scenario of scenarios) {
    const sides = {};
    for (const targetId of scenario.targets) {
      sides[targetId] = runProbe(scenario, targetId, workDir);
    }
    const differences =
      sides[scenario.targets[0]].record != null && sides[scenario.targets[1]].record != null
        ? diffNormalizedRecords(sides[scenario.targets[0]].record, sides[scenario.targets[1]].record)
        : [];
    const infrastructure = scenario.targets.filter((targetId) => sides[targetId].infraError != null);
    // In report mode only the real compatibility pair (happy-dom vs mad-dom)
    // is non-fatal: those differences are genuine, ledgered compatibility
    // gaps. Everything else — the self-test pair included — is fatal.
    const reportOnly = mode === "report" && isRealPair(scenario.targets);
    const status =
      infrastructure.length > 0 ? "infra-error" : differences.length === 0 ? "pass" : reportOnly ? "differences-report" : "differences-fatal";
    results.push({
      id: scenario.id,
      description: scenario.description,
      targets: scenario.targets,
      reportOnly,
      status,
      sides,
      differences,
    });
  }
  return results;
}

function summarize(results) {
  const totals = { scenarios: results.length, pass: 0, differencesFatal: 0, differencesReport: 0, infraErrors: 0, differencePaths: 0 };
  for (const result of results) {
    totals.differencePaths += result.differences.length;
    if (result.status === "pass") totals.pass += 1;
    else if (result.status === "differences-fatal") totals.differencesFatal += 1;
    else if (result.status === "differences-report") totals.differencesReport += 1;
    else totals.infraErrors += 1;
  }
  return totals;
}

function exitCodeFor(totals) {
  if (totals.infraErrors > 0) return 2;
  if (totals.differencesFatal > 0) return 1;
  return 0;
}

function printHumanReport(results, totals, mode) {
  console.log("mad-dom black-box differential runner (T10 / ADR-0002 sections 5-6)");
  console.log(
    mode === "report"
      ? "mode: report — happy-dom vs mad-dom differences are reported, not fatal (ledger: T11)"
      : "mode: strict — every difference fails the run",
  );
  console.log(`bun ${process.versions.bun} · ${totals.scenarios} scenario(s)`);
  console.log("");
  for (const result of results) {
    const [left, right] = result.targets;
    console.log(`[${result.id}] ${result.description}`);
    for (const targetId of result.targets) {
      const side = result.sides[targetId];
      const counts = segmentCounts(side.record);
      const summary =
        counts == null
          ? `infra error: ${side.infraError?.name}: ${side.infraError?.message}`
          : `values ${counts.values} · snapshots ${counts.snapshots} · errors ${counts.errors} · descriptors ${counts.descriptors} · identity ${counts.identity} · events ${counts.events}`;
      console.log(`  ${targetId.padEnd(12)} pid ${side.pid ?? "?"} · ${summary}`);
    }
    if (result.status === "pass") {
      console.log("  status: PASS (0 differences)");
    } else if (result.status === "differences-fatal" || result.status === "differences-report") {
      console.log(
        `  status: ${result.differences.length} difference(s)` +
          (result.status === "differences-report" ? " (report-only: real-target gap, not fatal)" : " (FATAL)"),
      );
      for (const difference of result.differences) {
        const leftText = difference.kind === "right-only" ? "(absent)" : preview(difference.left);
        const rightText = difference.kind === "left-only" ? "(absent)" : preview(difference.right);
        console.log(`    - ${difference.kind.padEnd(10)} ${difference.path}  ${left}=${leftText} · ${right}=${rightText}`);
      }
    } else {
      console.log("  status: INFRASTRUCTURE ERROR (FATAL)");
    }
    console.log("");
  }
  if (totals.infraErrors > 0) {
    console.log(`result: INFRASTRUCTURE ERROR (${totals.infraErrors} scenario(s) could not produce comparable records)`);
  } else if (totals.differencesFatal > 0) {
    console.log(
      `result: FAIL (${totals.differencesFatal} scenario(s) with fatal differences, ${totals.differencePaths} difference path(s))`,
    );
  } else {
    console.log(
      `result: PASS (${totals.pass} scenario(s) equal` +
        (totals.differencesReport > 0
          ? `; ${totals.differencesReport} real-target scenario(s) with ${totals.differencePaths} reported difference path(s) — recorded for the T11 ledger, not fatal`
          : "") +
        ")",
    );
  }
}

function jsonReport(results, totals, mode) {
  return {
    schema: REPORT_SCHEMA,
    mode,
    bun: process.versions.bun,
    exitCode: exitCodeFor(totals),
    totals,
    scenarios: results.map((result) => ({
      id: result.id,
      description: result.description,
      targets: result.targets,
      reportOnly: result.reportOnly,
      status: result.status,
      sides: Object.fromEntries(
        result.targets.map((targetId) => [
          targetId,
          {
            pid: result.sides[targetId].pid ?? null,
            record: result.sides[targetId].record,
            infraError: result.sides[targetId].infraError,
          },
        ]),
      ),
      differences: result.differences,
    })),
  };
}

async function main() {
  const { selected, mode, json } = parseArguments(process.argv.slice(2));
  const scenarios = await loadScenarios(selected);
  const workDir = mkdtempSync(join(tmpdir(), "mad-dom-differential-"));
  let results;
  try {
    results = evaluate(scenarios, workDir, mode);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const totals = summarize(results);
  const exitCode = exitCodeFor(totals);

  if (json) {
    console.log(JSON.stringify(jsonReport(results, totals, mode), null, 2));
  } else {
    printHumanReport(results, totals, mode);
  }
  process.exit(exitCode);
}

await main();
