// Integration tests for the T09 type compatibility harness driver.
// The normal run is the repository gate; --self-test re-runs the driver
// against tampered temporary copies (divergence entry removed, stale
// pattern, deleted @ts-expect-error marker) and requires each to exit 1.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const TYPES_DIR = dirname(import.meta.path);
const RUNNER = join(TYPES_DIR, "run.mjs");

function runDriver(args, timeoutMs = 120_000) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: TYPES_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("type compatibility harness (T09)", () => {
  test("dual-target typecheck passes with all divergences covered", () => {
    const run = runDriver([]);
    if (run.status !== 0) {
      throw new Error(`driver exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    expect(run.stdout).toContain("result: PASS");
    expect(run.stdout).toContain("happy-dom 0 diagnostics");
    expect(run.stdout).toMatch(/fixtures \d+ \(\d+ positive, \d+ negative\)/);
  }, 120_000);

  test("json summary reports every pattern matched and no failures", () => {
    const run = runDriver(["--json"]);
    expect(run.status).toBe(0);
    const jsonStart = run.stdout.indexOf("{");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const summary = JSON.parse(run.stdout.slice(jsonStart));
    expect(summary.ok).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.fixtures.length).toBeGreaterThan(0);
    for (const fixture of summary.fixtures) {
      expect(fixture.happyDomCount).toBe(0);
      expect(fixture.status).not.toBe("FAIL");
    }
  }, 120_000);

  test("self-test tamper scenarios all fail as designed", () => {
    const run = runDriver(["--self-test"], 240_000);
    if (run.status !== 0) {
      throw new Error(`self-test exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    expect(run.stdout).toContain("self-test: PASS");
    expect(run.stdout).toContain("hard gate");
    expect(run.stdout).toContain("stale");
    expect(run.stdout).toContain("@ts-expect-error");
  }, 240_000);
});
