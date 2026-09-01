#!/usr/bin/env bun
// hdunit offline triage report (T05 / T11, ADR-0006).
//
// Reads tests/happy-dom/triage/*.json (the per-subsystem triage splits — the
// truth source for per-file state), validates their schema, and prints a
// per-subsystem status summary: enabled / expected-fail / skip counts and the
// enabled pass rate. It also compares the registered file count against the
// T02 rewrite-report test-source inventory so a file without a terminal state
// is visible (T10 acceptance: enabled+expected-fail+skip == inventory total).
//
// T11 adds a machine-readable pass rate and a baseline-delta: when
// tests/happy-dom/report-baseline.json exists (the last recorded summary,
// produced with --record-baseline), the --json document and the human table
// include per-subsystem enabled/expected-fail/skip deltas against that
// baseline. The committed baseline is the "previous wave" starting point
// recorded in COVERAGE.md, so a later wave can see its movement honestly.
//
// This is a pure offline aggregation — unlike validate-triage.mjs it never
// spawns bun test. Exit codes: 0 = triage declared and consistent with the
// inventory; 2 = schema/config error (the report could not be rendered).
//
// Usage:
//   bun tests/happy-dom/report.mjs [--json] [--record-baseline]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractInventory,
  loadSplits,
  summarizeSplits,
} from "./validate-triage.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_TRIAGE_DIR = join(SCRIPT_DIR, "triage");
const DEFAULT_REWRITE_REPORT = join(SCRIPT_DIR, "rewrite-report.json");
const DEFAULT_BASELINE = join(SCRIPT_DIR, "report-baseline.json");
const REPORT_SCHEMA = "mad-dom-hdunit-triage-report/1";
const BASELINE_SCHEMA = "mad-dom-hdunit-triage-baseline/1";

function toPosix(path) {
  return path.split("\\").join("/");
}

function passRate(enabled, total) {
  return total > 0 ? Math.round((enabled / total) * 100) : null;
}

function withPassRate(counts) {
  return { ...counts, passRate: passRate(counts.enabled, counts.total) };
}

function readBaseline() {
  try {
    const doc = JSON.parse(readFileSync(DEFAULT_BASELINE, "utf8"));
    if (!doc || !doc.totals || !doc.bySubsystem) return null;
    return doc;
  } catch {
    return null;
  }
}

function computeDelta(baseline, bySubsystem, totals) {
  if (!baseline) return null;
  const countFields = ["enabled", "expectedFail", "skip"];
  const base = (entry) => ({
    enabled: entry?.enabled ?? 0,
    expectedFail: entry?.expectedFail ?? 0,
    skip: entry?.skip ?? 0,
  });
  const deltaSubsystems = {};
  const names = new Set([...Object.keys(bySubsystem), ...Object.keys(baseline.bySubsystem ?? {})]);
  for (const name of [...names].sort()) {
    const current = base(bySubsystem[name]);
    const previous = base(baseline.bySubsystem[name]);
    const delta = {};
    for (const field of countFields) delta[field] = current[field] - previous[field];
    deltaSubsystems[name] = delta;
  }
  const baseTotals = base(baseline.totals);
  const totalsDelta = {};
  for (const field of countFields) totalsDelta[field] = totals[field] - baseTotals[field];
  return { totals: totalsDelta, bySubsystem: deltaSubsystems };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const recordBaseline = args.includes("--record-baseline");
  if (args.some((argument) => argument !== "--json" && argument !== "--record-baseline")) {
    console.error("unknown argument; supported flags: --json, --record-baseline");
    process.exit(2);
  }

  const { documents, problems } = loadSplits(DEFAULT_TRIAGE_DIR);
  if (problems.length > 0) {
    console.error(`hdunit triage report: FAIL with ${problems.length} problem(s)`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(2);
  }

  let rewriteReport;
  try {
    rewriteReport = JSON.parse(readFileSync(DEFAULT_REWRITE_REPORT, "utf8"));
  } catch (error) {
    console.error(`hdunit triage report: cannot read ${toPosix(relative(REPO_ROOT, DEFAULT_REWRITE_REPORT))}: ${error.message}`);
    process.exit(2);
  }
  const inventory = extractInventory(rewriteReport);
  const { bySubsystem, totals } = summarizeSplits(documents);
  const registered = totals.total;
  const declaredEveryFile = registered === inventory.size;
  let baseline = readBaseline();
  let delta = computeDelta(baseline, bySubsystem, totals);
  const bySubsystemRates = Object.fromEntries(
    Object.entries(bySubsystem).map(([name, counts]) => [name, withPassRate(counts)]),
  );

  if (recordBaseline) {
    writeFileSync(
      DEFAULT_BASELINE,
      `${JSON.stringify(
        {
          schema: BASELINE_SCHEMA,
          generatedAt: new Date().toISOString(),
          totals: { enabled: totals.enabled, expectedFail: totals.expectedFail, skip: totals.skip, total: totals.total },
          bySubsystem: Object.fromEntries(
            Object.entries(bySubsystem).map(([name, counts]) => [
              name,
              { enabled: counts.enabled, expectedFail: counts.expectedFail, skip: counts.skip, total: counts.total },
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
    baseline = readBaseline();
    delta = computeDelta(baseline, bySubsystem, totals);
  }

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          schema: REPORT_SCHEMA,
          inventory: { testSourceFiles: inventory.size, registered, complete: declaredEveryFile },
          totals: withPassRate(totals),
          bySubsystem: bySubsystemRates,
          baseline: baseline
            ? { present: true, generatedAt: baseline.generatedAt ?? null, totals: baseline.totals }
            : { present: false },
          delta,
        },
        null,
        2,
      ),
    );
    process.exit(declaredEveryFile ? 0 : 2);
  }

  const names = Object.keys(bySubsystem);
  const nameWidth = Math.max(...names.map((name) => name.length), "subsystem".length) + 2;
  const header =
    "subsystem".padEnd(nameWidth) +
    ["total", "enabled", "expected-fail", "skip", "pass-rate"].map((column) => column.padEnd(12)).join("");
  console.log("mad-dom hdunit triage report (T05 / T11 / ADR-0006)");
  console.log(`triage: ${toPosix(relative(REPO_ROOT, DEFAULT_TRIAGE_DIR))} · ${documents.length} subsystem split(s)`);
  if (recordBaseline) {
    console.log(`baseline: recorded → ${toPosix(relative(REPO_ROOT, DEFAULT_BASELINE))}`);
  }
  console.log("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const name of names) {
    const counts = bySubsystem[name];
    const rate = passRate(counts.enabled, counts.total);
    console.log(
      name.padEnd(nameWidth) +
        [counts.total, counts.enabled, counts.expectedFail, counts.skip, rate === null ? "n/a" : `${rate}%`]
          .map((value) => String(value).padEnd(12))
          .join(""),
    );
  }
  const totalRate = passRate(totals.enabled, totals.total);
  console.log(
    "total".padEnd(nameWidth) +
      [totals.total, totals.enabled, totals.expectedFail, totals.skip, totalRate === null ? "n/a" : `${totalRate}%`]
        .map((value) => String(value).padEnd(12))
        .join(""),
  );
  console.log("");
  console.log(
    `inventory: ${inventory.size} test-source rewritten file(s) in rewrite-report.json · ${registered} registered in triage ` +
      `(${declaredEveryFile ? "all files have a terminal state" : "MISMATCH — some files have no declared state"})`,
  );
  if (baseline) {
    const d = delta.totals;
    const sign = (value) => (value > 0 ? `+${value}` : String(value));
    console.log(
      `baseline: ${toPosix(relative(REPO_ROOT, DEFAULT_BASELINE))} (${baseline.generatedAt ?? "unknown"}) · ` +
        `delta vs baseline: enabled ${sign(d.enabled)} · expected-fail ${sign(d.expectedFail)} · skip ${sign(d.skip)}`,
    );
  } else {
    console.log(`baseline: none recorded — run with --record-baseline to persist the current summary`);
  }
  console.log("machine-readable summary: bun tests/happy-dom/report.mjs --json");
  process.exit(declaredEveryFile ? 0 : 2);
}

main();
