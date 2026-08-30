#!/usr/bin/env bun
// WPT subset runner (T48).
//
// Executes the curated web-platform-tests subset recorded in
// tests/wpt/manifest.json against MAD DOM and reports the pass rate as a
// **separate** statistics track — WPT is not a happy-dom compatibility gate
// (ADR-0002 section 8: WPT 单独统计，只用于补充 happy-dom 未覆盖或行为不明确
// 的部分). Each vendored case runs in an isolated fresh window; the minimal
// testharness shim (testharness.js) provides the testharness.js API surface
// the vendored bodies use.
//
// Exit codes:
//   0 — every case ran; the report (with its pass rate) was produced. Test
//       pass/fail does not fail the run: the subset is a measurement.
//   2 — infrastructure error (manifest, extraction, harness or probe failure).
//
// Usage:
//   bun tests/wpt/runner.js [--json]
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHarness } from "./testharness.js";

const RUNNER_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..", "..");
const MANIFEST_PATH = join(RUNNER_DIR, "manifest.json");
const CASES_DIR = join(RUNNER_DIR, "cases");
const CHILD_SCRIPT = join(RUNNER_DIR, "child.js");

const REPORT_SCHEMA = "mad-dom-wpt-report/1";
const ASYNC_TIMEOUT_MS = 5_000;

function failInfrastructure(message) {
  console.error(`wpt runner error: ${message}`);
  process.exit(2);
}

function readJsonDocument(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    failInfrastructure(`cannot read ${label} ${relative(REPO_ROOT, path)}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    failInfrastructure(`invalid JSON in ${label} ${relative(REPO_ROOT, path)}: ${error.message}`);
  }
}

function validateManifest(manifest) {
  const problems = [];
  if (manifest?.schemaVersion !== "1.0.0") problems.push("schemaVersion must be \"1.0.0\"");
  if (manifest?.source?.kind !== "wpt") problems.push("source.kind must be \"wpt\"");
  if (!/^https:\/\/\S+$/.test(manifest?.source?.repository ?? "")) problems.push("source.repository must be an https URL");
  if (!/^[0-9a-f]{40}$/.test(manifest?.source?.commit ?? "")) problems.push("source.commit must be a 40-char SHA-1");
  if (!/^[\w.-]+$/.test(manifest?.source?.license ?? "")) problems.push("source.license must be a license identifier");
  if (!Array.isArray(manifest?.tests) || manifest.tests.length === 0) problems.push("tests must be a non-empty array");
  const seenIds = new Set();
  for (const [index, test] of (manifest?.tests ?? []).entries()) {
    const at = `tests[${index}]`;
    if (typeof test?.id !== "string" || test.id.trim() === "") problems.push(`${at}.id must be a non-empty string`);
    else if (seenIds.has(test.id)) problems.push(`${at}.id ${test.id} is duplicated`);
    seenIds.add(test?.id);
    if (typeof test?.localPath !== "string" || !test.localPath.startsWith("tests/wpt/cases/")) {
      problems.push(`${at}.localPath must be a repo-relative path under tests/wpt/cases/`);
    }
    if (typeof test?.upstreamPath !== "string" || test.upstreamPath.trim() === "") {
      problems.push(`${at}.upstreamPath must be a non-empty WPT repo path`);
    }
    if (typeof test?.title !== "string" || test.title.trim() === "") problems.push(`${at}.title must be a non-empty string`);
  }
  return problems;
}

/**
 * Extracts the inline `<script>` test bodies from a vendored WPT `.html` case.
 *
 * External includes (`<script src="/resources/...">`) and the `<div id="log">`
 * are skipped; the returned bodies are the exact inline test code from the
 * upstream file (the provenance is recorded in manifest.json).
 */
function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = match[1] ?? "";
    if (/\bsrc\s*=/.test(attributes)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

function listCaseFiles(dir = CASES_DIR) {
  const stats = statSync(dir);
  if (stats.isFile()) return [dir];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith("_")) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listCaseFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(child);
  }
  return files;
}

function probeEnvironment() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "BUN_INSTALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/**
 * Runs one vendored case in a fresh Bun subprocess (isolated document, clean
 * globals) and returns the per-test results plus any infrastructure error.
 */
function runCaseProbe(test, workDir) {
  const outPath = join(workDir, `${test.id}.json`);
  const run = spawnSync(process.execPath, [CHILD_SCRIPT, test.localPath, outPath], {
    cwd: REPO_ROOT,
    env: probeEnvironment(),
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const infrastructureError = (message) => ({ name: "ProbeInfrastructureError", message });

  if (run.error !== undefined && run.error !== null) {
    return { results: null, infraError: infrastructureError(`spawn failed: ${run.error.message}`) };
  }
  if (run.signal !== null) {
    return { results: null, infraError: infrastructureError(`probe was killed by signal ${run.signal} (timeout)`) };
  }
  if (run.status !== 0) {
    const stderrTail = (run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-5).join(" | ");
    return {
      results: null,
      infraError: infrastructureError(`probe exited with code ${run.status}${stderrTail === "" ? "" : `: ${stderrTail}`}`),
    };
  }
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(outPath, "utf8"));
  } catch (error) {
    return { results: null, infraError: infrastructureError(`probe output unreadable: ${error.message}`) };
  }
  if (envelope?.schema !== "mad-dom-wpt-case/1") {
    return { results: null, infraError: infrastructureError("probe output has an unexpected schema") };
  }
  if (envelope.infraError != null) {
    return { results: null, infraError: { name: envelope.infraError.name ?? "Error", message: envelope.infraError.message } };
  }
  return { results: envelope.results ?? [], infraError: null };
}

function summarize(entries) {
  const totals = { files: entries.length, pass: 0, fail: 0, error: 0, assertions: 0 };
  for (const entry of entries) {
    totals.assertions += entry.results?.length ?? 0;
    for (const result of entry.results ?? []) {
      if (result.state === "pass") totals.pass += 1;
      else if (result.state === "error") totals.error += 1;
      else totals.fail += 1;
    }
  }
  totals.rate = totals.pass + totals.fail + totals.error > 0 ? totals.pass / (totals.pass + totals.fail + totals.error) : 0;
  return totals;
}

function printHumanReport(manifest, entries, totals) {
  console.log("mad-dom WPT subset runner (T48)");
  console.log(
    `source: ${manifest.source.repository} @ ${manifest.source.commit.slice(0, 8)}… (${manifest.source.license})`,
  );
  console.log(`manifest: ${relative(REPO_ROOT, MANIFEST_PATH)} · ${manifest.tests.length} case(s)`);
  console.log("");
  for (const entry of entries) {
    const counts = { pass: 0, fail: 0, error: 0 };
    for (const result of entry.results ?? []) counts[result.state === "error" ? "error" : result.state] += 1;
    const status = entry.infraError !== null ? `INFRA ERROR (${entry.infraError.message})` : "ran";
    console.log(
      `[${entry.test.id}] ${entry.test.title}` +
        ` — pass ${counts.pass} · fail ${counts.fail} · error ${counts.error} · ${status}`,
    );
    for (const result of entry.results ?? []) {
      if (result.state !== "pass") {
        console.log(`    - ${result.state}: ${result.name}${result.message ? ` — ${result.message}` : ""}`);
      }
    }
  }
  console.log("");
  console.log(
    `result: ${totals.pass} pass · ${totals.fail} fail · ${totals.error} error across ${totals.files} case(s) ` +
      `(${totals.assertions} assertions) — pass rate ${(totals.rate * 100).toFixed(1)}%`,
  );
}

function jsonReport(manifest, entries, totals) {
  return {
    schema: REPORT_SCHEMA,
    source: manifest.source,
    totals,
    cases: entries.map((entry) => ({
      id: entry.test.id,
      title: entry.test.title,
      localPath: entry.test.localPath,
      upstreamPath: entry.test.upstreamPath,
      infraError: entry.infraError,
      results: entry.results ?? [],
    })),
  };
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const manifest = readJsonDocument(MANIFEST_PATH, "WPT manifest");
  const problems = validateManifest(manifest);
  if (problems.length > 0) failInfrastructure(problems.join("; "));

  const caseFiles = new Set(listCaseFiles().map((path) => relative(REPO_ROOT, path)));
  for (const test of manifest.tests) {
    if (!existsSync(join(REPO_ROOT, test.localPath))) {
      failInfrastructure(`case file does not exist: ${test.localPath}`);
    }
    if (!caseFiles.has(test.localPath)) {
      failInfrastructure(`case file ${test.localPath} is not under cases/`);
    }
  }

  const workDir = mkdtempSync(join(tmpdir(), "mad-dom-wpt-"));
  const entries = [];
  try {
    for (const test of manifest.tests) {
      const { results, infraError } = runCaseProbe(test, workDir);
      entries.push({ test, results, infraError });
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const totals = summarize(entries);
  if (jsonMode) {
    console.log(JSON.stringify(jsonReport(manifest, entries, totals), null, 2));
  } else {
    printHumanReport(manifest, entries, totals);
  }
  // WPT is a separate measurement, not a gate: infra errors only.
  process.exit(totals.files > 0 ? 0 : 2);
}

await main();
