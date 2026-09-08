import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateAttempt, compareAttempts, summarizeComparison } from "./report.mjs";
import { sourceManifest } from "./provenance.mjs";

// These are actual native tiny-run results with the existing DOM oracle, not
// reports manufactured by the validator. Tampering below tests distinct faults.
const evidence = resolve(import.meta.dir, "../../plans/bun-native-performance/evidence/baseline/smoke-development-01");
const manifest = JSON.parse(readFileSync(join(evidence, "manifest.json"), "utf8"));
const real = manifest.attempts.map(p => JSON.parse(readFileSync(join(evidence, p), "utf8")));
const copy = a => structuredClone(a);

describe("strict result validation against real native samples", () => {
  test("accepts both real modes and retains complete per-round sums", () => {
    expect(real).toHaveLength(10);
    for (const a of real) expect(validateAttempt(a)).toBe(true);
    for (let i = 0; i < real.length; i += 2) expect(compareAttempts(real[i], real[i + 1])).toBe(true);
    const rows = summarizeComparison(real, manifest.protocol);
    const total = rows.find(r => r.suite === "core" && r.phase === "operations");
    const expected = Object.values(real[0].report.results[0].phases).reduce((sum, p) => sum + p.samples[0], 0);
    expect(total.A.samples).toEqual([expected]);
    expect(total).not.toHaveProperty("speedupAoverB");
  });
  for (const [name, value] of [["missing", undefined], ["NaN", NaN], ["infinite", Infinity], ["negative", -1], ["null", null]]) {
    test(`rejects ${name} timing even with a plausible median`, () => {
      const a = copy(real[0]); a.report.results[0].phases.parse.samples[0] = value;
      expect(() => validateAttempt(a)).toThrow(/invalid timing/);
    });
  }
  test("rejects absent samples, fabricated summaries, skipped phase and missing oracle", () => {
    for (const change of [
      a => { delete a.report.results[0].phases.parse.samples; },
      a => { a.report.results[0].phases.parse.medianMs = NaN; },
      a => { delete a.report.results[0].phases.serialize; },
      a => { delete a.report.results[0].checks.serializeHash; },
      a => { a.report.results[0].operations.samples[0] = 1; },
    ]) { const a = copy(real[0]); change(a); expect(() => validateAttempt(a)).toThrow(); }
  });
  test("rejects missing capability, another image, unexpected fallback and changed source", () => {
    for (const change of [
      a => { delete a.metadata.runtime.ffi; },
      a => { delete a.metadata.runtime.ffi.expectedCapabilities; },
      a => { a.metadata.runtime.ffi.status = "partial"; },
      a => { a.metadata.overrides.MAD_DOM_FFI_PATH = "/another-worktree/build/mad-dom.node"; },
      a => { a.metadata.source.productionSha256 = "0".repeat(64); },
      a => { delete a.metadata.runtime.bunRevision; },
    ]) { const a = copy(real[1]); change(a); expect(() => validateAttempt(a)).toThrow(); }
  });
  test("rejects runtime mismatch even if each isolated report is internally consistent", () => {
    const a = copy(real[1]);
    a.config.bun.version = a.metadata.runtime.bunVersion = a.report.host.bun = "999.0.0";
    expect(() => compareAttempts(real[0], a)).toThrow(/runtime mismatch/);
  });
  test("rejects changed correctness fingerprint and skipped testing case", () => {
    const a = copy(real[1]); a.report.results[0].checks.serializeHash++;
    expect(() => compareAttempts(real[0], a)).toThrow(/fingerprint/);
    const b = copy(real[3]); b.report.results[0].checks.fixtureLifecycle.fingerprint = "f".repeat(64);
    expect(() => compareAttempts(real[2], b)).toThrow(/fingerprint/);
    b.report.results[0].workload.cases.fixtureLifecycle = 0;
    expect(() => validateAttempt(b)).toThrow(/skipped case/);
    const c = copy(real[5]); c.report.results[0].checks["create.8"].rounds[0].iterations = 0;
    expect(() => validateAttempt(c)).toThrow(/skipped hotspot iteration/);
  });
  test("rejects nonzero exit, signal, spawn error and skipped ABBA processes", () => {
    for (const change of [a => { a.exitCode = 7; }, a => { a.exitCode = null; }, a => { a.signal = "SIGKILL"; }, a => { a.error = "ENOENT"; }]) {
      const a = copy(real[0]); change(a); expect(() => validateAttempt(a)).toThrow(/failed subprocess/);
    }
    expect(() => summarizeComparison(real.slice(1), manifest.protocol)).toThrow(/sequence/);
    expect(() => summarizeComparison(real, { ...manifest.protocol, kind: "formal", groups: 2 })).toThrow(/protocol/);
  });
  test("protocol must agree with otherwise valid child configs", () => {
    for (const patch of [{ runs: 9 }, { sizes: [1] }, { suites: ["core"] }, { iterations: 99 }, { warmup: 0 }]) {
      expect(() => summarizeComparison(real, { ...manifest.protocol, ...patch })).toThrow(/protocol/);
    }
  });
  test("a profile command cannot masquerade as valid formal timings", () => {
    const directory = resolve(evidence, "../baseline-formal");
    const m = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    const attempts = m.attempts.map(p => JSON.parse(readFileSync(join(directory, p), "utf8")));
    attempts[0].command.splice(1, 0, "--cpu-prof");
    expect(() => summarizeComparison(attempts, m.protocol)).toThrow(/profile commands/);
    const instrumented = copy(real[5]);
    instrumented.report.results[0].phases["create.1"].diagnostics = [{}];
    expect(() => validateAttempt(instrumented)).toThrow(/unexpected timing instrumentation/);
  });
});

test("an untracked production helper changes the working-tree digest without changing HEAD", () => {
  // Exercise the real parent Git index without git init/add/commit or touching
  // production js/. Only this test's own fixture under the allowed new tree is removed.
  const fixture = mkdtempSync(join(import.meta.dir, ".provenance-test-"));
  try {
    mkdirSync(join(fixture, "js"));
    writeFileSync(join(fixture, "index.js"), "export const existing = true;\n");
    const before = sourceManifest(fixture);
    expect(sourceManifest(fixture).productionSha256).toBe(before.productionSha256);
    const helper = "js/new-helper-你好.js";
    writeFileSync(join(fixture, helper), "export const added = 1;\n");
    const after = sourceManifest(fixture);
    expect(after.sourceSha).toBe(before.sourceSha);
    expect(after.productionSha256).not.toBe(before.productionSha256);
    expect(after.untrackedProductionFiles).toContain(helper);
    expect(after.files[helper]).toMatch(/^[a-f0-9]{64}$/);
    expect(after.sourceShaMeaning).toContain("HEAD anchor");
    writeFileSync(join(fixture, helper), "export const added = 2;\n");
    expect(sourceManifest(fixture).productionSha256).not.toBe(after.productionSha256);
  } finally { rmSync(fixture, { recursive: true }); }
});

describe("actual command exit and same-executable FFI smoke", () => {
  const root = resolve(import.meta.dir, "../..");
  const runner = join(import.meta.dir, "run.mjs");
  const run = args => spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const temporary = mkdtempSync(join(tmpdir(), "mad-dom-bun-performance-tests-"));
  test("missing image cannot silently use a locally installed native package", () => {
    const p = run(["--bun", process.execPath, "--reference-root", root, "--reference-image", join(root, "missing.node"), "--smoke", "--out", join(temporary, "missing-image")]);
    expect(p.status).not.toBe(0);
    expect(p.stderr).toMatch(/ENOENT/);
  });
  test("tampered saved report exits nonzero and publishes no valid speedup", () => {
    const directory = join(temporary, "invalid-report"); mkdirSync(directory);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    for (let i = 0; i < real.length; i++) {
      const a = copy(real[i]); if (i === 0) a.exitCode = 42;
      writeFileSync(join(directory, manifest.attempts[i]), JSON.stringify(a));
    }
    const p = run(["--verify", directory]);
    expect(p.status).not.toBe(0);
    expect(p.stderr).toMatch(/failed subprocess/);
    expect(p.stdout).not.toContain('"valid":true');
    // Protocol tampering is rejected even when all children remain self-consistent.
    writeFileSync(join(directory, manifest.attempts[0]), JSON.stringify(real[0]));
    for (const patch of [{ sizes: [1] }, { runs: 9 }, { suites: ["core"] }]) {
      writeFileSync(join(directory, "manifest.json"), JSON.stringify({ ...manifest, protocol: { ...manifest.protocol, ...patch } }));
      const protocolFailure = run(["--verify", directory]);
      expect(protocolFailure.status).not.toBe(0);
      expect(protocolFailure.stderr).toMatch(/protocol/);
    }
    const inventory = copy(manifest);
    inventory.reference.source.files["index.js"] = "0".repeat(64);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(inventory));
    const inventoryFailure = run(["--verify", directory]);
    expect(inventoryFailure.status).not.toBe(0);
    expect(inventoryFailure.stderr).toMatch(/production inventory digest/);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    const negative = copy(real[0]); negative.report.results[0].phases.parse.samples[0] = -1;
    writeFileSync(join(directory, manifest.attempts[0]), JSON.stringify(negative));
    const timingFailure = run(["--verify", directory]);
    expect(timingFailure.status).not.toBe(0);
    expect(timingFailure.stderr).toMatch(/invalid timing/);
  });
  test("new processes run raw, adapter and public facade on/off with equal real results", () => {
    const directory = join(temporary, "native-smoke");
    const p = run(["--bun", process.execPath, "--reference-root", root, "--reference-image", join(root, "build/mad-dom.node"),
      "--suites", "raw,adapter,facade", "--smoke", "--out", directory]);
    if (p.status !== 0) throw new Error(p.stderr);
    const summary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    expect(summary.valid).toBe(true);
    expect(summary.rows).toHaveLength(57);
    expect(summary.rows.every(r => !Object.hasOwn(r, "speedupAoverB"))).toBe(true);
    const m = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    for (const f of m.attempts) {
      const a = JSON.parse(readFileSync(join(directory, f), "utf8"));
      expect(a.metadata.runtime.bunVersion).toBe(Bun.version);
      expect(a.metadata.runtime.bunRevision).toBe(Bun.revision);
      expect(a.metadata.runtime.ffi.status).toBe(a.side === "A" ? "disabled" : "available");
    }
    const audit = JSON.parse(readFileSync(join(directory, "audit-B-facade.json"), "utf8"));
    expect(audit.metadata.runtime.ffi.status).toBe("available");
    const formalFacade = JSON.parse(readFileSync(join(directory, m.attempts[5]), "utf8"));
    // A future candidate may intentionally choose Node-API/range with available
    // FFI. Require actual evidence, without fixing its policy to the old route.
    expect(formalFacade.report.results[0].phases["create.1"].observedPath.channels.length).toBeGreaterThan(0);
  }, 120000);
  test("the frozen audit proves available FFI does not imply public FFI use", () => {
    const audit = JSON.parse(readFileSync(resolve(evidence, "../baseline-reference-smoke/audit-B-facade.json"), "utf8"));
    expect(validateAttempt(audit)).toBe(true);
    expect(audit.metadata.runtime.ffi.status).toBe("available");
    expect(audit.report.results[0].phases["create.1"].diagnostics[0]["NodeAPI.createElementToken"]).toBe(1);
    expect(audit.report.results[0].phases["create.1"].diagnostics[0]["adapter.createElements"]).toBeUndefined();
    expect(audit.report.results[0].phases["create.8"].diagnostics[0]["adapter.createElements"]).toBe(1);
  });
});
