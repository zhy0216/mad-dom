#!/usr/bin/env bun
// Integration-test benchmark: run the same happy-dom integration suite against
// both mad-dom and happy-dom under the bun test runner and compare wall-clock.
//
// Each suite lives in its own package under benchmark/:
//   - benchmark/mad-dom-integration-test   (imports `mad-dom`)
//   - benchmark/happy-dom-integration-test (imports `happy-dom`)
//
// The browser-exception-observer test cannot run inside a test runner (it
// captures process-level uncaught exceptions, which collide with the runner),
// so it is executed as a standalone script — mirroring the upstream design.
//
// Wall-clock is reported twice:
//   - "full"   — every test file. The Browser / XMLHttpRequest / WebSocket
//     cases hit real external endpoints (github.com, npmjs.com,
//     echo.websocket.org), so their latency dominates and is noisy.
//   - "local"  — only the deterministic, dependency-free cases (CommonJS,
//     Fetch over a local express server, WindowGlobals). This is the stable
//     DOM-workload signal for comparing the two implementations.
//
// Usage:
//   bun benchmark/run.mjs                 # run both suites, print comparison
//   bun benchmark/run.mjs --json          # same, machine-readable JSON
//   bun benchmark/run.mjs --iterations 5  # more samples per suite (default 3)
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const SUITES = [
  {
    name: "mad-dom",
    dir: join(SCRIPT_DIR, "mad-dom-integration-test"),
  },
  {
    name: "happy-dom",
    dir: join(SCRIPT_DIR, "happy-dom-integration-test"),
  },
];

// Files with no external network dependency — the stable DOM workload.
const LOCAL_FILES = ["test/CommonJS.test.cjs", "test/Fetch.test.js", "test/WindowGlobals.test.js"];
const OBSERVER_FILE = "test/browser-exception-observer/BrowserExceptionObserver.test.js";

const ITERATIONS = 3;

function parseArgs(argv) {
  const args = { json: false, iterations: ITERATIONS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--iterations") args.iterations = Number(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function run(cwd, args) {
  const started = performance.now();
  const result = spawnSync("bun", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const wallMs = performance.now() - started;
  // bun test prints its summary to stderr when stdout is not a TTY; parse the
  // combined stream so the summary is always found.
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { wallMs, status: result.status, stdout: combined };
}

function parseSummary(text) {
  const summary = { pass: null, fail: null, error: null, tests: null, files: null };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const passMatch = trimmed.match(/^(\d+) pass$/);
    const failMatch = trimmed.match(/^(\d+) fail$/);
    const errorMatch = trimmed.match(/^(\d+) errors?$/);
    const ranMatch = trimmed.match(/^Ran (\d+) tests across (\d+) files/);
    if (passMatch) summary.pass = Number(passMatch[1]);
    else if (failMatch) summary.fail = Number(failMatch[1]);
    else if (errorMatch) summary.error = Number(errorMatch[1]);
    else if (ranMatch) {
      summary.tests = Number(ranMatch[1]);
      summary.files = Number(ranMatch[2]);
    }
  }
  return summary;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runSuite(suite, iterations) {
  const fullTimes = [];
  const localTimes = [];
  let lastSummary = null;
  let lastObserver = null;

  for (let i = 0; i < iterations; i++) {
    const fullMain = run(suite.dir, ["test", "test", "--path-ignore-patterns", "**/browser-exception-observer/**"]);
    const localMain = run(suite.dir, ["test", ...LOCAL_FILES]);
    const observer = run(suite.dir, [OBSERVER_FILE]);
    fullTimes.push(fullMain.wallMs + observer.wallMs);
    localTimes.push(localMain.wallMs + observer.wallMs);
    lastSummary = parseSummary(fullMain.stdout);
    lastObserver = observer;
  }

  return {
    name: suite.name,
    dir: suite.dir,
    summary: lastSummary,
    observerStatus: lastObserver.status,
    full: { medianMs: median(fullTimes), minMs: Math.min(...fullTimes) },
    local: { medianMs: median(localTimes), minMs: Math.min(...localTimes) },
  };
}

function printReport(reports) {
  const width = 17;
  const row = (cells) => cells.map((cell) => String(cell).padEnd(width)).join("");
  console.log("integration-test benchmark: mad-dom vs happy-dom (bun test)");
  console.log(`bun ${process.versions.bun} · ${process.platform}/${process.arch}`);
  console.log("");
  console.log(row(["suite", "tests", "pass", "fail", "full median", "local median"]));
  console.log("-".repeat(width * 6));
  for (const report of reports) {
    console.log(
      row([
        report.name,
        report.summary.tests ?? "?",
        report.summary.pass ?? "?",
        report.summary.fail ?? "?",
        `${Math.round(report.full.medianMs)} ms`,
        `${Math.round(report.local.medianMs)} ms`,
      ]),
    );
  }
  console.log("");
  console.log("full:  all test files incl. external-network cases (github.com, npmjs.com, echo.websocket.org) — noisy");
  console.log("local: CommonJS + Fetch (local express) + WindowGlobals + exception observer — deterministic DOM workload");
  console.log("");

  const [fastest, slowest] = [...reports].sort((a, b) => a.local.medianMs - b.local.medianMs);
  const diff = ((slowest.local.medianMs / fastest.local.medianMs - 1) * 100).toFixed(1);
  console.log(`local workload: ${fastest.name} is ${diff}% faster than ${slowest.name}`);
  for (const report of reports) {
    console.log(`${report.name}: ${report.dir}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const reports = SUITES.map((suite) => runSuite(suite, args.iterations));

if (args.json) {
  console.log(
    JSON.stringify(
      {
        schema: "mad-dom-integration-bench/1",
        host: { os: process.platform, arch: process.arch, bun: process.versions.bun },
        iterations: args.iterations,
        suites: reports.map((r) => ({
          name: r.name,
          dir: r.dir,
          fullMedianMs: Math.round(r.full.medianMs),
          fullMinMs: Math.round(r.full.minMs),
          localMedianMs: Math.round(r.local.medianMs),
          localMinMs: Math.round(r.local.minMs),
          summary: r.summary,
          observerStatus: r.observerStatus,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

printReport(reports);
