import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// T48 WPT subset infrastructure tests.
//
// They pin the WPT integration as a *separate* statistics track: the manifest
// is well-formed, the vendored cases exist and carry real inline test bodies,
// and the runner produces the machine-readable report with a measured pass
// rate (never an infrastructure failure). The pass rate itself is a
// measurement, not a gate.
const WPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(WPT_DIR, "..", "..");
const MANIFEST = JSON.parse(readFileSync(join(WPT_DIR, "manifest.json"), "utf8"));

function runRunner(json = false) {
  const args = [join(WPT_DIR, "runner.js"), ...(json ? ["--json"] : [])];
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
}

describe("T48 WPT manifest", () => {
  test("records the upstream source and a pinned commit", () => {
    expect(MANIFEST.schemaVersion).toBe("1.0.0");
    expect(MANIFEST.source.kind).toBe("wpt");
    expect(MANIFEST.source.repository).toBe("https://github.com/web-platform-tests/wpt");
    expect(MANIFEST.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(MANIFEST.source.license).toBe("BSD-3-Clause");
  });

  test("every case exists under tests/wpt/cases with an inline test body", () => {
    expect(MANIFEST.tests.length).toBeGreaterThan(0);
    const ids = new Set();
    for (const entry of MANIFEST.tests) {
      expect(entry.id).toMatch(/^wpt-[a-z0-9-]+$/);
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      const path = join(REPO_ROOT, entry.localPath);
      expect(existsSync(path)).toBe(true);
      const html = readFileSync(path, "utf8");
      // The vendored file is a verbatim WPT .html case carrying an inline
      // <script> test body (the /resources/ includes carry src= and are
      // skipped by the runner).
      expect(html).toContain("<script");
      expect(html).toContain("testharness.js");
      expect(/<script(?![^>]*src=)/.test(html)).toBe(true);
    }
  });
});

describe("T48 WPT runner", () => {
  test("produces the machine-readable report with a measured pass rate", () => {
    const run = runRunner(true);
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.schema).toBe("mad-dom-wpt-report/1");
    expect(report.source.commit).toBe(MANIFEST.source.commit);
    expect(report.totals.files).toBe(MANIFEST.tests.length);
    expect(report.totals.assertions).toBeGreaterThan(0);
    expect(report.totals.rate).toBeGreaterThanOrEqual(0);
    expect(report.totals.rate).toBeLessThanOrEqual(1);
    for (const test of report.cases) {
      expect(test.infraError).toBeNull();
      expect(Array.isArray(test.results)).toBe(true);
    }
  });

  test("each case runs in isolation and reports pass/fail honestly", () => {
    const run = runRunner(true);
    const report = JSON.parse(run.stdout);
    const combined = report.cases.flatMap((test) => test.results);
    for (const result of combined) {
      expect(["pass", "fail", "error"]).toContain(result.state);
      expect(typeof result.name).toBe("string");
    }
    expect(report.totals.pass + report.totals.fail + report.totals.error).toBe(
      combined.length,
    );
  });

  test("the human report prints the pass rate separately", () => {
    const run = runRunner(false);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("mad-dom WPT subset runner (T48)");
    expect(run.stdout).toContain("pass rate");
  });
});
