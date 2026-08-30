#!/usr/bin/env bun
// Compatibility ledger regression gate (T11, ADR-0002 sections 7).
//
// Validates compat/ledger.json and compat/upstream-map.json, cross-checks the
// ledger against the live test inventory (real-pair runner scenarios, type
// fixtures, upstream-map ids) and finally runs the differential runner in
// report mode as a live gate: a ledger entry marked "pass" whose scenario now
// reports differences is a regression; a "known-gap" entry whose scenario
// became green is stale and must be flipped to "pass" in the same commit.
//
// Usage:
//   bun compat/validate-ledger.js [--ledger <path>] [--upstream-map <path>] [--json] [--self-test]
//
//   --ledger        path to the ledger document (default: compat/ledger.json;
//                   the flag exists for tamper drills on temporary copies)
//   --upstream-map  path to the provenance map (default: compat/upstream-map.json)
//   --json          print ONLY the machine-readable gate document on stdout
//   --self-test     tamper drills on temporary copies in os.tmpdir() (never
//                   touches repository files; cleaned up afterwards)
//
// Exit codes: 0 = gate holds; 1 = regression or stale ledger entry (the
// ledger must be updated in the same commit); 2 = schema/config/infrastructure
// error (the gate could not be judged — always fatal).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_HAPPY_DOM_COMMIT,
  UPSTREAM_LICENSE,
  crossValidateLedger,
  summarizeLedger,
  validateLedger,
  validateUpstreamMap,
} from "./ledger-lib.js";
import { describeScenarioProblems } from "../tests/compat/runner/protocol.js";
import { resolveTargetPair } from "../tests/compat/runner/targets.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_LEDGER = join(SCRIPT_DIR, "ledger.json");
const DEFAULT_UPSTREAM_MAP = join(SCRIPT_DIR, "upstream-map.json");
const BASELINE_PATH = join(SCRIPT_DIR, "happy-dom-baseline.json");
const SCENARIOS_DIR = join(REPO_ROOT, "tests", "compat", "scenarios");
const FIXTURES_DIR = join(REPO_ROOT, "tests", "compat", "types", "fixtures");
const RUNNER_PATH = join(REPO_ROOT, "tests", "compat", "runner", "run.js");

const GATE_SCHEMA = "mad-dom-compat-ledger-gate/1";
const REAL_PAIR = "happy-dom>mad-dom";
const MAX_BUFFER = 32 * 1024 * 1024;
const LIVE_GATE_TIMEOUT_MS = 180_000;
const SELF_TEST_TIMEOUT_MS = 300_000;

const jsonMode = process.argv.includes("--json");

function toPosix(path) {
  return path.split("\\").join("/");
}

function relRepo(path) {
  return toPosix(relative(REPO_ROOT, path));
}

function failGate(message) {
  console.error(`compat ledger gate error: ${message}`);
  process.exit(2);
}

// Single exit funnel: prints problems to stderr (always), the human summary
// to stdout, and — in --json mode — ONLY the machine-readable document to
// stdout so pipes never see mixed output.
function finish(exitCode, problems, gate, summaryLines) {
  if (problems.length > 0) {
    console.error(`compat ledger gate: FAIL with ${problems.length} problem(s)`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
  }
  if (jsonMode) {
    console.log(JSON.stringify(resultDocument(exitCode, problems, gate), null, 2));
  } else {
    for (const line of summaryLines ?? []) {
      console.log(line);
    }
  }
  process.exit(exitCode);
}

function resultDocument(exitCode, problems, gate) {
  return {
    schema: GATE_SCHEMA,
    ok: exitCode === 0,
    problems: [...problems].sort(),
    gate: gate ?? { realPairScenarios: 0, regressions: [], stale: [], checkedScenarios: [] },
    totals: summarizeLedger(state.ledger).totals,
    bySubsystem: summarizeLedger(state.ledger).bySubsystem,
  };
}

// Mutable so early failures can still render the ledger totals in --json mode.
const state = { ledger: { entries: [] } };

function readJsonDocument(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    failGate(`cannot read ${label} ${relRepo(path)}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    failGate(`invalid JSON in ${label} ${relRepo(path)}: ${error.message}`);
  }
}

function parseArguments(argv) {
  const options = { ledger: DEFAULT_LEDGER, upstreamMap: DEFAULT_UPSTREAM_MAP, json: false, selfTest: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--ledger") {
      options.ledger = resolve(argv[++index] ?? failGate("--ledger requires a path"));
    } else if (argument === "--upstream-map") {
      options.upstreamMap = resolve(argv[++index] ?? failGate("--upstream-map requires a path"));
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else {
      failGate(`unknown argument ${JSON.stringify(argument)}; supported: --ledger <path>, --upstream-map <path>, --json, --self-test`);
    }
  }
  return options;
}

// Same rule as the runner's isRealPair (tests/compat/runner/run.js).
function isRealPair(targets) {
  return [...targets].sort().join(">") === REAL_PAIR;
}

// Directory walk mirrors the runner's listScenarioFiles except that the
// "divergent" directory is NOT skipped: those scenarios are mock pairs and
// simply never match the real pair, but their ids stay under the same
// contract checks (ADR-0002 section 7.1 mapping covers real scenarios only).
function listScenarioFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith("_")) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...listScenarioFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(child);
  }
  return files;
}

function listFixtureKeys(dir = FIXTURES_DIR, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listFixtureKeys(join(dir, entry.name), key));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(key);
  }
  return found;
}

// Imports every scenario module and returns the sorted ids of the real
// target-pair scenarios. The runner's own contract validator
// (describeScenarioProblems) is reused so the gate and the runner agree on
// what a valid scenario module is; importing is safe in the parent process
// because scenario modules only declare metadata and functions.
async function collectRealPairScenarioIds() {
  const files = listScenarioFiles(SCENARIOS_DIR);
  if (files.length === 0) {
    failGate(`no scenario modules found under ${relRepo(SCENARIOS_DIR)}`);
  }
  const ids = [];
  for (const file of files) {
    let moduleNamespace;
    try {
      moduleNamespace = await import(file);
    } catch (error) {
      failGate(`cannot import scenario module ${relRepo(file)}: ${error.message}`);
    }
    const problems = describeScenarioProblems(moduleNamespace, relRepo(file));
    if (problems.length > 0) {
      failGate(problems.join("; "));
    }
    if (isRealPair(resolveTargetPair(moduleNamespace.targets))) {
      ids.push(moduleNamespace.id);
    }
  }
  return ids.sort();
}

function runLiveGate() {
  const run = spawnSync(process.execPath, [RUNNER_PATH, "--report", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: LIVE_GATE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
  });
  if (run.error !== undefined && run.error !== null) {
    failGate(`cannot execute the differential runner: ${run.error.message}`);
  }
  if (run.signal !== null) {
    failGate(`the differential runner was killed by signal ${run.signal} (timeout is ${LIVE_GATE_TIMEOUT_MS}ms)`);
  }
  if (run.status !== 0) {
    const stderrTail = (run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-5).join(" | ");
    failGate(`the differential runner exited with code ${run.status}${stderrTail === "" ? "" : `: ${stderrTail}`}`);
  }
  try {
    return JSON.parse(run.stdout);
  } catch (error) {
    failGate(`the differential runner report is not valid JSON: ${error.message}`);
  }
}

function evaluateGate(ledger, report) {
  const realScenarios = report.scenarios.filter((scenario) => isRealPair(scenario.targets));
  const checkedScenarios = realScenarios.map((scenario) => scenario.id).sort();
  const diffEntries = ledger.entries.filter((entry) => entry.suite === "diff");
  const entryByScenario = new Map(diffEntries.map((entry) => [entry.scenario, entry]));

  // Scenario drift guard: the set of real-pair scenarios in the live report
  // must be exactly the set referenced by the diff entries.
  const reportSet = new Set(checkedScenarios);
  const ledgerSet = new Set(diffEntries.map((entry) => entry.scenario));
  for (const scenarioId of [...reportSet].sort()) {
    if (!ledgerSet.has(scenarioId)) {
      failGate(
        `scenario drift: live report contains real-pair scenario ${JSON.stringify(scenarioId)} with no diff ledger entry ` +
          "(add or update the ledger in the same commit)",
      );
    }
  }
  for (const scenarioId of [...ledgerSet].sort()) {
    if (!reportSet.has(scenarioId)) {
      failGate(
        `scenario drift: diff ledger entry references scenario ${JSON.stringify(scenarioId)} which the live report does not contain`,
      );
    }
  }

  const regressions = [];
  const stale = [];
  for (const scenario of realScenarios.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const entry = entryByScenario.get(scenario.id);
    const differences = scenario.differences.length;
    if (entry.status === "pass" && differences > 0) {
      regressions.push({ id: entry.id, scenario: scenario.id, differences });
    } else if (entry.status === "known-gap" && differences === 0) {
      stale.push({ id: entry.id, scenario: scenario.id, differences });
    }
  }
  return { regressions, stale, checkedScenarios, realPairScenarios: realScenarios.length };
}

function runSelfTest(options) {
  const tamperedLedger = (mutate) => {
    const path = join(tempRoot, `ledger-${Math.random().toString(36).slice(2)}.json`);
    const document = JSON.parse(readFileSync(options.ledger, "utf8"));
    mutate(document);
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return path;
  };
  const tamperedUpstreamMap = (mutate) => {
    const path = join(tempRoot, `upstream-map-${Math.random().toString(36).slice(2)}.json`);
    const document = JSON.parse(readFileSync(options.upstreamMap, "utf8"));
    mutate(document);
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return path;
  };

  const tempRoot = mkdtempSync(join(tmpdir(), "mad-dom-ledger-selftest-"));
  const scenarios = [];
  try {
    // S1 — a known-gap entry without a reason fails schema validation.
    scenarios.push({
      name: "S1: known-gap entry without reason fails validation (exit 2)",
      run: () =>
        runGate(["--ledger", tamperedLedger((ledger) => {
          // The live ledger may hold zero known-gap entries (T48E flipped the
          // last ones to pass), so the tamper seeds its own before stripping
          // the reason.
          ledger.entries.push({
            id: "hc-diff-selftest-reason",
            suite: "diff",
            status: "known-gap",
            subsystem: "facade",
            scenario: "dom-selftest-reason",
            reason: "self-test tamper entry",
            recordedAt: "2026-08-30T00:00:00Z",
            addedIn: "T11",
          });
          delete ledger.entries.find((entry) => entry.id === "hc-diff-selftest-reason").reason;
        })]),
      expect: (result) => result.exitCode === 2 && /reason/.test(result.output),
    });

    // S2 — a not-applicable api entry without recordedAt fails validation.
    scenarios.push({
      name: "S2: not-applicable entry without recordedAt fails validation (exit 2)",
      run: () =>
        runGate(["--ledger", tamperedLedger((ledger) => {
          ledger.entries.push({
            id: "hc-api-selftest-tamper",
            suite: "api",
            status: "not-applicable",
            subsystem: "tooling",
            reason: "self-test tamper entry: host-process dependent capability",
            addedIn: "T11",
          });
        })]),
      expect: (result) => result.exitCode === 2 && /recordedAt/.test(result.output),
    });

    // S3 — a duplicated id fails validation (ids are permanent).
    scenarios.push({
      name: "S3: duplicated ledger id fails validation (exit 2)",
      run: () =>
        runGate(["--ledger", tamperedLedger((ledger) => {
          ledger.entries.push(JSON.parse(JSON.stringify(ledger.entries[0])));
        })]),
      expect: (result) => result.exitCode === 2 && /duplicat/.test(result.output),
    });

    // S4 — a ported case with a non-MIT license fails the provenance check.
    scenarios.push({
      name: "S4: upstream entry with non-MIT license fails validation (exit 2)",
      run: () =>
        runGate([
          "--upstream-map",
          tamperedUpstreamMap((map) => {
            map.entries.push({
              localId: "hc-up-selftest-tamper",
              upstreamPath: "test/dom/Document.test.ts",
              upstreamCommit: PINNED_HAPPY_DOM_COMMIT,
              license: "Apache-2.0",
              localPath: "index.js",
            });
          }),
        ]),
      expect: (result) => result.exitCode === 2 && /license/.test(result.output),
    });

    // S5 — a ported case anchored to a different commit fails provenance.
    scenarios.push({
      name: "S5: upstream entry with a non-pinned commit fails validation (exit 2)",
      run: () =>
        runGate([
          "--upstream-map",
          tamperedUpstreamMap((map) => {
            map.entries.push({
              localId: "hc-up-selftest-tamper",
              upstreamPath: "test/dom/Document.test.ts",
              upstreamCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              license: UPSTREAM_LICENSE,
              localPath: "index.js",
            });
          }),
        ]),
      expect: (result) => result.exitCode === 2 && /commit/.test(result.output),
    });

    // S6 — simulating a ledger entry that disagrees with the live differential
    // must trip the live gate with exit 1. Since T48E flipped the last
    // known-gap diff entries to pass (the whole real-pair differential is
    // green), the drill now runs in the stale direction: marking a green pass
    // scenario as a known-gap is a ledger regression the gate must catch.
    scenarios.push({
      name: "S6: flipping a pass diff entry to known-gap trips the live stale gate (exit 1)",
      run: () =>
        runGate(["--ledger", tamperedLedger((ledger) => {
          const entry = ledger.entries.find((item) => item.id === "hc-diff-node-create-append-serialize");
          entry.status = "known-gap";
          entry.reason = "self-test tamper: simulated stale known-gap for a green scenario";
          entry.recordedAt = "2026-08-30T00:00:00Z";
        })]),
      expect: (result) => result.exitCode === 1 && /stale/.test(result.output),
    });

    let allPassed = true;
    console.log(`self-test: ${scenarios.length} tamper scenarios against temporary copies in os.tmpdir()`);
    for (const scenario of scenarios) {
      let result;
      try {
        result = scenario.run();
      } catch (error) {
        result = { exitCode: -1, output: `self-test crashed: ${error.message}` };
      }
      const pass = scenario.expect(result);
      allPassed = allPassed && pass;
      console.log(`  ${pass ? "PASS" : "FAIL"} ${scenario.name} (exit ${result.exitCode})`);
      if (!pass) {
        console.log("  --- observed output (first 2000 chars) ---");
        console.log(result.output.slice(0, 2000));
      }
    }
    console.log(`self-test: ${allPassed ? "PASS" : "FAIL"}`);
    return allPassed;
  } finally {
    // Cleanup runs even when a scenario throws; process.exit only happens
    // after this block (process.exit would skip finally).
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runGate(extraArgs) {
  const run = spawnSync(process.execPath, [SCRIPT_PATH, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: SELF_TEST_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return { exitCode: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    // Exit only after runSelfTest returned, so its finally block cleaned up.
    process.exit(runSelfTest(options) ? 0 : 1);
  }

  const ledger = readJsonDocument(options.ledger, "compatibility ledger");
  state.ledger = ledger;
  const upstreamMap = readJsonDocument(options.upstreamMap, "upstream map");

  // Schema validation comes first: "a known-gap/not-applicable entry without a
  // reason fails" must be a cheap, observable check before anything runs.
  const ledgerProblems = validateLedger(ledger);
  if (ledgerProblems.length > 0) {
    finish(2, ledgerProblems);
  }

  const ledgerUpIds = ledger.entries.filter((entry) => entry.suite === "up").map((entry) => entry.id);
  const upstreamProblems = validateUpstreamMap(upstreamMap, {
    ledgerIds: new Set(ledgerUpIds),
    readFile: (localPath) => readFileSync(resolve(REPO_ROOT, localPath), "utf8"),
    exists: (localPath) => existsSync(resolve(REPO_ROOT, localPath)),
  });
  if (upstreamProblems.length > 0) {
    finish(2, upstreamProblems);
  }

  // Provenance anchors must not drift apart: the ledger's upstream map and the
  // T07 baseline manifest must pin the same commit.
  const baseline = readJsonDocument(BASELINE_PATH, "happy-dom baseline manifest");
  if (baseline?.happyDom?.gitCommit !== upstreamMap?.upstream?.commit) {
    failGate(
      `provenance anchor drift: upstream-map commit ${JSON.stringify(upstreamMap?.upstream?.commit)} differs from the ` +
        `baseline manifest gitCommit ${JSON.stringify(baseline?.happyDom?.gitCommit)}`,
    );
  }

  const realPairScenarioIds = await collectRealPairScenarioIds();
  const fixtureKeys = listFixtureKeys();
  const crossProblems = crossValidateLedger({ ledger, upstreamMap, realPairScenarioIds, fixtureKeys });
  if (crossProblems.length > 0) {
    finish(2, crossProblems);
  }

  const report = runLiveGate();
  const gate = evaluateGate(ledger, report);

  const summary = summarizeLedger(ledger);
  const summaryLines = [
    "mad-dom compatibility ledger gate (T11 / ADR-0002 sections 7)",
    `ledger: ${relRepo(options.ledger)} · ${summary.totals.entries} entr${summary.totals.entries === 1 ? "y" : "ies"} ` +
      `(pass ${summary.totals.pass} · known-gap ${summary.totals.knownGap} · not-applicable ${summary.totals.notApplicable})`,
    `upstream map: ${relRepo(options.upstreamMap)} · ${upstreamMap.entries.length} ported case(s) · ` +
      `upstream pinned to ${upstreamMap.upstream.commit.slice(0, 8)}… (${upstreamMap.upstream.license})`,
    `scenarios: ${gate.realPairScenarios} real-pair scenario(s) checked (${gate.checkedScenarios.join(", ") || "none"})`,
  ];

  if (gate.regressions.length > 0 || gate.stale.length > 0) {
    const problems = [
      ...gate.regressions.map(
        (regression) =>
          `pass regression: ${regression.id} (scenario ${regression.scenario}) now reports ${regression.differences} difference path(s)`,
      ),
      ...gate.stale.map(
        (item) =>
          `stale ledger entry: ${item.id} (scenario ${item.scenario}) reports 0 differences — flip it to "pass" ` +
          "(and drop reason/recordedAt) in the same commit to keep the ledger honest",
      ),
    ];
    finish(
      1,
      problems,
      gate,
      [
        ...summaryLines,
        `result: FAIL — ${gate.regressions.length} regression(s), ${gate.stale.length} stale ledger entry(ies); ` +
          "update the ledger in the same commit",
      ],
    );
  }

  finish(
    0,
    [],
    gate,
    [
      ...summaryLines,
      `result: OK — checked ${gate.realPairScenarios} real-pair scenario(s): 0 regression(s), 0 stale ledger entr${gate.realPairScenarios === 1 ? "y" : "ies"}`,
    ],
  );
}

await main();
