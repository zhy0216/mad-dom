#!/usr/bin/env bun
// hdunit triage gate (T05, ADR-0006).
//
// Validates the hdunit triage splits (tests/happy-dom/triage/<subsystem>.json),
// cross-checks them against the T02 rewritten file inventory
// (rewrite-report.json), the ledger hdunit coverage entries and the upstream
// provenance map, and finally live-runs every enabled / expected-fail file
// under the bun adapter (preload + 500ms timeout, matching compat:hdunit:test).
//
// Triage is the truth source for per-file state; the ledger coverage entries
// only record the split counts. Every vendored test file must reach exactly one
// terminal state (enabled / skip / expected-fail); skip and expected-fail must
// carry a reason, and no file may silently escape the gate.
//
// Exit codes:
//   0 — gate holds;
//   1 — degradation or cross-document inconsistency (an enabled file fails to
//       run green, an expected-fail file went green, a ledger/upstream-map/
//       triage state disagrees with another);
//   2 — schema/config/infrastructure error (the gate could not be judged).
//
// Usage:
//   bun tests/happy-dom/validate-triage.mjs [--triage-dir <dir>]
//       [--rewritten-dir <dir>] [--ledger <path>] [--upstream-map <path>]
//       [--rewrite-report <path>] [--root <dir>] [--json] [--self-test]
//
// The --root flag rebases relative-path resolution (file existence, upstream
// map localPath, live test files) onto an alternate root so the tamper
// self-test can run against temporary copies; all other flags default to the
// repository layout.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_HAPPY_DOM_COMMIT,
  UPSTREAM_LICENSE,
  isHdunitCoverageEntry,
  validateLedger,
  validateUpstreamMap,
} from "../../compat/ledger-lib.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_TRIAGE_DIR = join(SCRIPT_DIR, "triage");
const DEFAULT_REWRITTEN_DIR = join(SCRIPT_DIR, "rewritten");
const DEFAULT_LEDGER = join(REPO_ROOT, "compat", "ledger.json");
const DEFAULT_UPSTREAM_MAP = join(REPO_ROOT, "compat", "upstream-map.json");
const DEFAULT_REWRITE_REPORT = join(SCRIPT_DIR, "rewrite-report.json");
const PRELOAD = join(SCRIPT_DIR, "adapter", "preload.ts");

const GATE_SCHEMA = "mad-dom-hdunit-triage-gate/1";
const TRIAGE_SCHEMA_VERSION = "1.0.0";
const TRIAGE_STATUSES = { ENABLED: "enabled", SKIP: "skip", EXPECTED_FAIL: "expected-fail" };
const TRIAGE_ROOT_FIELDS = ["schemaVersion", "subsystem", "entries"];
const TRIAGE_ENTRY_FIELDS = ["file", "status", "reason", "ledgerId"];
const REWRITTEN_PREFIX = "tests/happy-dom/rewritten/";
const LIVE_TEST_TIMEOUT_MS = 60_000;
const SELF_TEST_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 32 * 1024 * 1024;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkKeys(problems, path, object, allowedKeys) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) {
      problems.push(`${path}.${key}: unknown field (schema forbids extra keys)`);
    }
  }
}

function toPosix(path) {
  return path.split("\\").join("/");
}

function relRepo(path) {
  return toPosix(relative(REPO_ROOT, path));
}

function failGate(message) {
  console.error(`hdunit triage gate error: ${message}`);
  process.exit(2);
}

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
  const options = {
    triageDir: DEFAULT_TRIAGE_DIR,
    rewrittenDir: DEFAULT_REWRITTEN_DIR,
    ledger: DEFAULT_LEDGER,
    upstreamMap: DEFAULT_UPSTREAM_MAP,
    rewriteReport: DEFAULT_REWRITE_REPORT,
    root: REPO_ROOT,
    json: false,
    selfTest: false,
  };
  const flags = {
    "--triage-dir": "triageDir",
    "--rewritten-dir": "rewrittenDir",
    "--ledger": "ledger",
    "--upstream-map": "upstreamMap",
    "--rewrite-report": "rewriteReport",
    "--root": "root",
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else if (Object.hasOwn(flags, argument)) {
      options[flags[argument]] = resolve(argv[++index] ?? failGate(`${argument} requires a path`));
    } else {
      failGate(
        `unknown argument ${JSON.stringify(argument)}; supported: --triage-dir, --rewritten-dir, --ledger, --upstream-map, --rewrite-report, --root, --json, --self-test`,
      );
    }
  }
  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported so report.mjs can reuse them offline)
// ─────────────────────────────────────────────────────────────────────────────

export function validateSplitDocument(doc, at) {
  const problems = [];
  if (!isObject(doc)) {
    problems.push(`${at}: must be a JSON object`);
    return problems;
  }
  checkKeys(problems, at, doc, TRIAGE_ROOT_FIELDS);
  if (doc.schemaVersion !== TRIAGE_SCHEMA_VERSION) {
    problems.push(`${at}.schemaVersion: must be ${JSON.stringify(TRIAGE_SCHEMA_VERSION)}, got ${JSON.stringify(doc.schemaVersion)}`);
  }
  if (!isNonEmptyString(doc.subsystem)) {
    problems.push(`${at}.subsystem: must be a non-empty string (the hdunit subsystem this split covers)`);
  }
  if (!Array.isArray(doc.entries)) {
    problems.push(`${at}.entries: must be an array`);
    return problems;
  }
  doc.entries.forEach((entry, index) => {
    const atEntry = `${at}.entries[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${atEntry}: must be an object`);
      return;
    }
    checkKeys(problems, atEntry, entry, TRIAGE_ENTRY_FIELDS);
    if (!isNonEmptyString(entry.file)) {
      problems.push(`${atEntry}.file: must be a non-empty string (path relative to tests/happy-dom/rewritten/)`);
    }
    if (!Object.values(TRIAGE_STATUSES).includes(entry.status)) {
      problems.push(
        `${atEntry}.status: must be one of ${JSON.stringify(Object.values(TRIAGE_STATUSES))}, got ${JSON.stringify(entry.status)}`,
      );
    }
    if (entry.status === TRIAGE_STATUSES.SKIP || entry.status === TRIAGE_STATUSES.EXPECTED_FAIL) {
      if (!isNonEmptyString(entry.reason)) {
        problems.push(`${atEntry}.reason: must be a non-empty string when status is ${JSON.stringify(entry.status)}`);
      }
    } else if (entry.reason !== undefined) {
      problems.push(`${atEntry}.reason: must be absent for status ${JSON.stringify(entry.status)} (a pass needs no explanation)`);
    }
    if (entry.ledgerId !== undefined && !isNonEmptyString(entry.ledgerId)) {
      problems.push(`${atEntry}.ledgerId: must be a non-empty string when present (the hdunit ledger entry id for this file)`);
    }
  });
  return problems;
}

export function loadSplits(triageDir) {
  const problems = [];
  let files = [];
  try {
    files = readdirSync(triageDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    failGate(`cannot read triage dir ${relRepo(triageDir)}: ${error.message}`);
  }
  if (files.length === 0) {
    failGate(`no triage split files found under ${relRepo(triageDir)}`);
  }
  const documents = [];
  for (const name of files) {
    const path = join(triageDir, name);
    const at = `triage/${name}`;
    const doc = readJsonDocument(path, "triage split");
    problems.push(...validateSplitDocument(doc, at));
    if (doc !== null && typeof doc === "object" && typeof doc.subsystem === "string") {
      documents.push({ subsystem: doc.subsystem, path, name, doc });
    } else {
      documents.push({ subsystem: name.replace(/\.json$/, ""), path, name, doc });
    }
  }
  return { documents, problems };
}

export function summarizeSplits(documents) {
  const bySubsystem = {};
  for (const { subsystem, doc } of documents) {
    if (!Array.isArray(doc.entries)) continue;
    const counts = { enabled: 0, expectedFail: 0, skip: 0 };
    for (const entry of doc.entries) {
      // Triage status values use the kebab form `expected-fail` (see
      // TRIAGE_STATUSES) while the count key is the ledger field
      // `expectedFail`; map the two so the split counts stay in sync.
      if (entry.status === TRIAGE_STATUSES.EXPECTED_FAIL) {
        counts.expectedFail += 1;
      } else if (Object.hasOwn(counts, entry.status)) {
        counts[entry.status] += 1;
      }
    }
    counts.total = doc.entries.length;
    bySubsystem[subsystem] = counts;
  }
  const totals = { enabled: 0, expectedFail: 0, skip: 0, total: 0 };
  for (const counts of Object.values(bySubsystem)) {
    totals.enabled += counts.enabled;
    totals.expectedFail += counts.expectedFail;
    totals.skip += counts.skip;
    totals.total += counts.total;
  }
  return { bySubsystem, totals };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory + structural checks (exit 2 class)
// ─────────────────────────────────────────────────────────────────────────────

export function extractInventory(rewriteReport) {
  const inventory = new Set();
  if (isObject(rewriteReport) && Array.isArray(rewriteReport.files)) {
    for (const file of rewriteReport.files) {
      if (file?.fileKind === "test-source" && file?.mode === "rewritten" && typeof file.vendorPath === "string") {
        inventory.add(file.vendorPath);
      }
    }
  }
  return inventory;
}

export function collectInventoryProblems({ documents, rewriteReport, rewrittenDir }) {
  const problems = [];
  const inventory = extractInventory(rewriteReport);
  if (inventory.size === 0) {
    problems.push("$: rewrite report declares no test-source rewritten files — cannot judge hdunit coverage");
  }

  const seenFiles = new Map();
  for (const { subsystem, name, doc } of documents) {
    const expectedSubsystem = name.replace(/\.json$/, "");
    if (subsystem !== expectedSubsystem) {
      problems.push(
        `triage/${name}.subsystem: must equal the split filename ${JSON.stringify(expectedSubsystem)}, got ${JSON.stringify(subsystem)}`,
      );
    }
    if (!Array.isArray(doc.entries)) continue;
    for (const [index, entry] of doc.entries.entries()) {
      const at = `triage/${name}.entries[${index}]`;
      if (typeof entry.file !== "string") continue;
      if (!existsSync(resolve(rewrittenDir, entry.file))) {
        problems.push(`${at}: file does not exist under rewritten/: ${JSON.stringify(entry.file)}`);
      }
      if (!inventory.has(entry.file)) {
        problems.push(
          `${at}: file ${JSON.stringify(entry.file)} is not a test-source rewritten file in rewrite-report.json ` +
            "(triage may only register files produced by the T02 rewrite)",
        );
      }
      if (seenFiles.has(entry.file)) {
        problems.push(
          `${at}: file ${JSON.stringify(entry.file)} is already registered in ${JSON.stringify(seenFiles.get(entry.file))} ` +
            "(each file must have exactly one terminal state)",
        );
      }
      seenFiles.set(entry.file, name);
    }
  }

  for (const vendorPath of [...inventory].sort()) {
    if (!seenFiles.has(vendorPath)) {
      problems.push(
        `rewrite-report: test-source file ${JSON.stringify(vendorPath)} has no triage registration ` +
          "(every vendored test file must reach a declared terminal state)",
      );
    }
  }

  return problems;
}

function collectPerFileLedgerPathProblems(ledger, inventory) {
  const problems = [];
  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    if (entry?.suite !== "hdunit" || isHdunitCoverageEntry(entry)) continue;
    const file = typeof entry.vendorPath === "string" && entry.vendorPath.startsWith(REWRITTEN_PREFIX)
      ? entry.vendorPath.slice(REWRITTEN_PREFIX.length)
      : null;
    if (file === null) {
      problems.push(
        `ledger.entry ${JSON.stringify(entry.id)}.vendorPath: per-file hdunit entries must point at a rewritten file under ${REWRITTEN_PREFIX}`,
      );
    } else if (!inventory.has(file)) {
      problems.push(
        `ledger.entry ${JSON.stringify(entry.id)}.vendorPath: ${JSON.stringify(entry.vendorPath)} is not a test-source rewritten file`,
      );
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-document consistency (exit 1 class)
// ─────────────────────────────────────────────────────────────────────────────

function splitFileStates(documents) {
  const states = new Map();
  for (const { doc } of documents) {
    if (!Array.isArray(doc.entries)) continue;
    for (const entry of doc.entries) {
      if (typeof entry.file === "string") states.set(entry.file, entry);
    }
  }
  return states;
}

export function collectConsistencyProblems({ documents, ledger, upstreamMap }) {
  const problems = [];
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const mapEntries = Array.isArray(upstreamMap?.entries) ? upstreamMap.entries : [];
  const bySubsystem = {};
  for (const { subsystem, doc } of documents) {
    bySubsystem[subsystem] = Array.isArray(doc.entries) ? doc.entries : [];
  }

  // 1. Ledger coverage entries ↔ triage splits (bidirectional).
  for (const subsystem of Object.keys(bySubsystem).sort()) {
    const coverageId = `hc-hdunit-${subsystem}-coverage`;
    const coverage = entries.find((entry) => entry?.id === coverageId);
    if (!coverage) {
      problems.push(
        `consistency: subsystem ${JSON.stringify(subsystem)} has a triage split but no hc-hdunit-${subsystem}-coverage ledger entry`,
      );
      continue;
    }
    if (!isHdunitCoverageEntry(coverage)) {
      problems.push(`consistency: ledger entry ${JSON.stringify(coverageId)} is not a valid hdunit coverage entry`);
      continue;
    }
    const counts = summarizeSplits([{ subsystem, doc: { entries: bySubsystem[subsystem] } }]).totals;
    for (const field of ["enabled", "expectedFail", "skip"]) {
      if (coverage[field] !== counts[field]) {
        problems.push(
          `consistency: ${coverageId}.${field} is ${coverage[field]} but the triage split records ${counts[field]} ` +
            "(the ledger coverage counts must match the triage split — the split is the truth source)",
        );
      }
    }
    if (typeof coverage.vendorPath === "string" && !coverage.vendorPath.endsWith(`triage/${subsystem}.json`)) {
      problems.push(
        `consistency: ${coverageId}.vendorPath should point at the triage split (triage/${subsystem}.json), got ${JSON.stringify(coverage.vendorPath)}`,
      );
    }
  }
  for (const entry of entries) {
    if (!isHdunitCoverageEntry(entry)) continue;
    const subsystem = entry.id.slice("hc-hdunit-".length, -"-coverage".length);
    if (!Object.hasOwn(bySubsystem, subsystem)) {
      problems.push(
        `consistency: ledger coverage entry ${JSON.stringify(entry.id)} has no triage split for subsystem ${JSON.stringify(subsystem)}`,
      );
    }
  }

  const states = splitFileStates(documents);
  const perFileEntries = entries.filter((entry) => entry?.suite === "hdunit" && !isHdunitCoverageEntry(entry));
  const perFileById = new Map(perFileEntries.map((entry) => [entry.id, entry]));
  const perFileFile = (entry) =>
    typeof entry.vendorPath === "string" && entry.vendorPath.startsWith(REWRITTEN_PREFIX)
      ? entry.vendorPath.slice(REWRITTEN_PREFIX.length)
      : null;

  // 2. Enabled triage files: ledgerId + per-file ledger entry + provenance.
  for (const [file, triageEntry] of [...states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (triageEntry.status !== TRIAGE_STATUSES.ENABLED) continue;
    const ledgerId = triageEntry.ledgerId;
    if (!isNonEmptyString(ledgerId)) {
      problems.push(
        `consistency: enabled file ${JSON.stringify(file)} must declare ledgerId (the hdunit per-file ledger entry id)`,
      );
      continue;
    }
    const ledgerEntry = perFileById.get(ledgerId);
    if (!ledgerEntry) {
      problems.push(
        `consistency: enabled file ${JSON.stringify(file)} declares ledgerId ${JSON.stringify(ledgerId)} which is not a per-file hdunit ledger entry`,
      );
      continue;
    }
    if (perFileFile(ledgerEntry) !== file) {
      problems.push(
        `consistency: ledger entry ${JSON.stringify(ledgerId)}.vendorPath ${JSON.stringify(ledgerEntry.vendorPath)} ` +
          `does not match enabled file ${JSON.stringify(file)}`,
      );
    }
    const provenance = mapEntries.find((entry) => entry?.localId === ledgerId);
    if (!provenance) {
      problems.push(
        `consistency: enabled file ${JSON.stringify(file)} has no upstream-map entry (localId ${JSON.stringify(ledgerId)}) — ` +
          "every enabled file must register provenance",
      );
    } else if (provenance.localPath !== `${REWRITTEN_PREFIX}${file}`) {
      problems.push(
        `consistency: upstream-map localId ${JSON.stringify(ledgerId)}.localPath ${JSON.stringify(provenance.localPath)} ` +
          `does not match the enabled file ${JSON.stringify(file)}`,
      );
    }
  }

  // 3. Per-file ledger entries must be backed by an enabled file + provenance.
  for (const ledgerEntry of perFileEntries) {
    const file = perFileFile(ledgerEntry);
    if (file === null) continue;
    const state = states.get(file)?.status;
    if (state !== TRIAGE_STATUSES.ENABLED) {
      problems.push(
        `consistency: hdunit ledger entry ${JSON.stringify(ledgerEntry.id)} references ${JSON.stringify(ledgerEntry.vendorPath)} ` +
          `which is ${state === undefined ? "not registered in any triage split" : `triaged as "${state}"`} — ` +
          "per-file entries exist only for enabled files",
      );
    }
    if (!mapEntries.some((entry) => entry?.localId === ledgerEntry.id)) {
      problems.push(
        `consistency: hdunit ledger entry ${JSON.stringify(ledgerEntry.id)} has no upstream-map entry ` +
          "(enabled hdunit files must register provenance)",
      );
    }
  }

  // 4. Upstream-map hdunit entries: never coverage ids, always a per-file entry
  // whose vendorPath matches and whose file is enabled.
  for (const mapEntry of mapEntries) {
    if (typeof mapEntry?.localId !== "string" || !mapEntry.localId.startsWith("hc-hdunit-")) continue;
    if (mapEntry.localId.endsWith("-coverage")) {
      problems.push(
        `consistency: upstream-map localId ${JSON.stringify(mapEntry.localId)} references an hdunit coverage (summary) entry — ` +
          "provenance is registered per enabled file, never per subsystem summary",
      );
      continue;
    }
    const ledgerEntry = perFileById.get(mapEntry.localId);
    if (!ledgerEntry) {
      problems.push(
        `consistency: upstream-map localId ${JSON.stringify(mapEntry.localId)} has no matching per-file hdunit ledger entry`,
      );
      continue;
    }
    const file = perFileFile(ledgerEntry);
    if (file === null) continue;
    if (mapEntry.localPath !== `${REWRITTEN_PREFIX}${file}`) {
      problems.push(
        `consistency: upstream-map localId ${JSON.stringify(mapEntry.localId)}.localPath ${JSON.stringify(mapEntry.localPath)} ` +
          `does not match ledger vendorPath ${JSON.stringify(ledgerEntry.vendorPath)}`,
      );
    }
    if (states.get(file)?.status !== TRIAGE_STATUSES.ENABLED) {
      problems.push(
        `consistency: upstream-map localId ${JSON.stringify(mapEntry.localId)} references ${JSON.stringify(mapEntry.localPath)} ` +
          "which is not an enabled triage file",
      );
    }
  }

  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live run (exit 1 class)
// ─────────────────────────────────────────────────────────────────────────────

function runTestFile(absPath) {
  const run = spawnSync(process.execPath, ["test", absPath, "--preload", PRELOAD, "--timeout", "500"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: LIVE_TEST_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
  });
  if (run.error !== undefined && run.error !== null) {
    return { exitCode: -1, error: run.error.message };
  }
  if (run.signal !== null) {
    return { exitCode: -1, error: `killed by signal ${run.signal}` };
  }
  return { exitCode: run.status ?? 1 };
}

export function collectLiveProblems(documents, rewrittenDir) {
  const problems = [];
  const runs = [];
  const pending = [];
  for (const { doc } of documents) {
    if (!Array.isArray(doc.entries)) continue;
    for (const entry of doc.entries) {
      if (entry.status === TRIAGE_STATUSES.ENABLED || entry.status === TRIAGE_STATUSES.EXPECTED_FAIL) {
        pending.push({ file: entry.file, status: entry.status, absPath: resolve(rewrittenDir, entry.file) });
      }
    }
  }
  pending.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const { file, status, absPath } of pending) {
    const result = runTestFile(absPath);
    runs.push({ file, status, exitCode: result.exitCode, error: result.error ?? null });
    if (status === TRIAGE_STATUSES.ENABLED && result.exitCode !== 0) {
      problems.push(
        `live: enabled ${JSON.stringify(file)} did not run green (exit ${result.exitCode}) — ` +
          "a declared-enabled file must pass under bun test; fix the facade/core difference or re-triage it",
      );
    } else if (status === TRIAGE_STATUSES.EXPECTED_FAIL && result.exitCode === 0) {
      problems.push(
        `live: expected-fail ${JSON.stringify(file)} unexpectedly passed — flip it to enabled (and register provenance) ` +
          "or re-declare its failure surface",
      );
    }
  }
  return { problems, runs };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI + self-test
// ─────────────────────────────────────────────────────────────────────────────

function runGate(extraArgs) {
  const run = spawnSync(process.execPath, [SCRIPT_PATH, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: SELF_TEST_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return { exitCode: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

function writeJson(path, document) {
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function copySplits(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(sourceDir).filter((entry) => entry.endsWith(".json")).sort()) {
    cpSync(join(sourceDir, name), join(targetDir, name));
  }
}

function runSelfTest(options) {
  const tempRoot = mkdtempSync(join(tmpdir(), "mad-dom-hdunit-triage-selftest-"));
  const scenarios = [];
  try {
    // D1 — a skip file flipped to enabled without the ledger and the live run
    // agreeing must trip the gate with exit 1. The temp triage copies all real
    // splits; nodes.json flips one propertysymbol file to enabled, so the ledger
    // coverage counts no longer match the split and the file is not declared.
    scenarios.push({
      name: "D1: flipping a skip file to enabled without it running green trips the gate (exit 1)",
      run: () => {
        const triageDir = join(tempRoot, "d1-triage");
        copySplits(options.triageDir, triageDir);
        const nodesPath = join(triageDir, "nodes.json");
        const nodes = JSON.parse(readFileSync(nodesPath, "utf8"));
        const target = nodes.entries.find((entry) => entry.file === "nodes/attr/Attr.test.ts");
        target.status = "enabled";
        delete target.reason;
        writeJson(nodesPath, nodes);
        return runGate(["--triage-dir", triageDir]);
      },
      expect: (result) => result.exitCode === 1,
    });

    // D2 — an enabled file that fails the live run is a regression: the gate
    // must exit 1. Built in a fully synthetic temp world (triage split, ledger
    // coverage + per-file entry, upstream-map entry, rewrite-report and a
    // rewritten test file that is guaranteed to fail forever), so the only
    // remaining problem is the live run itself.
    scenarios.push({
      name: "D2: an enabled file that fails to run green trips the live gate (exit 1)",
      run: () => {
        const world = join(tempRoot, "d2-world");
        const rewrittenDir = join(world, "tests/happy-dom/rewritten");
        mkdirSync(join(rewrittenDir, "selftest"), { recursive: true });
        mkdirSync(join(world, "compat"), { recursive: true });
        const triageDir = join(world, "triage");
        mkdirSync(triageDir, { recursive: true });
        writeFileSync(join(rewrittenDir, "selftest", "Regression.test.ts"), [
          "import { it, expect } from 'bun:test';",
          "it('self-test drill: enabled files must pass the live gate', () => {",
          "  expect(true).toBe(false);",
          "});",
          "",
        ].join("\n"));
        writeJson(join(world, "tests/happy-dom", "rewrite-report.json"), {
          generatedBy: "hdunit triage self-test",
          schemaVersion: "1.0.0",
          task: "T05",
          upstream: {
            repository: "https://github.com/capricorn86/happy-dom",
            commit: PINNED_HAPPY_DOM_COMMIT,
            tag: "v20.11.11",
            license: "MIT",
          },
          files: [
            {
              vendorPath: "selftest/Regression.test.ts",
              upstreamPath: "packages/happy-dom/test/selftest/Regression.test.ts",
              fileKind: "test-source",
              mode: "rewritten",
              importsMapped: 0,
              importsUnmapped: 0,
              viRewrites: { fn: 0, spyOn: 0, clearAllMocks: 0, restoreAllMocks: 0, mock: 0 },
            },
          ],
        });
        writeJson(join(triageDir, "selftest.json"), {
          schemaVersion: TRIAGE_SCHEMA_VERSION,
          subsystem: "selftest",
          entries: [
            { file: "selftest/Regression.test.ts", status: "enabled", ledgerId: "hc-hdunit-selftest-regression" },
          ],
        });
        writeJson(join(world, "compat", "ledger.json"), {
          schemaVersion: "1.0.0",
          note: "hdunit triage self-test world",
          entries: [
            {
              id: "hc-hdunit-selftest-coverage",
              suite: "hdunit",
              status: "pass",
              subsystem: "tooling",
              vendorPath: "tests/happy-dom/triage/selftest.json",
              enabled: 1,
              expectedFail: 0,
              skip: 0,
              addedIn: "T05",
            },
            {
              id: "hc-hdunit-selftest-regression",
              suite: "hdunit",
              status: "pass",
              subsystem: "tooling",
              vendorPath: "tests/happy-dom/rewritten/selftest/Regression.test.ts",
              addedIn: "T05",
            },
          ],
        });
        writeJson(join(world, "compat", "upstream-map.json"), {
          schemaVersion: "1.0.0",
          note: "hdunit triage self-test world",
          upstream: {
            repository: "https://github.com/capricorn86/happy-dom",
            commit: PINNED_HAPPY_DOM_COMMIT,
            license: "MIT",
          },
          entries: [
            {
              localId: "hc-hdunit-selftest-regression",
              upstreamPath: "packages/happy-dom/test/selftest/Regression.test.ts",
              upstreamCommit: PINNED_HAPPY_DOM_COMMIT,
              license: "MIT",
              localPath: "tests/happy-dom/rewritten/selftest/Regression.test.ts",
            },
          ],
        });
        return runGate([
          "--root", world,
          "--rewritten-dir", rewrittenDir,
          "--triage-dir", triageDir,
          "--ledger", join(world, "compat", "ledger.json"),
          "--upstream-map", join(world, "compat", "upstream-map.json"),
          "--rewrite-report", join(world, "tests/happy-dom", "rewrite-report.json"),
        ]);
      },
      expect: (result) => result.exitCode === 1 && /live: enabled/.test(result.output),
    });

    // D3 — a triage entry referencing a file that does not exist under
    // rewritten/ is a schema/structural error: exit 2.
    scenarios.push({
      name: "D3: triage referencing a nonexistent file is a schema error (exit 2)",
      run: () => {
        const triageDir = join(tempRoot, "d3-triage");
        copySplits(options.triageDir, triageDir);
        const nodesPath = join(triageDir, "nodes.json");
        const nodes = JSON.parse(readFileSync(nodesPath, "utf8"));
        nodes.entries[0].file = "nodes/nonexistent/NoSuchFile.test.ts";
        writeJson(nodesPath, nodes);
        return runGate(["--triage-dir", triageDir]);
      },
      expect: (result) => result.exitCode === 2 && /does not exist/.test(result.output),
    });

    // D4 — an upstream-map entry whose localId points at an hdunit coverage
    // (summary) id disagrees with the per-file provenance rule: exit 1.
    scenarios.push({
      name: "D4: upstream-map referencing an hdunit coverage id is inconsistent (exit 1)",
      run: () => {
        const upstreamPath = join(tempRoot, "d4-upstream-map.json");
        const upstream = JSON.parse(readFileSync(options.upstreamMap, "utf8"));
        upstream.entries.push({
          localId: "hc-hdunit-nodes-coverage",
          upstreamPath: "packages/happy-dom/test/nodes/attr/Attr.test.ts",
          upstreamCommit: PINNED_HAPPY_DOM_COMMIT,
          license: UPSTREAM_LICENSE,
          localPath: "tests/happy-dom/rewritten/dom/DOMPoint.test.ts",
        });
        writeJson(upstreamPath, upstream);
        return runGate(["--upstream-map", upstreamPath]);
      },
      expect: (result) => result.exitCode === 1 && /coverage/.test(result.output),
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
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    process.exit(runSelfTest(options) ? 0 : 1);
  }

  const ledger = readJsonDocument(options.ledger, "compatibility ledger");
  const upstreamMap = readJsonDocument(options.upstreamMap, "upstream map");
  const rewriteReport = readJsonDocument(options.rewriteReport, "rewrite report");
  const { documents, problems } = loadSplits(options.triageDir);

  // Phase A — schema & structural. Any problem here means the gate cannot be
  // judged at all.
  const inventory = extractInventory(rewriteReport);
  const inventoryProblems = collectInventoryProblems({
    documents,
    rewriteReport,
    rewrittenDir: options.rewrittenDir,
  });
  const perFilePathProblems = collectPerFileLedgerPathProblems(ledger, inventory);
  const ledgerUpIds = ledger.entries.filter((entry) => entry?.suite === "up").map((entry) => entry.id);
  const ledgerHdunitIds = ledger.entries.filter((entry) => entry?.suite === "hdunit").map((entry) => entry.id);
  const upstreamProblems = validateUpstreamMap(upstreamMap, {
    ledgerIds: new Set([...ledgerUpIds, ...ledgerHdunitIds]),
    suiteByLocalId: new Map(ledger.entries.map((entry) => [entry.id, entry.suite])),
    readFile: (localPath) => readFileSync(resolve(options.root, localPath), "utf8"),
    exists: (localPath) => existsSync(resolve(options.root, localPath)),
  });

  const schemaProblems = [
    ...problems,
    ...validateLedger(ledger),
    ...upstreamProblems,
    ...inventoryProblems,
    ...perFilePathProblems,
  ];
  if (schemaProblems.length > 0) {
    finish(2, schemaProblems, documents, ledger, [], options);
  }

  const consistencyProblems = collectConsistencyProblems({ documents, ledger, upstreamMap });
  if (consistencyProblems.length > 0) {
    finish(1, consistencyProblems, documents, ledger, [], options);
  }

  const { problems: liveProblems, runs } = collectLiveProblems(documents, options.rewrittenDir);
  finish(liveProblems.length > 0 ? 1 : 0, liveProblems, documents, ledger, runs, options);
}

function finish(exitCode, problems, documents, ledger, runs, options) {
  const { bySubsystem, totals } = summarizeSplits(documents);
  const hdunitEntries = Array.isArray(ledger?.entries) ? ledger.entries.filter((entry) => entry?.suite === "hdunit") : [];
  if (problems.length > 0) {
    console.error(`hdunit triage gate: FAIL with ${problems.length} problem(s)`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          schema: GATE_SCHEMA,
          ok: exitCode === 0,
          problems: [...problems].sort(),
          triage: {
            splits: documents.length,
            files: totals.total,
            totals,
            bySubsystem,
          },
          ledger: { hdunitEntries: hdunitEntries.length },
          liveRuns: runs,
        },
        null,
        2,
      ),
    );
  } else {
    const hdunit = hdunitEntries.length;
    const summaryLines = [
      "mad-dom hdunit triage gate (T05 / ADR-0006)",
      `triage: ${relRepo(options.triageDir)} · ${documents.length} subsystem split(s) · ${totals.total} file(s) registered ` +
        `(enabled ${totals.enabled} · expected-fail ${totals.expectedFail} · skip ${totals.skip})`,
      `ledger: ${relRepo(options.ledger)} · ${hdunit} hdunit entr${hdunit === 1 ? "y" : "ies"} · ` +
        `upstream map: ${relRepo(options.upstreamMap)}`,
    ];
    if (exitCode === 0) {
      console.log([...summaryLines, "result: OK — every vendored test file has a declared terminal state, no regressions"].join("\n"));
    } else {
      console.log([...summaryLines, `result: FAIL — see problems above (exit ${exitCode})`].join("\n"));
    }
  }
  process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
