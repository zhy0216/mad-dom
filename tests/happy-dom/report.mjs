#!/usr/bin/env bun
// hdunit offline triage report (T05, ADR-0006).
//
// Reads tests/happy-dom/triage/*.json (the per-subsystem triage splits — the
// truth source for per-file state), validates their schema, and prints a
// per-subsystem status summary: enabled / expected-fail / skip counts and the
// enabled pass rate. It also compares the registered file count against the
// T02 rewrite-report test-source inventory so a file without a terminal state
// is visible (T10 acceptance: enabled+expected-fail+skip == inventory total).
//
// This is a pure offline aggregation — unlike validate-triage.mjs it never
// spawns bun test. Exit codes: 0 = triage declared and consistent with the
// inventory; 2 = schema/config error (the report could not be rendered).
//
// Usage:
//   bun tests/happy-dom/report.mjs [--json]
import { readFileSync } from "node:fs";
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
const REPORT_SCHEMA = "mad-dom-hdunit-triage-report/1";

function toPosix(path) {
  return path.split("\\").join("/");
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  if (args.some((argument) => argument !== "--json")) {
    console.error("unknown argument; supported flags: --json");
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

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          schema: REPORT_SCHEMA,
          inventory: { testSourceFiles: inventory.size, registered, complete: declaredEveryFile },
          totals,
          bySubsystem,
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
  console.log("mad-dom hdunit triage report (T05 / ADR-0006)");
  console.log(`triage: ${toPosix(relative(REPO_ROOT, DEFAULT_TRIAGE_DIR))} · ${documents.length} subsystem split(s)`);
  console.log("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const name of names) {
    const counts = bySubsystem[name];
    const passRate = counts.total > 0 ? `${Math.round((counts.enabled / counts.total) * 100)}%` : "n/a";
    console.log(
      name.padEnd(nameWidth) +
        [counts.total, counts.enabled, counts.expectedFail, counts.skip, passRate].map((value) => String(value).padEnd(12)).join(""),
    );
  }
  const totalRate = totals.total > 0 ? `${Math.round((totals.enabled / totals.total) * 100)}%` : "n/a";
  console.log(
    "total".padEnd(nameWidth) +
      [totals.total, totals.enabled, totals.expectedFail, totals.skip, totalRate].map((value) => String(value).padEnd(12)).join(""),
  );
  console.log("");
  console.log(
    `inventory: ${inventory.size} test-source rewritten file(s) in rewrite-report.json · ${registered} registered in triage ` +
      `(${declaredEveryFile ? "all files have a terminal state" : "MISMATCH — some files have no declared state"})`,
  );
  console.log("machine-readable summary: bun tests/happy-dom/report.mjs --json");
  process.exit(declaredEveryFile ? 0 : 2);
}

main();
