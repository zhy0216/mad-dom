#!/usr/bin/env bun
// Offline compatibility ledger report (T11, ADR-0002 section 7).
//
// Reads compat/ledger.json, validates its schema and prints a status summary
// grouped by subsystem. This is a pure offline aggregation: unlike
// validate-ledger.js it never spawns the differential runner.
//
// Usage:
//   bun compat/ledger-report.js [--json]
//
// Exit codes: 0 = ledger valid (report printed); 2 = schema/config error.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeLedger, validateLedger } from "./ledger-lib.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_LEDGER = join(SCRIPT_DIR, "ledger.json");
const REPORT_SCHEMA = "mad-dom-compat-ledger-report/1";

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

  const ledgerPath = DEFAULT_LEDGER;
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    console.error(`ledger report: cannot read ${toPosix(relative(REPO_ROOT, ledgerPath))}: ${error.message}`);
    process.exit(2);
  }

  const problems = validateLedger(ledger);
  if (problems.length > 0) {
    console.error(`ledger report: FAIL with ${problems.length} problem(s)`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(2);
  }

  const { totals, bySubsystem, bySuite } = summarizeLedger(ledger);
  const entries = ledger.entries
    .map((entry) => ({ id: entry.id, suite: entry.suite, subsystem: entry.subsystem, status: entry.status }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (jsonMode) {
    console.log(JSON.stringify({ schema: REPORT_SCHEMA, totals, bySubsystem, bySuite, entries }, null, 2));
    process.exit(0);
  }

  const subsystemNames = Object.keys(bySubsystem);
  const nameWidth = Math.max(...subsystemNames.map((name) => name.length), "subsystem".length) + 2;
  const columnWidth = 8;
  const header =
    "subsystem".padEnd(nameWidth) +
    ["entries", "pass", "known-gap", "not-applicable"].map((name) => name.padEnd(columnWidth)).join("");
  console.log("mad-dom compatibility ledger report (T11 / ADR-0002 section 7)");
  console.log(`ledger: ${toPosix(relative(REPO_ROOT, ledgerPath))} · schema ${ledger.schemaVersion}`);
  console.log("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const name of subsystemNames) {
    const bucket = bySubsystem[name];
    console.log(
      name.padEnd(nameWidth) +
        [bucket.entries, bucket.pass, bucket.knownGap, bucket.notApplicable].map((count) => String(count).padEnd(columnWidth)).join(""),
    );
  }
  console.log(
    "total".padEnd(nameWidth) +
      [totals.entries, totals.pass, totals.knownGap, totals.notApplicable].map((count) => String(count).padEnd(columnWidth)).join(""),
  );
  console.log("");
  console.log(
    `suites: ` +
      Object.entries(bySuite)
        .map(([suite, bucket]) => `${suite} ${bucket.entries} (pass ${bucket.pass}, known-gap ${bucket.knownGap}, not-applicable ${bucket.notApplicable})`)
        .join(" · "),
  );
  console.log("machine-readable summary: bun compat/ledger-report.js --json");
  process.exit(0);
}

main();
