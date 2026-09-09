// Invoke once through the ordinary activity.py build-test gate; no nested gates.
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { fileIdentity, harnessManifest, sourceManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { sha256, fingerprint } from "../../../../benchmark/bun-performance/protocol.mjs";

const directory = import.meta.dir, root = resolve(directory, "../../../..");
const baseline = resolve(directory, "../baseline");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const frozen = json(join(baseline, "reference-manifest.json"));
const source = sourceManifest(root), harness = harnessManifest();
assert.equal(source.sourceSha, "24d89122758dca628786211763497bd065d2c2a4");
const branch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
assert.equal(branch.status, 0);
assert.equal(branch.stdout.trim(), "herdr/plan-bun-native-performance-01-metadata-followup");
for (const name of ["node_modules", "build", "target"]) assert.equal(existsSync(join(root, name)), false, `fresh independent ${name} required`);
const baselineVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
assert.equal(baselineVersion, frozen.runtimes.baseline.version);
assert.equal(fileIdentity(process.execPath).sha256, frozen.runtimes.baseline.sha256);
const historyFiles = {};
function inventory(path, prefix = "") {
  for (const name of readdirSync(path).sort()) {
    const full = join(path, name), key = `${prefix}${name}`;
    if (statSync(full).isDirectory()) inventory(full, `${key}/`);
    else historyFiles[key] = sha256(readFileSync(full));
  }
}
inventory(baseline);
const referenceFiles = json(join(baseline, "reference-source-files.json"));
const checkReference = () => {
  for (const [path, hash] of Object.entries(referenceFiles.files)) assert.equal(sha256(readFileSync(join(referenceFiles.root, path))), hash, `reference changed: ${path}`);
  assert.deepEqual(fileIdentity(frozen.artifact.path), frozen.artifact);
};
checkReference();
writeFileSync(join(directory, "before.json"), JSON.stringify({ at: new Date().toISOString(), source, harness,
  baselineEvidence: { root: baseline, sha256: fingerprint(historyFiles), files: historyFiles },
  reference: { sourceSha: frozen.source.sourceSha, root: frozen.source.root, sourceInventorySha256: referenceFiles.sha256, artifact: frozen.artifact },
  selection: { baseline: ".bun-version", comparison: "Reused task-01 experiment-time latest (1.4.2); no fresh latest claim. Task 05 resolves latest again." } }, null, 2) + "\n");
const results = [];
function run(label, command, bun) {
  const image = join(root, "build/mad-dom.node");
  const record = recordedCommand(join(directory, "commands"), label, command, root, {
    PATH: `${dirname(bun)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1", CARGO_TARGET_DIR: join(root, "target"),
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
  });
  results.push(record);
  assert.ok(record.exitCode === 0 && record.signal === null && record.error === null, `${label} failed; complete output retained`);
  return readFileSync(join(directory, "commands", record.stdout.file), "utf8");
}
const baselineBun = frozen.runtimes.baseline.path;
for (const [lane, runtime] of Object.entries(frozen.runtimes)) {
  assert.equal(fileIdentity(runtime.path).sha256, runtime.sha256);
  const actual = JSON.parse(run(`${lane}-runtime-identity`, [runtime.path, "-e", "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision}))"], runtime.path));
  assert.equal(actual.version, runtime.version); assert.equal(actual.revision, runtime.revision);
}
assert.match(run("rust-toolchain", ["rustc", "--version"], baselineBun), /^rustc 1\.93\.1 /);
run("install", [baselineBun, "install", "--frozen-lockfile"], baselineBun);
assert.equal(sha256(readFileSync(join(root, "bun.lock"))), source.lockSha256);
run("build", [baselineBun, "run", "dev:build"], baselineBun);
const ownArtifact = fileIdentity(join(root, "build/mad-dom.node"));
assert.notEqual(`${ownArtifact.dev}:${ownArtifact.inode}`, `${frozen.artifact.dev}:${frozen.artifact.inode}`);
for (const name of ["node_modules", "build", "target"]) assert.equal(realpathSync(join(root, name)), join(root, name));
const batches = [];
for (const [lane, runtime] of Object.entries(frozen.runtimes)) {
  const bun = runtime.path;
  run(`${lane}-check`, [bun, "run", "check"], bun);
  run(`${lane}-harness-tests`, [bun, "test", "benchmark/bun-performance"], bun);
  run(`${lane}-dom-harness-tests`, [bun, "test", "benchmark/dom-bench/report.test.js", "benchmark/dom-bench/testing-worker.test.js"], bun);
  run(`${lane}-runtime-report`, [bun, "run", "report:runtime"], bun);
  const out = join(directory, `${lane}-tiny`);
  run(`${lane}-tiny`, [bun, join(root, "benchmark/bun-performance/run.mjs"), "--bun", bun, "--reference-root", root,
    "--reference-image", ownArtifact.path, "--smoke", "--out", out], bun);
  run(`${lane}-verify-tiny`, [bun, join(root, "benchmark/bun-performance/run.mjs"), "--verify", out], bun);
  // Read-only old-evidence verification: never reruns a measured worker or writes old files.
  run(`${lane}-verify-history`, [bun, join(root, "benchmark/bun-performance/run.mjs"), "--verify", join(baseline, `${lane}-formal`)], bun);
  const manifest = json(join(out, "manifest.json"));
  assert.equal(manifest.valid, true); assert.deepEqual(manifest.harness, harness);
  const attempts = manifest.attempts.map(file => json(join(out, file)));
  for (const attempt of attempts) {
    assert.equal(attempt.metadata.artifact.path, ownArtifact.path);
    assert.equal(attempt.metadata.artifact.sha256, ownArtifact.sha256);
    assert.ok(attempt.metadata.handshake.startsWith("preload:"));
    if (attempt.config.ffi === "off") assert.doesNotMatch(attempt.metadata.handshake, /query|serialization|UTF-8/);
  }
  batches.push({ lane, root: out, manifestSha256: sha256(readFileSync(join(out, "manifest.json"))), processes: attempts.length,
    valid: true, kind: manifest.protocol.kind, runtime: manifest.bun, handshakeByMode: Object.fromEntries(attempts.map(a => [a.config.ffi, a.metadata.handshake])) });
}
for (const [path, hash] of Object.entries(historyFiles)) assert.equal(sha256(readFileSync(join(baseline, path))), hash, `historical evidence changed: ${path}`);
checkReference();
assert.deepEqual(sourceManifest(root), source);
assert.deepEqual(harnessManifest(), harness);
assert.deepEqual(fileIdentity(ownArtifact.path), ownArtifact);
for (const record of results) for (const stream of ["stdout", "stderr"]) assert.equal(sha256(readFileSync(join(directory, "commands", record[stream].file))), record[stream].sha256);
for (let i = 1; i < results.length; i++) assert.ok(Date.parse(results[i].started) >= Date.parse(results[i - 1].ended));
const result = { at: new Date().toISOString(), passed: true, source, harness, artifact: ownArtifact, batches,
  commands: results.map(r => ({ label: r.label, exitCode: r.exitCode, signal: r.signal, error: r.error })),
  serial: true, historicalEvidenceUnchanged: true, referenceUnchanged: true, historicalEvidenceSha256: fingerprint(historyFiles),
  buildIsolation: ["node_modules", "build", "target"].map(name => join(root, name)),
  limitations: ["Correctness/tiny checks only; no new performance campaign", "Reused 1.4.2 is task-01 experiment-time latest, not a permanent latest designation", "Node-API HTML/range policy fixtures test reporting acceptance; this followup adds no production route"] };
writeFileSync(join(directory, "validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, commands: results.length, harness: harness.sha256, artifact: ownArtifact.sha256, batches: batches.length }));
