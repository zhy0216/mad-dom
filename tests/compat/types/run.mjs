#!/usr/bin/env bun
// T09 — TypeScript dual-target compatibility harness driver (ADR-0002 section 4).
//
// Typechecks the shared fixtures twice with plain `tsc --pretty false`
// (never editor behavior): target happy-dom resolves the virtual module
// "dom-under-test" to node_modules/happy-dom/lib/index.d.ts (package entry
// only, no deep imports), target mad-dom resolves it to the repo-root
// index.d.ts. The two targets' diagnostics are then judged:
//
//   - happy-dom target: zero diagnostics for every fixture. Negative fixtures
//     rely on tsc's "Unused '@ts-expect-error' directive" (TS2578): a marked
//     line that stops erroring surfaces as TS2578 and fails the run, which
//     proves the negative assertions really execute.
//   - mad-dom target: every diagnostic must either match the diagnostics
//     patterns of an hc-types-* entry in compat/ledger.json (the T11
//     compatibility ledger, which owns the known-gap records since T09's
//     expected-divergences.json was migrated), be a genuine rejection of a
//     negative fixture's marked line, or — while the module-level import gap
//     persists (dom-under-test names missing on import lines) — be an
//     absorbed TS2578. Anything else is the ADR-0002 hard gate: mad-dom
//     accepts nothing that happy-dom accepts unless the gap is recorded
//     first.
//   - every divergence pattern must match at least one diagnostic; stale
//     patterns fail, so the ledger shrinks as MAD DOM's type surface grows.
//
// Usage: bun tests/compat/types/run.mjs [--json] [--self-test]
// Exit codes: 0 = pass, 1 = compatibility failure, 2 = harness/config error.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TYPES_DIR, "..", "..", "..");
const FIXTURES_DIR = join(TYPES_DIR, "fixtures");
// Since T11 the known-gap records live in the compatibility ledger; this
// harness only derives its hc-types-* entries from it (full schema validation
// belongs to compat/validate-ledger.js).
const LEDGER_PATH = join(REPO_ROOT, "compat", "ledger.json");
const TSC_ENTRY = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

const TARGETS = [
  { id: "happy-dom", config: join(TYPES_DIR, "happy-dom", "tsconfig.json") },
  { id: "mad-dom", config: join(TYPES_DIR, "mad-dom", "tsconfig.json") },
];

const DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const EXPECT_ERROR_DIRECTIVE = /\/\/\s*@ts-expect-error\b/;
const UNUSED_DIRECTIVE_CODE = 2578;
const IMPORT_GAP_CODES = new Set([2305, 2306, 2307, 2724, 2792]);
const MAX_BUFFER = 32 * 1024 * 1024;

function harnessError(message) {
  console.error(`harness error: ${message}`);
  process.exit(2);
}

function toPosix(path) {
  return path.split("\\").join("/");
}

function listFixtureFiles(dir = FIXTURES_DIR, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...listFixtureFiles(join(dir, entry.name), key));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(key);
    }
  }
  return found.sort();
}

function fixtureKind(key) {
  if (key.startsWith("positive/")) return "positive";
  if (key.startsWith("negative/")) return "negative";
  return null;
}

function readPackageVersion(packagePath) {
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function parseDiagnostics(stdout) {
  const diagnostics = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = DIAGNOSTIC_LINE.exec(line);
    if (!match) continue;
    const [, file, lineText, columnText, codeText, message] = match;
    const absolute = resolve(TYPES_DIR, file);
    const key = toPosix(relative(FIXTURES_DIR, absolute));
    diagnostics.push({
      fixture: key.startsWith("..") ? null : key,
      line: Number(lineText),
      column: Number(columnText),
      code: Number(codeText.slice(2)),
      message,
    });
  }
  return diagnostics;
}

function runTarget(target) {
  if (!existsSync(target.config)) {
    harnessError(`missing tsconfig for target ${target.id}: ${target.config}`);
  }
  const run = spawnSync(process.execPath, [TSC_ENTRY, "-p", target.config, "--pretty", "false"], {
    cwd: TYPES_DIR,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (run.error) {
    harnessError(`cannot execute tsc for target ${target.id}: ${run.error.message}`);
  }
  if (run.status === null) {
    harnessError(`tsc was killed by signal ${run.signal} for target ${target.id}`);
  }
  return { exitCode: run.status, diagnostics: parseDiagnostics(run.stdout ?? "") };
}

function describeDiagnostic(diagnostic) {
  return `TS${diagnostic.code} at ${diagnostic.fixture}:${diagnostic.line}:${diagnostic.column} (${diagnostic.message})`;
}

function describePattern(pattern) {
  const parts = [];
  if (pattern.code !== undefined) parts.push(`TS${pattern.code}`);
  if (pattern.messageIncludes !== undefined) parts.push(`message ~ ${JSON.stringify(pattern.messageIncludes)}`);
  if (pattern.line !== undefined) parts.push(`line ${pattern.line}`);
  return parts.join(", ");
}

function matchesPattern(diagnostic, pattern) {
  if (pattern.code !== undefined && diagnostic.code !== pattern.code) return false;
  if (pattern.line !== undefined && diagnostic.line !== pattern.line) return false;
  if (pattern.messageIncludes !== undefined && !diagnostic.message.includes(pattern.messageIncludes)) return false;
  return true;
}

// Light structural check on the hc-types-* entries derived from the ledger.
// The full ledger schema (ids, statuses, reasons, recordedAt, …) is owned by
// compat/validate-ledger.js; this harness only guards the fields it consumes,
// plus the two checks the original T09 divergence list performed itself:
// fixtures must exist and entry ids must be unique.
function describeLedgerTypesEntryProblems(entries, fixtureKeys) {
  const problems = [];
  const seenIds = new Set();
  entries.forEach((entry, index) => {
    const at = `hc-types entries[${index}] (${entry?.id ?? "unknown id"})`;
    if (typeof entry?.id === "string") {
      if (seenIds.has(entry.id)) {
        problems.push(`${at}: id ${JSON.stringify(entry.id)} is duplicated`);
      }
      seenIds.add(entry.id);
    }
    if (typeof entry?.fixture !== "string" || entry.fixture.trim() === "") {
      problems.push(`${at}: fixture must be a non-empty string`);
    } else if (!fixtureKeys.includes(entry.fixture)) {
      problems.push(`${at}: fixture must reference an existing fixture, got ${JSON.stringify(entry.fixture)}`);
    }
    if (entry?.status === "known-gap") {
      if (!Array.isArray(entry?.diagnostics)) {
        problems.push(`${at}: diagnostics must be an array of diagnostic patterns when status is "known-gap"`);
        return;
      }
    } else if (entry?.diagnostics !== undefined) {
      problems.push(`${at}: diagnostics must be absent unless status is "known-gap"`);
      return;
    }
    if (!Array.isArray(entry?.diagnostics)) {
      // A pass entry carries no diagnostics (the ledger schema forbids them);
      // there is nothing left to validate here.
      return;
    }
    entry.diagnostics.forEach((pattern, patternIndex) => {
      const atPattern = `${at}.diagnostics[${patternIndex}]`;
      if (pattern === null || typeof pattern !== "object" || Array.isArray(pattern)) {
        problems.push(`${atPattern} must be an object`);
        return;
      }
      for (const key of Object.keys(pattern)) {
        if (!["code", "messageIncludes", "line"].includes(key)) {
          problems.push(`${atPattern}: unknown field ${JSON.stringify(key)}`);
        }
      }
      if (pattern.code !== undefined && !(Number.isInteger(pattern.code) && pattern.code > 0)) {
        problems.push(`${atPattern}.code must be a positive integer when present`);
      }
      if (pattern.line !== undefined && !(Number.isInteger(pattern.line) && pattern.line > 0)) {
        problems.push(`${atPattern}.line must be a positive integer when present`);
      }
      if (pattern.messageIncludes !== undefined && !(typeof pattern.messageIncludes === "string" && pattern.messageIncludes !== "")) {
        problems.push(`${atPattern}.messageIncludes must be a non-empty string when present`);
      }
      if (pattern.code === undefined && pattern.messageIncludes === undefined && pattern.line === undefined) {
        problems.push(`${atPattern} must set at least one of code / messageIncludes / line`);
      }
    });
  });
  return problems;
}

function judgeFixture(fixture, happyDomDiagnostics, madDomDiagnostics, entriesForFixture, sourceText) {
  const failures = [];
  const importLines = new Set();
  const markedLines = new Set();
  sourceText.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (text.trimStart().startsWith("import ")) importLines.add(line);
    if (EXPECT_ERROR_DIRECTIVE.test(text)) {
      markedLines.add(line);
      markedLines.add(line + 1);
    }
  });

  if (happyDomDiagnostics.length > 0) {
    failures.push(
      `the ${fixture.kind} fixture must produce zero diagnostics on the happy-dom target, got ${happyDomDiagnostics.length}` +
        (fixture.kind === "negative"
          ? " — a diagnostic here means an @ts-expect-error marker was removed or became obsolete, so the negative assertion stopped executing"
          : ""),
    );
    for (const diagnostic of happyDomDiagnostics) {
      failures.push(`  happy-dom: ${describeDiagnostic(diagnostic)}`);
    }
  }

  const patterns = [];
  for (const entry of entriesForFixture) {
    // A pass entry carries no diagnostics (the ledger schema forbids them), so
    // it contributes no divergence patterns — zero mad-dom diagnostics then
    // judge the fixture as a clean pass.
    if (entry.status !== "known-gap") continue;
    for (const pattern of entry.diagnostics) {
      patterns.push({ entryId: entry.id, ...pattern });
    }
  }
  const matchedBy = madDomDiagnostics.map(() => null);
  const patternHits = patterns.map(() => 0);
  patterns.forEach((pattern, patternIndex) => {
    madDomDiagnostics.forEach((diagnostic, diagnosticIndex) => {
      if (matchesPattern(diagnostic, pattern)) {
        patternHits[patternIndex] += 1;
        if (matchedBy[diagnosticIndex] === null) matchedBy[diagnosticIndex] = pattern.entryId;
      }
    });
  });
  patterns.forEach((pattern, patternIndex) => {
    if (patternHits[patternIndex] === 0) {
      failures.push(
        `stale divergence entry ${JSON.stringify(pattern.entryId)}: no mad-dom diagnostic matches (${describePattern(pattern)}) — remove or update the entry`,
      );
    }
  });

  const importGaps = madDomDiagnostics.filter(
    (diagnostic) => IMPORT_GAP_CODES.has(diagnostic.code) && diagnostic.fixture !== null && importLines.has(diagnostic.line),
  );
  const gapMode = importGaps.length > 0;
  const tolerated = [];
  const uncovered = [];
  madDomDiagnostics.forEach((diagnostic, diagnosticIndex) => {
    if (matchedBy[diagnosticIndex] !== null) {
      tolerated.push(`${describeDiagnostic(diagnostic)} [divergence ${matchedBy[diagnosticIndex]}]`);
      return;
    }
    if (
      fixture.kind === "negative" &&
      diagnostic.code !== UNUSED_DIRECTIVE_CODE &&
      markedLines.has(diagnostic.line)
    ) {
      tolerated.push(`${describeDiagnostic(diagnostic)} [mad-dom rejects invalid usage]`);
      return;
    }
    if (diagnostic.code === UNUSED_DIRECTIVE_CODE) {
      if (gapMode) {
        tolerated.push(`${describeDiagnostic(diagnostic)} [absorbed by the module-level import gap rule]`);
        return;
      }
      uncovered.push(diagnostic);
      return;
    }
    uncovered.push(diagnostic);
  });

  for (const diagnostic of uncovered) {
    failures.push(
      fixture.kind === "positive"
        ? `hard gate: mad-dom rejects a public usage that the happy-dom target accepts: ${describeDiagnostic(diagnostic)} — fix the mad-dom types or record the gap in compat/ledger.json first`
        : `unexpected diagnostic on the mad-dom target (not a marked-line rejection): ${describeDiagnostic(diagnostic)}`,
    );
  }

  let status;
  if (failures.length > 0) {
    status = "FAIL";
  } else if (madDomDiagnostics.length === 0) {
    status = "pass";
  } else if (gapMode) {
    status = "known-gap: module-level missing exports";
  } else {
    status = "known-gap: pattern-covered rejections";
  }
  return { status, failures, tolerated };
}

function printSummary({ typescriptVersion, happyDomVersion, madDomVersion, rows, strayDiagnostics, entries }) {
  const nameWidth = Math.max(...rows.map((row) => row.fixture.length), "fixture".length) + 2;
  const kindWidth = Math.max(...rows.map((row) => row.kind.length), "kind".length) + 2;
  console.log("mad-dom TypeScript dual-target compatibility harness (T09 / ADR-0002 section 4)");
  console.log(
    `  typescript ${typescriptVersion} · happy-dom ${happyDomVersion} entry types · mad-dom index.d.ts ${madDomVersion}`,
  );
  console.log("");
  const header =
    "fixture".padEnd(nameWidth) + "kind".padEnd(kindWidth) + "happy-dom".padEnd(10) + "mad-dom".padEnd(9) + "status";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    console.log(
      row.fixture.padEnd(nameWidth) +
        row.kind.padEnd(kindWidth) +
        String(row.happyDomCount).padEnd(10) +
        String(row.madDomCount).padEnd(9) +
        row.status,
    );
  }
  console.log("");
  const happyDomTotal = rows.reduce((sum, row) => sum + row.happyDomCount, 0);
  const madDomTotal = rows.reduce((sum, row) => sum + row.madDomCount, 0);
  const patternTotal = entries.reduce((sum, entry) => sum + (entry.diagnostics ?? []).length, 0);
  console.log(
    `totals: happy-dom ${happyDomTotal} diagnostics · mad-dom ${madDomTotal} diagnostics · fixtures ${rows.length}` +
      ` (${rows.filter((row) => row.kind === "positive").length} positive, ${rows.filter((row) => row.kind === "negative").length} negative)`,
  );
  console.log(
    `divergences: ${entries.length} hc-types entries / ${patternTotal} patterns (every pattern must match a live diagnostic; source: compat/ledger.json)`,
  );
  if (strayDiagnostics.length > 0) {
    console.log(`stray diagnostics outside tests/compat/types/fixtures: ${strayDiagnostics.length}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const selfTestMode = args.includes("--self-test");
  if (args.some((argument) => !["--json", "--self-test"].includes(argument))) {
    harnessError("unknown argument; supported flags: --json, --self-test");
  }

  if (!existsSync(TSC_ENTRY)) {
    harnessError(`typescript is not installed (${TSC_ENTRY}); run npm install`);
  }

  const fixtureKeys = listFixtureFiles();
  if (fixtureKeys.length === 0) {
    harnessError(`no .ts fixtures found under ${FIXTURES_DIR}`);
  }
  for (const key of fixtureKeys) {
    if (fixtureKind(key) === null) {
      harnessError(`fixture ${key} must live under fixtures/positive/ or fixtures/negative/`);
    }
  }

  let ledger;
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch (error) {
    harnessError(`cannot parse ${toPosix(relative(REPO_ROOT, LEDGER_PATH))}: ${error.message}`);
  }
  if (ledger === null || typeof ledger !== "object" || !Array.isArray(ledger.entries)) {
    harnessError("compat/ledger.json must be an object with an entries array (run compat/validate-ledger.js for details)");
  }
  // The harness only consumes suite="types" entries; the ledger validator owns
  // the complete schema.
  const typesEntries = ledger.entries.filter((entry) => entry.suite === "types");
  const entryProblems = describeLedgerTypesEntryProblems(typesEntries, fixtureKeys);
  if (entryProblems.length > 0) {
    console.error(`invalid hc-types entries in ${toPosix(relative(REPO_ROOT, LEDGER_PATH))}:`);
    for (const problem of entryProblems) console.error(`  - ${problem}`);
    process.exit(2);
  }

  if (selfTestMode) {
    process.exit(runSelfTest(fixtureKeys) ? 0 : 1);
  }

  const targetResults = {};
  const strayDiagnostics = [];
  for (const target of TARGETS) {
    const run = runTarget(target);
    const byFixture = new Map(fixtureKeys.map((key) => [key, []]));
    for (const diagnostic of run.diagnostics) {
      if (diagnostic.fixture === null || !byFixture.has(diagnostic.fixture)) {
        strayDiagnostics.push({ target: target.id, diagnostic });
      } else {
        byFixture.get(diagnostic.fixture).push(diagnostic);
      }
    }
    targetResults[target.id] = byFixture;
  }

  const rows = [];
  for (const key of fixtureKeys) {
    const kind = fixtureKind(key);
    const entriesForFixture = typesEntries.filter((entry) => entry.fixture === key);
    const judgment = judgeFixture(
      { key, kind },
      targetResults["happy-dom"].get(key),
      targetResults["mad-dom"].get(key),
      entriesForFixture,
      readFileSync(join(FIXTURES_DIR, key), "utf8"),
    );
    rows.push({
      fixture: key,
      kind,
      happyDomCount: targetResults["happy-dom"].get(key).length,
      madDomCount: targetResults["mad-dom"].get(key).length,
      ...judgment,
    });
  }

  for (const stray of strayDiagnostics) {
    rows.push({
      fixture: stray.diagnostic.fixture ?? "(outside fixtures)",
      kind: "unknown",
      happyDomCount: stray.target === "happy-dom" ? 1 : 0,
      madDomCount: stray.target === "mad-dom" ? 1 : 0,
      status: "FAIL",
      failures: [
        `diagnostic reported outside tests/compat/types/fixtures on the ${stray.target} target: ${describeDiagnostic(stray.diagnostic)}`,
      ],
      tolerated: [],
    });
  }

  const failures = rows.flatMap((row) => row.failures.map((failure) => `${row.fixture}: ${failure}`));
  const ok = failures.length === 0;
  const typescriptVersion = readPackageVersion(join(REPO_ROOT, "node_modules", "typescript", "package.json"));
  const happyDomVersion = readPackageVersion(join(REPO_ROOT, "node_modules", "happy-dom", "package.json"));
  const madDomVersion = readPackageVersion(join(REPO_ROOT, "package.json"));

  printSummary({ typescriptVersion, happyDomVersion, madDomVersion, rows, strayDiagnostics, entries: typesEntries });

  if (!ok) {
    console.error("");
    console.error(`result: FAIL (${failures.length} failure(s))`);
    for (const failure of failures) console.error(`  - ${failure}`);
  }

  if (jsonMode) {
    const jsonRows = rows.map(({ tolerated, ...rest }) => ({ ...rest, tolerated }));
    console.log(
      JSON.stringify(
        {
          ok,
          typescript: typescriptVersion,
          happyDom: happyDomVersion,
          madDom: madDomVersion,
          divergences: { entries: typesEntries.length, patterns: typesEntries.reduce((sum, entry) => sum + (entry.diagnostics ?? []).length, 0) },
          targets: Object.fromEntries(
            TARGETS.map((target) => [target.id, { tsconfig: toPosix(relative(REPO_ROOT, target.config)) }]),
          ),
          fixtures: jsonRows,
          failures,
        },
        null,
        2,
      ),
    );
  }

  if (!ok) {
    process.exit(1);
  }
  if (!jsonMode) {
    console.log(
      "result: PASS — hard gate holds: everything the happy-dom target accepts is either accepted by mad-dom or recorded as a known gap in compat/ledger.json",
    );
  }
  process.exit(0);
}

function copyHarnessTo(tempRoot) {
  const harnessDir = join(tempRoot, "tests", "compat", "types");
  mkdirSync(join(tempRoot, "tests", "compat"), { recursive: true });
  cpSync(TYPES_DIR, harnessDir, { recursive: true });
  // The harness derives its hc-types entries from the compatibility ledger;
  // the copy needs the ledger at <tempRoot>/compat/ledger.json so tamper
  // scenarios mutate the copy, never the repository file.
  mkdirSync(join(tempRoot, "compat"), { recursive: true });
  cpSync(LEDGER_PATH, join(tempRoot, "compat", "ledger.json"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(tempRoot, "node_modules"), "dir");
  // The copies live outside the repo, so the relative tsconfig paths into the
  // repo tree are rewritten to absolute paths at the real locations. This
  // keeps the tamper scenarios faithful: only the intended mutation differs.
  const pathPatch = (configDir, target) => {
    const path = join(harnessDir, configDir, "tsconfig.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.compilerOptions.paths["dom-under-test"] = [target];
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  };
  pathPatch("happy-dom", join(REPO_ROOT, "node_modules", "happy-dom", "lib", "index.d.ts"));
  pathPatch("mad-dom", join(REPO_ROOT, "index.d.ts"));
  return harnessDir;
}

function runCopiedHarness(harnessDir) {
  const run = spawnSync(process.execPath, [join(harnessDir, "run.mjs")], {
    cwd: harnessDir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return { exitCode: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

function withFreshCopy(mutate) {
  const tempRoot = mkdtempSync(join(tmpdir(), "mad-dom-types-selftest-"));
  try {
    const harnessDir = copyHarnessTo(tempRoot);
    mutate(harnessDir, tempRoot);
    return runCopiedHarness(harnessDir);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runSelfTest(fixtureKeys) {
  if (fixtureKeys.length === 0) harnessError("self-test needs at least one fixture");
  if (!existsSync(join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"))) {
    harnessError("self-test needs typescript installed");
  }

  const scenarios = [];

  scenarios.push({
    name: "A: an uncovered mad-dom diagnostic trips the hard gate (mad-dom must not silently reject what happy-dom accepts)",
    run: () =>
      withFreshCopy((harnessDir, tempRoot) => {
        // A member the happy-dom Window surface declares but the mad-dom type
        // surface does not (`window.screen`): the happy-dom target typechecks
        // cleanly, the mad-dom target reports TS2339, and no ledger entry
        // covers it, so the hard gate must fail the run. If mad-dom ever
        // grows a `Window.screen` surface, pick another hd-only member here.
        writeFileSync(
          join(harnessDir, "fixtures", "positive", "hd-only-member.ts"),
          [
            "// Self-test fixture (temp copy only): `window.screen` exists on the",
            "// happy-dom Window surface but not on the mad-dom index.d.ts surface,",
            "// so the mad-dom target reports an uncovered diagnostic and the hard",
            "// gate must trip.",
            'import { Window } from "dom-under-test";',
            "const window = new Window();",
            "const screenValue = window.screen;",
            "export const exported = { screenValue };",
            "",
          ].join("\n"),
        );
      }),
    expect: (result) => result.exitCode === 1 && /hard gate: mad-dom rejects/.test(result.output),
  });

  scenarios.push({
    name: "B: an hc-types ledger pattern that matches nothing is stale and fails",
    run: () =>
      withFreshCopy((harnessDir, tempRoot) => {
        const path = join(tempRoot, "compat", "ledger.json");
        const original = readFileSync(path, "utf8");
        const manifest = JSON.parse(original);
        const entry = manifest.entries.find((item) => item.suite === "types");
        entry.status = "known-gap";
        entry.reason = "self-test tamper: stale pattern drill";
        entry.recordedAt = "2026-08-30T00:00:00Z";
        entry.diagnostics = [{ code: 9999, messageIncludes: "__never_matches__" }];
        writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      }),
    expect: (result) => result.exitCode === 1 && /stale divergence entry/.test(result.output),
  });

  scenarios.push({
    name: "C: deleting an @ts-expect-error marker from a negative fixture fails on the happy-dom target",
    run: () =>
      withFreshCopy((harnessDir) => {
        const path = join(harnessDir, "fixtures", "negative", "invalid-members.ts");
        const original = readFileSync(path, "utf8");
        const lines = original.split(/\r?\n/);
        const markerIndex = lines.findIndex((line) => EXPECT_ERROR_DIRECTIVE.test(line));
        if (markerIndex === -1) {
          throw new Error("self-test could not find an @ts-expect-error marker to delete");
        }
        lines[markerIndex] = "// self-test removed the marker on this line";
        writeFileSync(path, lines.join("\n"));
      }),
    expect: (result) => result.exitCode === 1 && /zero diagnostics on the happy-dom target/.test(result.output),
  });

  let allPassed = true;
  console.log(`self-test: ${scenarios.length} tamper scenarios against temporary copies of this harness`);
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
      console.log(`  --- observed output (first 2000 chars) ---`);
      console.log(result.output.slice(0, 2000));
    }
  }
  console.log(`self-test: ${allPassed ? "PASS" : "FAIL"}`);
  return allPassed;
}

main();
