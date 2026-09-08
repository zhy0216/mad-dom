import { readFileSync, writeFileSync, statSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { sha256, fingerprint } from "../../../../benchmark/bun-performance/protocol.mjs";
const directory = import.meta.dir, root = resolve(directory, "../../../..");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const frozen = json(join(directory, "reference-manifest.json"));
const original = json(join(directory, "reference-source-files.json"));
const snapshot = json(join(directory, "measured-harness-source.json"));
assert.equal(fileIdentity(join(directory, "reference-manifest.json")).sha256, snapshot.referenceManifest.sha256);
assert.equal(fileIdentity(join(directory, "method.md")).sha256, snapshot.method.sha256);
assert.equal(sha256(snapshot.driver.utf8), snapshot.driver.sha256);
assert.equal(fileIdentity(join(directory, "sample.mjs")).sha256, snapshot.driver.sha256);
for (const batch of snapshot.batches) assert.equal(fileIdentity(join(directory, batch.directory, "manifest.json")).sha256, batch.manifest.sha256, `measured manifest changed: ${batch.directory}`);
const files = Object.fromEntries(Object.keys(original.files).map(name => {
  const path = join(original.root, name);
  assert.equal(sha256(readFileSync(path)), original.files[name], `reference changed: ${name}`);
  if (lstatSync(path).isFile()) assert.equal(statSync(path).mode & 0o222, 0, `writable reference source: ${name}`);
  return [name, original.files[name]];
}));
assert.equal(Object.keys(files).length, frozen.allTrackedSource.count);
assert.equal(fingerprint(files), original.sha256);
const source = sourceManifest(frozen.source.root), task = sourceManifest(root);
assert.deepEqual(source.files, frozen.source.files, "expanded reference inventory must preserve the original file set and hashes");
assert.equal(source.untrackedProductionFiles.length, 0);
assert.equal(source.sourceSha, frozen.source.sourceSha);
assert.equal(source.productionSha256, frozen.source.productionSha256);
assert.equal(task.productionSha256, frozen.source.productionSha256, "task production changed");
assert.equal(task.lockSha256, frozen.source.lockSha256);
const artifact = fileIdentity(frozen.artifact.path), taskArtifact = fileIdentity(frozen.taskArtifact.path);
assert.deepEqual(artifact, frozen.artifact);
assert.deepEqual(taskArtifact, frozen.taskArtifact);
assert.notEqual(`${artifact.dev}:${artifact.inode}`, `${taskArtifact.dev}:${taskArtifact.inode}`);
const outputs = [];
function readonly(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  assert.equal(stat.mode & 0o222, 0, `writable reference output: ${path}`);
  if (stat.isDirectory()) for (const name of readdirSync(path)) readonly(join(path, name));
}
for (const name of ["build", "target"]) {
  const referencePath = realpathSync(join(source.root, name)), taskPath = realpathSync(join(root, name));
  assert.notEqual(referencePath, taskPath);
  const a = statSync(referencePath), b = statSync(taskPath);
  assert.notEqual(`${a.dev}:${a.ino}`, `${b.dev}:${b.ino}`);
  readonly(referencePath);
  outputs.push({ name, referencePath, taskPath, separate: true, referenceReadonly: true });
}
const runtimes = Object.fromEntries(Object.entries(frozen.runtimes).map(([lane, runtime]) => {
  const executable = fileIdentity(runtime.path), archive = fileIdentity(runtime.archive.path);
  assert.equal(executable.sha256, runtime.sha256);
  assert.equal(archive.sha256, runtime.archive.sha256);
  assert.equal(statSync(runtime.path).mode & 0o222, 0);
  return [lane, { executable, archive, version: runtime.version, revision: runtime.revision }];
}));
const harness = harnessManifest();
const changedHarnessFiles = Object.keys(harness.files).filter(name => harness.files[name] !== snapshot.harness.files[name]);
for (const name of ["worker.mjs", "protocol.mjs", "preload.mjs", "diagnostics.mjs", "audit.mjs"]) assert.equal(harness.files[name], snapshot.harness.files[name], `measured operation/preload/audit changed: ${name}`);
for (const [name, utf8] of Object.entries(snapshot.contents)) assert.equal(sha256(utf8), snapshot.harness.files[name]);
const result = { verifiedAt: new Date().toISOString(), passed: true, source, task, artifact, taskArtifact, runtimes, outputs,
  allTrackedFiles: { count: Object.keys(files).length, sha256: original.sha256, readonly: true },
  measuredHarness: snapshot.harness, currentHarness: harness, changedHarnessFiles,
  note: "HEAD is an anchor; current production digest is checked separately. The expanded inventory exactly matches the frozen reference. No measurement records or original inventories were rewritten." };
writeFileSync(join(directory, "post-campaign-integrity.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, trackedFiles: Object.keys(files).length, productionSha256: source.productionSha256, changedHarnessFiles }));
