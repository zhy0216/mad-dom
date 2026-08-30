// Tests for the T11 compatibility ledger: the regression-gate CLI, the
// offline report CLI and the ledger-lib validators.
//
// Covered here:
//   - the real-repository gate passes and reports its conclusion;
//   - the gate's --json document carries the fixed schema, an empty
//     regression/stale set and ledger totals that sum consistently;
//   - the gate self-test tamper scenarios (missing reason/recordedAt,
//     duplicated id, non-MIT license, non-pinned commit, simulated pass
//     regression) all fail as designed on temporary copies;
//   - the report CLI's --json document matches compat/ledger.json entry by
//     entry;
//   - ledger-lib unit checks with injected readFile/exists: upstream entries
//     must keep the MIT license, the pinned commit and private-API-free local
//     files; ledger entries must carry valid ids/subsystems and reasons.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  LEDGER_SCHEMA_VERSION,
  PINNED_HAPPY_DOM_COMMIT,
  UPSTREAM_MAP_SCHEMA_VERSION,
  validateLedger,
  validateUpstreamMap,
} from "../../compat/ledger-lib.js";

const COMPAT_DIR = resolve(import.meta.dir, "..", "..", "compat");
const REPO_ROOT = resolve(COMPAT_DIR, "..");
const LEDGER_CLI = join(COMPAT_DIR, "validate-ledger.js");
const REPORT_CLI = join(COMPAT_DIR, "ledger-report.js");
const LEDGER = JSON.parse(readFileSync(join(COMPAT_DIR, "ledger.json"), "utf8"));

function runCli(script, args, timeoutMs = 240_000) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("compatibility ledger gate (T11)", () => {
  test("real repository passes the gate and prints the conclusion", () => {
    const run = runCli(LEDGER_CLI, []);
    if (run.status !== 0) {
      throw new Error(`gate exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    expect(run.stdout).toContain("result: OK");
    expect(run.stdout).toContain("0 regression(s)");
    expect(run.stdout).toContain("0 stale ledger");
  }, 240_000);

  test("--json report has the fixed schema, no regressions and consistent totals", () => {
    const run = runCli(LEDGER_CLI, ["--json"]);
    if (run.status !== 0) {
      throw new Error(`gate exited ${run.status}\n${run.stderr}`);
    }
    const report = JSON.parse(run.stdout);
    expect(report.schema).toBe("mad-dom-compat-ledger-gate/1");
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.gate.regressions).toEqual([]);
    expect(report.gate.stale).toEqual([]);
    expect(report.gate.checkedScenarios.length).toBe(report.gate.realPairScenarios);
    expect(report.gate.checkedScenarios).toEqual([...report.gate.checkedScenarios].sort());
    // Dynamic two-way check: the live report's real-pair scenario set must be
    // exactly the scenario set of the ledger's diff entries, so legitimately
    // adding real-pair scenarios (with their ledger entries) does not break
    // this test.
    const ledgerDiffScenarios = LEDGER.entries
      .filter((entry) => entry.suite === "diff")
      .map((entry) => entry.scenario)
      .sort();
    expect(report.gate.checkedScenarios).toEqual(ledgerDiffScenarios);

    expect(report.totals.entries).toBe(LEDGER.entries.length);
    const statusSum = report.totals.pass + report.totals.knownGap + report.totals.notApplicable;
    expect(statusSum).toBe(report.totals.entries);
    const subsystemSum = Object.values(report.bySubsystem).reduce((sum, bucket) => sum + bucket.entries, 0);
    expect(subsystemSum).toBe(report.totals.entries);
  }, 240_000);

  test("self-test tamper scenarios all fail as designed", () => {
    const run = runCli(LEDGER_CLI, ["--self-test"], 600_000);
    if (run.status !== 0) {
      throw new Error(`self-test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    expect(run.stdout).toContain("self-test: PASS");
    expect(run.stdout).toContain("reason fails validation");
    expect(run.stdout).toContain("recordedAt fails validation");
    expect(run.stdout).toContain("duplicated ledger id");
    expect(run.stdout).toContain("non-MIT license");
    expect(run.stdout).toContain("non-pinned commit");
    expect(run.stdout).toContain("trips the live stale gate");
  }, 600_000);
});

describe("compatibility ledger report (T11)", () => {
  test("--json summary matches compat/ledger.json entry by entry", () => {
    const run = runCli(REPORT_CLI, ["--json"]);
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.schema).toBe("mad-dom-compat-ledger-report/1");
    expect(report.totals.entries).toBe(LEDGER.entries.length);
    expect(report.totals.pass).toBe(LEDGER.entries.filter((entry) => entry.status === "pass").length);
    expect(report.totals.knownGap).toBe(LEDGER.entries.filter((entry) => entry.status === "known-gap").length);
    expect(report.totals.notApplicable).toBe(LEDGER.entries.filter((entry) => entry.status === "not-applicable").length);

    const expected = LEDGER.entries
      .map((entry) => ({ id: entry.id, suite: entry.suite, subsystem: entry.subsystem, status: entry.status }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(report.entries).toEqual(expected);
    for (const bucket of Object.values(report.bySubsystem)) {
      expect(bucket.pass + bucket.knownGap + bucket.notApplicable).toBe(bucket.entries);
    }
  });
});

describe("ledger-lib validators", () => {
  const validLedgerEntry = {
    id: "hc-up-element-closest-form-proxy",
    suite: "up",
    status: "known-gap",
    subsystem: "tooling",
    reason: "test fixture",
    recordedAt: "2026-08-28T00:00:00Z",
    addedIn: "T11",
    upstreamRef: "hc-up-element-closest-form-proxy",
  };

  function upstreamMap(overrides = {}) {
    return {
      schemaVersion: UPSTREAM_MAP_SCHEMA_VERSION,
      note: "test map",
      upstream: {
        repository: "https://github.com/capricorn86/happy-dom",
        commit: PINNED_HAPPY_DOM_COMMIT,
        license: "MIT",
      },
      entries: [
        {
          localId: "hc-up-element-closest-form-proxy",
          upstreamPath: "test/dom/Document.test.ts",
          upstreamCommit: PINNED_HAPPY_DOM_COMMIT,
          license: "MIT",
          localPath: "tests/ported/case.ts",
          ...overrides,
        },
      ],
    };
  }

  function validateWithContent(content, overrides = {}) {
    return validateUpstreamMap(upstreamMap(overrides), {
      ledgerIds: new Set(["hc-up-element-closest-form-proxy"]),
      exists: () => true,
      readFile: () => content,
    });
  }

  test("accepts a clean ported case", () => {
    const problems = validateWithContent('import { Window } from "happy-dom";\n');
    expect(problems).toEqual([]);
  });

  test("rejects a non-MIT license", () => {
    const problems = validateWithContent("// clean", { license: "Apache-2.0" });
    expect(problems.some((problem) => problem.includes("license"))).toBe(true);
  });

  test("rejects a non-pinned upstream commit", () => {
    const problems = validateWithContent("// clean", { upstreamCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(problems.some((problem) => problem.includes("upstreamCommit"))).toBe(true);
  });

  test("rejects local files referencing happy-dom private internals", () => {
    for (const snippet of [
      'import { PropertySymbol } from "happy-dom";',
      'import { Window } from "happy-dom/lib/index.js";',
      // No trailing slash after the private directory.
      'import { Window } from "happy-dom/lib";',
      // Backslash separators must not evade the scan.
      'import { Window } from "happy-dom\\lib\\index.js";',
      // Escaped (double) backslashes fold into single separators during
      // normalization, so they cannot evade the scan either.
      'import { Window } from "happy-dom\\\\lib\\\\index.js";',
    ]) {
      const problems = validateWithContent(snippet);
      expect(problems.some((problem) => problem.includes("private internals"))).toBe(true);
    }
  });

  test("rejects ledger entries with invalid ids, unknown subsystems and wrong reason rules", () => {
    const ledger = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      entries: [
        { ...validLedgerEntry, id: "not-a-stable-id" },
        { ...validLedgerEntry, id: "hc-up-element-closest", subsystem: "rendering" },
        { ...validLedgerEntry, id: "hc-up-element-missing-reason", reason: undefined },
        {
          ...validLedgerEntry,
          id: "hc-up-element-pass-with-reason",
          status: "pass",
          reason: "a pass must not explain itself",
          recordedAt: undefined,
          upstreamRef: undefined,
        },
      ],
    };
    const problems = validateLedger(ledger);
    expect(problems.some((problem) => problem.includes("must match hc-<suite>-<capability>-<case>"))).toBe(true);
    expect(problems.some((problem) => problem.includes("subsystem"))).toBe(true);
    expect(problems.filter((problem) => problem.includes("reason")).length).toBeGreaterThanOrEqual(2);
    expect(problems.some((problem) => problem.includes("reason: must be absent"))).toBe(true);
  });
});
