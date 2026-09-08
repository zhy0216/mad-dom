#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { SCHEMA, SUITES, sha256, fingerprint } from "./protocol.mjs";
import { fileIdentity, sourceManifest, harnessManifest, systemLoad } from "./provenance.mjs";
import { validateAttempt, summarizeComparison } from "./report.mjs";
import { observedPaths } from "./audit.mjs";
import { strict as assert } from "node:assert";

export const HELP = `Bun native performance (explicit executable; source imports; same native image)
Usage:
  bun benchmark/bun-performance/run.mjs --bun /absolute/bun
    --reference-root /absolute/reference --reference-image /absolute/reference/build/mad-dom.node
    --out /absolute/new-evidence-dir [--mode ffi|source]
    [--candidate-root /absolute/candidate --candidate-image /absolute/candidate/build/mad-dom.node]
    [--ffi on|off] [--suites core,testing,raw,adapter,facade] [--sizes 1,0.1,2]
    [--groups 2] [--iterations 32] [--smoke] [--profile /absolute/profile-dir] [--diagnostic]
  bun benchmark/bun-performance/run.mjs --verify /absolute/evidence-dir

mode ffi: A=FFI off, B=FFI on, identical reference source/image/runtime.
mode source: A=reference, B=candidate, identical runtime and --ffi (default on).
Formal: two ABBA groups per suite, every letter a new process; 2 warmup + 9 measured.
Sizes run in the declared order in each process; 1 is primary, 0.1 and 2 auxiliary.
--smoke: 2 warmup + 1 measured, one iteration, size 0.001 unless specified; A/B only;
  correctness only, no speedup. Full 16 Core / 13 Testing / 19 hotspots per layer.
--profile DIR: independent A/B CPU profiles; diagnostics never produce a speedup.
--diagnostic: independent A/B JS allocation/copy/operation call counts; no speedup.
Every hotspot comparison first runs independent per-source/per-mode path audits.
Expected paths are source-informed descriptions; observed paths are audited calls.
--iterations changes hotspot operations per round (default 32; fixtures/setup untimed).
--verify revalidates every child, workload, capability, sample, order and summary input.
Missing image/capability, fallback, runtime mismatch, failed/skipped work => nonzero exit.
All failures/stdout/stderr/samples are preserved in --out. Existing output is refused.

Examples (set BASELINE and LATEST to the executables recorded in the reference manifest):
  "$BASELINE" benchmark/bun-performance/run.mjs --bun "$BASELINE" --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" --mode ffi --out /tmp/baseline-ffi
  "$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" --candidate-root "$PWD" --candidate-image "$PWD/build/mad-dom.node" --mode source --ffi on --out /tmp/latest-candidate
  "$BASELINE" benchmark/bun-performance/run.mjs --bun "$BASELINE" --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" --smoke --out /tmp/smoke
  "$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" --suites raw,adapter,facade --sizes 1 --profile /tmp/cpu-profiles --out /tmp/profile-evidence
`;

function parse(argv) {
  const options = { mode: "ffi", ffi: "on", suites: SUITES, groups: 2, sizes: [1, 0.1, 2], iterations: 32 };
  const values = new Set(["bun", "reference-root", "reference-image", "candidate-root", "candidate-image", "out", "mode", "ffi", "suites", "sizes", "groups", "iterations", "profile", "verify"]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "help" || key === "smoke" || key === "diagnostic") options[key] = true;
    else if (values.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options[key] = argv[++i];
    else throw new Error(`unknown/missing argument: ${argv[i]}`);
  }
  if (options.help || options.verify) return options;
  for (const key of ["bun", "reference-root", "reference-image", "out"]) if (!isAbsolute(options[key] ?? "")) throw new Error(`--${key} must be an explicit absolute path`);
  if (!["ffi", "source"].includes(options.mode) || !["on", "off"].includes(options.ffi)) throw new Error("invalid --mode/--ffi");
  if (options.mode === "source") for (const key of ["candidate-root", "candidate-image"]) if (!isAbsolute(options[key] ?? "")) throw new Error(`--${key} is required for source comparison`);
  options.suites = typeof options.suites === "string" ? options.suites.split(",") : options.suites;
  if (!options.suites.length || new Set(options.suites).size !== options.suites.length || options.suites.some(x => !SUITES.includes(x))) throw new Error("invalid suite list");
  options.sizes = typeof options.sizes === "string" ? options.sizes.split(",").map(x => x.trim() ? Number(x) : NaN) : options.smoke ? [0.001] : options.sizes;
  if (!options.sizes.length || options.sizes.some(x => !Number.isFinite(x) || x <= 0) || new Set(options.sizes).size !== options.sizes.length) throw new Error("invalid sizes");
  options.groups = Number(options.groups);
  options.iterations = options.smoke ? 1 : Number(options.iterations);
  if (!Number.isInteger(options.groups) || options.groups < 2 || !Number.isInteger(options.iterations) || options.iterations < 1) throw new Error("formal groups >= 2; positive integer iterations required");
  if ([options.smoke, options.profile, options.diagnostic].filter(Boolean).length > 1) throw new Error("smoke, profile and diagnostic are separate modes");
  if (options.profile && !isAbsolute(options.profile)) throw new Error("profile path must be absolute");
  return options;
}

function runtimeIdentity(executable) {
  const file = fileIdentity(executable);
  const p = spawnSync(file.path, ["-e", "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision}))"], { encoding: "utf8" });
  if (p.status !== 0) throw new Error(`Bun probe failed: ${p.stderr}`);
  const runtime = JSON.parse(p.stdout);
  if (!runtime.version || !runtime.revision) throw new Error("missing Bun runtime identity");
  return { ...file, ...runtime };
}

function endpoint(root, path) {
  root = realpathSync(root);
  const image = fileIdentity(path);
  if (!image.path.startsWith(`${root}/`)) throw new Error("native image must belong to its source checkout");
  return { root, image, source: sourceManifest(root) };
}

function execute(config, id, side, position, profile) {
  const script = config.suite === "core" ? join(config.root, "benchmark/dom-bench/worker.mjs") :
    config.suite === "testing" ? join(config.root, "benchmark/dom-bench/testing-worker.mjs") : join(import.meta.dir, "worker.mjs");
  const command = [config.bun.path];
  if (profile) {
    const profileDir = join(profile, id);
    mkdirSync(profileDir, { recursive: true });
    command.push("--cpu-prof", "--cpu-prof-dir", profileDir, "--cpu-prof-name", `${id}.cpuprofile`);
  }
  command.push("--preload", join(import.meta.dir, "preload.mjs"), script);
  if (config.suite === "core" || config.suite === "testing") command.push("--engine", "mad-dom", "--runs", String(config.runs), "--sizes", config.sizes.join(","), "--json");
  const env = { ...process.env, PATH: `${dirname(config.bun.path)}:${process.env.PATH}`,
    MAD_DOM_NATIVE_PATH: config.image.path, MAD_DOM_FFI_PATH: config.image.path,
    MAD_DOM_FFI_DISABLED: config.ffi === "on" ? "0" : "1", MAD_DOM_PERFORMANCE_CONFIG: JSON.stringify(config) };
  for (const key of Object.keys(env)) if (key.startsWith("MAD_DOM_TEST_")) delete env[key];
  const before = systemLoad();
  const child = spawnSync(command[0], command.slice(1), { cwd: config.root, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const after = systemLoad();
  const attempt = { id, side, position, config, command, cwd: config.root, before, after,
    exitCode: child.status, signal: child.signal, error: child.error?.message ?? null,
    stdoutSha256: sha256(child.stdout ?? ""), stderrSha256: sha256(child.stderr ?? ""), stderr: child.stderr ?? "" };
  try {
    attempt.report = JSON.parse(child.stdout);
    attempt.metadata = JSON.parse(readFileSync(config.metadataPath, "utf8"));
    validateAttempt(attempt, config);
  } catch (error) {
    attempt.validationError = error.stack ?? String(error);
    attempt.stdout = child.stdout;
  }
  return attempt;
}

function verify(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.equal(fingerprint(manifest.harness.files), manifest.harness.sha256, "harness inventory digest mismatch");
  for (const endpoint of [manifest.reference, manifest.candidate]) {
    const source = endpoint.source;
    assert.equal(source.root, endpoint.root, "source inventory root mismatch");
    assert.equal(fingerprint(source.files), source.productionSha256, "production inventory digest mismatch");
    assert.equal(source.files["bun.lock"], source.lockSha256, "lock inventory mismatch");
    assert.equal(fingerprint(Object.fromEntries(Object.entries(source.files).filter(([p]) => p.startsWith("benchmark/dom-bench/")))), source.domWorkloadSha256, "DOM inventory mismatch");
    assert.ok(endpoint.image.path.startsWith(`${endpoint.root}/`), "image must belong to its source checkout");
  }
  if (manifest.protocol.mode === "ffi") assert.deepEqual(manifest.reference, manifest.candidate, "FFI comparison requires identical source/image endpoints");
  if (manifest.protocol.kind === "formal" || manifest.protocol.mode === "source") assert.equal(manifest.pathAuditsRequired, true, "independent path audits are required");
  const attempts = manifest.attempts.map(file => JSON.parse(readFileSync(join(directory, file), "utf8")));
  assert.equal(manifest.configurations.length, attempts.length, "missing process configurations");
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    validateAttempt(a, manifest.configurations[i]);
    const endpoint = a.side === "A" ? manifest.reference : manifest.candidate;
    assert.equal(a.config.root, endpoint.root, "reference/candidate root mismatch");
    assert.equal(a.config.image.path, endpoint.image.path, "reference/candidate image mismatch");
    assert.equal(a.config.image.sha256, endpoint.image.sha256, "reference/candidate artifact mismatch");
    assert.equal(a.config.source.productionSha256, endpoint.source.productionSha256, "reference/candidate source mismatch");
    assert.deepEqual(a.config.bun, manifest.bun, "protocol runtime mismatch");
    if (manifest.pathAuditsRequired && !["core", "testing"].includes(a.config.suite) && !a.config.diagnostic) {
      assert.ok(a.config.pathAudit, "missing independent operation path evidence");
      const raw = readFileSync(join(directory, a.config.pathAudit.file), "utf8");
      assert.equal(sha256(raw), a.config.pathAudit.sha256, "path audit checksum mismatch");
      const audit = JSON.parse(raw);
      for (const key of ["root", "ffi", "suite"]) assert.deepEqual(audit.config[key], a.config[key], `path audit ${key} mismatch`);
      assert.equal(audit.config.image.sha256, a.config.image.sha256);
      assert.equal(audit.config.source.productionSha256, a.config.source.productionSha256);
      assert.deepEqual(audit.config.bun, a.config.bun);
      assert.deepEqual(audit.config.sizes, a.config.sizes);
      assert.deepEqual(observedPaths(audit), a.config.observedPaths, "observed path audit mismatch");
    }
  }
  const rows = summarizeComparison(attempts, manifest.protocol);
  const result = { schema: SCHEMA, valid: true, protocol: manifest.protocol, rows };
  if (existsSync(join(directory, "summary.json"))) assert.deepEqual(JSON.parse(readFileSync(join(directory, "summary.json"), "utf8")), result, "saved summary differs from verified raw samples");
  return result;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  if (options.verify) {
    const result = verify(resolve(options.verify));
    console.log(JSON.stringify({ valid: true, rows: result.rows.length, kind: result.protocol.kind }));
    return;
  }
  if (existsSync(options.out)) throw new Error(`output already exists: ${options.out}`);
  mkdirSync(options.out, { recursive: true });
  const manifest = { schema: SCHEMA, started: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
    reservation: "Caller must hold coordinator's serial timing reservation; no concurrent build/test/profile",
    protocol: { kind: options.smoke ? "smoke" : options.profile ? "profile" : options.diagnostic ? "diagnostic" : "formal", mode: options.mode,
      A: options.mode === "ffi" ? "reference FFI off" : `reference FFI ${options.ffi}`,
      B: options.mode === "ffi" ? "reference FFI on" : `candidate FFI ${options.ffi}`, sourceFfi: options.ffi,
      groups: options.groups, warmup: 2, runs: options.smoke ? 1 : 9, sizes: options.sizes,
      suites: options.suites, iterations: options.iterations, order: "ABBA per group per suite; suites and sizes in supplied order",
      statistics: "median/p90/MAD from all rounds; operations=sum within round; process medians and group changes retained",
      noise: "flag round MAD >20%, process-median MAD >10%, or opposite group changes beyond +/-5%; repeat flagged suites with two more full ABBA groups once, retain both batches; unresolved variation is inconclusive" },
    harness: harnessManifest(), pathAuditsRequired: true, audits: [], attempts: [], configurations: [] };
  const saveManifest = () => writeFileSync(join(options.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  saveManifest(); // The declared protocol survives setup failure.
  try {
    manifest.bun = runtimeIdentity(options.bun);
    manifest.reference = endpoint(options["reference-root"], options["reference-image"]);
    manifest.candidate = options.mode === "source" ? endpoint(options["candidate-root"], options["candidate-image"]) : manifest.reference;
    saveManifest();
    const sides = manifest.protocol.kind === "formal" ? Array.from({ length: options.groups }, () => ["A", "B", "B", "A"]).flat() : ["A", "B"];
    const errors = [];
    const audits = new Map();
    for (const suite of options.suites) for (let position = 0; position < sides.length; position++) {
      const side = sides[position];
      const target = side === "A" ? manifest.reference : manifest.candidate;
      const ffi = options.mode === "ffi" ? side === "A" ? "off" : "on" : options.ffi;
      const id = `${String(manifest.attempts.length + 1).padStart(3, "0")}-${suite}-${position + 1}-${side}`;
      const config = { ...target, bun: manifest.bun, suite, ffi, sizes: options.sizes,
        iterations: options.iterations, runs: manifest.protocol.runs, diagnostic: Boolean(options.diagnostic), metadataPath: join(options.out, `${id}.metadata.json`) };
      // Only the parent stores the full per-file manifest; child config still has the root digest.
      config.source = { ...target.source }; delete config.source.files;
      if (!options.diagnostic && !["core", "testing"].includes(suite)) {
        const key = `${target.root}:${ffi}:${suite}`;
        // Both audits finish before the suite's first ABBA process starts.
        if (position === 0) for (const auditSide of ["A", "B"]) {
          const auditTarget = auditSide === "A" ? manifest.reference : manifest.candidate;
          const auditFfi = options.mode === "ffi" ? auditSide === "A" ? "off" : "on" : options.ffi;
          const auditKey = `${auditTarget.root}:${auditFfi}:${suite}`;
          if (audits.has(auditKey)) continue;
          const auditId = `audit-${auditSide}-${suite}`;
          const auditConfig = { ...config, ...auditTarget, source: { ...auditTarget.source }, ffi: auditFfi, diagnostic: true, iterations: 1, runs: 1,
            metadataPath: join(options.out, `${auditId}.metadata.json`) };
          delete auditConfig.source.files;
          console.error(`${auditId}: independent path audit, FFI ${auditFfi}`);
          const audit = execute(auditConfig, auditId, auditSide, 0);
          const raw = JSON.stringify(audit, null, 2) + "\n";
          const file = `${auditId}.json`;
          writeFileSync(join(options.out, file), raw);
          manifest.audits.push(file); saveManifest();
          audits.set(auditKey, { pathAudit: { file, sha256: sha256(raw) }, observedPaths: observedPaths(audit) });
        }
        Object.assign(config, audits.get(key));
      }
      console.error(`${id}: ${suite}, FFI ${ffi}, ${manifest.bun.version} (${manifest.protocol.kind})`);
      const attempt = execute(config, id, side, position, options.profile);
      if (attempt.validationError) errors.push({ id, error: attempt.validationError });
      const file = `${id}.json`;
      writeFileSync(join(options.out, file), JSON.stringify(attempt, null, 2) + "\n");
      manifest.attempts.push(file); manifest.configurations.push(config); saveManifest();
    }
    if (errors.length) throw new Error(JSON.stringify(errors));
    const result = verify(options.out);
    writeFileSync(join(options.out, "summary.json"), JSON.stringify(result, null, 2) + "\n");
    manifest.valid = true;
    console.log(JSON.stringify({ valid: true, kind: manifest.protocol.kind, processes: manifest.attempts.length,
      rows: result.rows.length, unstableRows: result.rows.filter(x => x.unstable).length, out: options.out }));
  } catch (error) {
    manifest.valid = false; manifest.error = error.stack ?? String(error); throw error;
  } finally { manifest.ended = new Date().toISOString(); saveManifest(); }
}

if (import.meta.main) await main().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
