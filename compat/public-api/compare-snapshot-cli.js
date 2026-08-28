#!/usr/bin/env bun
// CLI wrapper around compare-snapshot.js (see that file for the difference
// categories and the informational symbol rule).
//
// Usage:
//   bun compat/public-api/compare-snapshot-cli.js <expected.json> <actual.json> [--strict]
//
// Exit codes: 0 = compatible (no hard differences; informational-only
// differences are reported but tolerated), 1 = hard differences (or any
// difference with --strict) or unreadable input.
import { readFileSync } from "node:fs";
import { countByCategory, compareSnapshots, DIFFERENCE_CATEGORIES } from "./compare-snapshot.js";

const args = process.argv.slice(2);
const paths = args.filter((argument) => argument !== "--strict");
const strict = args.includes("--strict");
if (paths.length !== 2) {
  console.error("usage: bun compare-snapshot-cli.js <expected.json> <actual.json> [--strict]");
  process.exit(1);
}

let expected;
let actual;
try {
  expected = JSON.parse(readFileSync(paths[0], "utf8"));
} catch (error) {
  console.error(`compare-snapshot: cannot read expected ${paths[0]}: ${error.message}`);
  process.exit(1);
}
try {
  actual = JSON.parse(readFileSync(paths[1], "utf8"));
} catch (error) {
  console.error(`compare-snapshot: cannot read actual ${paths[1]}: ${error.message}`);
  process.exit(1);
}

const result = compareSnapshots(expected, actual, { strict });
const counted = countByCategory(result.differences);
const summary = DIFFERENCE_CATEGORIES.map((category) => `${category}=${counted[category] ?? 0}`).join(" ");
console.log(`compare-snapshot: differences ${result.differences.length} (${summary})`);

if (result.ok) {
  if (result.informational.length > 0) {
    console.log(
      `compare-snapshot: OK (informational-only differences: ${result.informational.length}; hard gate not affected)`,
    );
    for (const difference of result.informational.slice(0, 10)) {
      console.log(`  informational ${difference.path}: ${difference.category}`);
    }
  } else {
    console.log("compare-snapshot: OK (identical)");
  }
  process.exit(0);
}

const first = result.hard[0] ?? result.differences[0];
console.error(`compare-snapshot: FAIL first difference at ${first.path}`);
for (const difference of result.hard.slice(0, 20)) {
  console.error(
    `  ${difference.category} ${difference.path}: expected ${difference.expected ?? "<absent>"}, actual ${difference.actual ?? "<absent>"}`,
  );
}
if (result.hard.length > 20) {
  console.error(`  ... and ${result.hard.length - 20} more`);
}
process.exit(1);
