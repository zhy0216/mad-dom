// Ordinary sampling reservation: v1 -> byte-identical v0 -> full campaign -> v1.
// Native workers are synchronously joined before either source transition.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { sha256 } from "../../../../benchmark/bun-performance/protocol.mjs";

const root = resolve(import.meta.dir, "../../../..");
const label = "latest-v0-source-off-control";
const reportPath = join(import.meta.dir, "null-control-integrity.json");
const journalPath = join(import.meta.dir, "null-control-transitions.jsonl");
const archivePath = join(import.meta.dir, "candidate-v1-source.json");
const archiveHash = "666d9e02c74a06ba0b9aaccde92d4c8502b36c2ae665a49fa360e2595dd24b1c";
const originalDigest = "119652fe7235e5116a21adbb547e288ba6e31768e34c7ce59cb306936ad65fda";
const imageHash = "2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96";
const runtimeHash = "a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c";
const archive = JSON.parse(readFileSync(archivePath));
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "../baseline/reference-manifest.json")));
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
const runtime = runtimes.latest;
const changedPaths = ["js/facade/extensions/html.js", "js/native-loader.js"];
const driverNames = ["null-control.mjs", "null-control-command.mjs", "method-null-control.md", "findings-v1.md", "candidate-v1-source.json",
  "before-source.json", "runtimes.json", "campaign.mjs", "analyze.mjs", "method.md",
  "html-state-probe.mjs", "html-state-checks.mjs"];

assert.equal(existsSync(reportPath), false, "preserve all prior control attempts");
assert.equal(existsSync(journalPath), false, "preserve all prior source transitions");
assert.equal(existsSync(join(import.meta.dir, label)), false, "control output must be new");
assert.equal(existsSync(join(import.meta.dir, `${label}-supplemental`)), false);
assert.equal(sha256(readFileSync(archivePath)), archiveHash);
assert.deepEqual(Object.keys(archive.files).sort(), changedPaths);
assert.equal(process.execPath, runtime.path);
assert.equal(Bun.version, runtime.version);
assert.equal(Bun.revision, runtime.revision);
assert.equal(fileIdentity(runtime.path).sha256, runtimeHash);
assert.equal(process.env.MAD_DOM_NATIVE_PATH, join(root, "build/mad-dom.node"));
assert.equal(process.env.MAD_DOM_FFI_PATH, process.env.MAD_DOM_NATIVE_PATH);
assert.equal(process.env.MAD_DOM_FFI_DISABLED, "1");

const inventory = () => ({ at: new Date().toISOString(), candidate: sourceManifest(root),
  reference: sourceManifest(frozen.source.root), candidateImage: fileIdentity(join(root, "build/mad-dom.node")),
  referenceImage: fileIdentity(frozen.artifact.path), executable: fileIdentity(runtime.path),
  harness: harnessManifest(), drivers: Object.fromEntries(driverNames.map(name => [name, fileIdentity(join(import.meta.dir, name))])) });

function assertImages(state) {
  assert.equal(state.candidateImage.sha256, imageHash);
  assert.equal(state.referenceImage.sha256, imageHash);
  assert.ok(state.candidateImage.dev !== state.referenceImage.dev || state.candidateImage.inode !== state.referenceImage.inode,
    "candidate and reference images must be independent files");
  assert.ok(state.candidateImage.path.startsWith(`${root}/`));
  assert.ok(state.referenceImage.path.startsWith(`${frozen.source.root}/`));
  assert.ok(readFileSync(state.candidateImage.path).equals(readFileSync(state.referenceImage.path)), "image bytes differ");
  assert.equal(state.executable.sha256, runtimeHash);
  assert.equal(state.reference.sourceSha, archive.baselineCommit);
  assert.equal(state.reference.productionSha256, originalDigest);
  assert.equal(state.candidate.sourceSha, archive.gitHead, "task HEAD must not change");
}

function equalProductionBytes(state, expectedBytes) {
  const paths = Object.keys(state.candidate.files);
  assert.deepEqual(paths.sort(), [...expectedBytes.keys()].sort(), "complete production path set differs");
  return paths.map(path => {
    const candidate = readFileSync(join(root, path));
    const expected = expectedBytes.get(path);
    assert.ok(candidate.equals(expected), `production bytes differ: ${path}`);
    const digest = sha256(candidate);
    assert.equal(digest, state.candidate.files[path]);
    assert.equal(digest, sha256(expected));
    return { path, bytes: candidate.byteLength, candidateSha256: digest, expectedSha256: sha256(expected), byteEqual: true };
  });
}

function assertStable(before, after) {
  assert.deepEqual(after.reference.files, before.reference.files);
  assert.equal(after.reference.productionSha256, before.reference.productionSha256);
  for (const field of ["candidateImage", "referenceImage", "executable", "harness", "drivers"]) {
    assert.deepEqual(after[field], before[field], `${field} changed during the control`);
  }
}

function semanticControls() {
  const directory = join(import.meta.dir, "commands/semantic");
  const ledger = JSON.parse(readFileSync(join(directory, "commands.json")));
  assert.equal(ledger.length, 4, "complete queued v1 probes first");
  const expected = ["baseline-v1-html-state-on", "baseline-v1-html-state-off", "latest-v1-html-state-on", "latest-v1-html-state-off"];
  assert.deepEqual(ledger.map(record => record.label), expected);
  return ledger.map(record => {
    assert.equal(record.exitCode, 0, "v1 behavior probe must finish successfully");
    assert.equal(record.signal, null);
    assert.equal(record.error, null);
    for (const stream of ["stdout", "stderr"]) {
      const bytes = readFileSync(join(directory, record[stream].file));
      assert.equal(bytes.byteLength, record[stream].bytes);
      assert.equal(sha256(bytes), record[stream].sha256);
    }
    const probe = JSON.parse(readFileSync(join(directory, record.stdout.file), "utf8"));
    const lane = record.label.startsWith("baseline") ? "baseline" : "latest";
    const mode = record.label.endsWith("-off") ? "off" : "on";
    assert.equal(probe.bun, runtimes[lane].version);
    assert.equal(probe.bunRevision, runtimes[lane].revision);
    assert.equal(probe.bunRevision, frozen.runtimes[lane].revision);
    assert.equal(probe.executable, runtimes[lane].path);
    assert.equal(probe.executableSha256, runtimes[lane].sha256);
    assert.equal(probe.executableSha256, frozen.runtimes[lane].sha256);
    assert.equal(probe.executableIdentity.path, runtimes[lane].path);
    assert.equal(probe.executableIdentity.sha256, probe.executableSha256);
    assert.equal(probe.nativePath, join(root, "build/mad-dom.node"));
    assert.equal(probe.nativeSha256, imageHash);
    assert.equal(probe.nativeSha256, frozen.artifact.sha256);
    assert.equal(probe.nativeIdentity.path, probe.nativePath);
    assert.equal(probe.nativeIdentity.sha256, probe.nativeSha256);
    assert.ok(probe.nativeIdentity.dev !== frozen.artifact.dev || probe.nativeIdentity.inode !== frozen.artifact.inode);
    assert.equal(probe.archiveProductionSha256, archive.productionSha256);
    assert.equal(probe.ffi.status, mode === "on" ? "available" : "disabled");
    assert.equal(probe.publicKindReads, 0);
    assert.ok(probe.observations.some(row => row.name === "element0.after.outer"));
    assert.ok(probe.calls.length > 0);
    return record;
  });
}

function transition(path, bytes, phase) {
  assert.ok(changedPaths.includes(path));
  const destination = join(root, path);
  const current = readFileSync(destination);
  const v0 = originalBytes.get(path);
  const v1 = Buffer.from(archive.files[path].base64, "base64");
  assert.ok(bytes.equals(v0) || bytes.equals(v1), "write only the verified v0 or archived v1 bytes");
  const event = { phase, path, beforeSha256: sha256(current), intendedSha256: sha256(bytes) };
  if (!current.equals(v0) && !current.equals(v1)) {
    // Never erase an unknown intervening edit. Preserve its complete bytes in
    // an exclusively created record before reporting this restoration failure.
    const directory = join(import.meta.dir, "null-control-unexpected-source");
    mkdirSync(directory, { recursive: true });
    const prefix = `${Date.now()}-${process.pid}-${phase}-${path.replaceAll("/", "__")}`;
    let sequence = 0;
    let savedPath;
    do { savedPath = join(directory, `${prefix}-${sequence++}.json`); } while (existsSync(savedPath));
    const unexpected = { schema: "mad-dom-task03-unknown-production-bytes/1", ...event,
      at: new Date().toISOString(), bytes: current.byteLength, sha256: event.beforeSha256,
      knownV0Sha256: sha256(v0), knownV1Sha256: sha256(v1),
      encoding: "base64", base64: current.toString("base64") };
    writeFileSync(savedPath, JSON.stringify(unexpected, null, 2) + "\n", { flag: "wx" });
    assert.ok(Buffer.from(JSON.parse(readFileSync(savedPath)).base64, "base64").equals(current));
    const preserved = { ...event, bytes: current.byteLength, archive: fileIdentity(savedPath) };
    (report.unexpectedSources ??= []).push(preserved);
    appendFileSync(journalPath, JSON.stringify({ ...preserved, at: new Date().toISOString(), state: "blocked-unknown-source" }) + "\n");
    const error = new Error(`refusing to overwrite unknown production bytes: ${path}; preserved in ${savedPath}`);
    report.restoreFailure ??= error.stack;
    throw error;
  }
  appendFileSync(journalPath, JSON.stringify({ ...event, at: new Date().toISOString(), state: "requested" }) + "\n");
  writeFileSync(destination, bytes);
  assert.ok(readFileSync(destination).equals(bytes));
  appendFileSync(journalPath, JSON.stringify({ ...event, at: new Date().toISOString(), state: "written" }) + "\n");
}

const report = { schema: "mad-dom-task03-null-source-control/1", label, started: new Date().toISOString(),
  meaning: "A frozen reference; B own temporary v0 with equal production bytes and an independent image. Restore v1 afterward.",
  archive: fileIdentity(archivePath), outerExecutable: fileIdentity(process.execPath),
  limitation: "Cross-period campaigns alone cannot identify allocation, root/path/image or shared-VM causality." };
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
let restoreRequired = false;
let beforeBytes;
let originalBytes;

try {
  report.semanticControls = semanticControls();
  report.beforeV1 = inventory();
  assertImages(report.beforeV1);
  assert.equal(report.beforeV1.candidate.productionSha256, archive.productionSha256);
  assert.deepEqual(report.beforeV1.reference.files, frozen.source.files);
  const completed = JSON.parse(readFileSync(join(import.meta.dir, "latest-source-off-resumed-integrity.json")));
  assert.equal(completed.unchanged, true);
  assert.deepEqual(report.beforeV1.candidate.files, completed.after.candidate.files);
  assert.deepEqual(report.beforeV1.harness, completed.after.harness);
  beforeBytes = new Map(Object.keys(report.beforeV1.candidate.files).map(path => [path, readFileSync(join(root, path))]));
  originalBytes = new Map(Object.keys(frozen.source.files).map(path => [path, readFileSync(join(frozen.source.root, path))]));
  assert.deepEqual([...beforeBytes.keys()].sort(), [...originalBytes.keys()].sort());
  const differences = [...beforeBytes.keys()].filter(path => !beforeBytes.get(path).equals(originalBytes.get(path))).sort();
  assert.deepEqual(differences, changedPaths);
  for (const path of changedPaths) {
    const saved = archive.files[path];
    assert.equal(sha256(beforeBytes.get(path)), saved.sha256);
    assert.ok(beforeBytes.get(path).equals(Buffer.from(saved.base64, "base64")));
    assert.equal(sha256(originalBytes.get(path)), saved.baselineSha256);
    assert.equal(saved.baselineSha256, frozen.source.files[path]);
  }
  report.restorePlan = changedPaths.map(path => ({ path, v1Sha256: archive.files[path].sha256,
    v0Sha256: archive.files[path].baselineSha256, v0Source: join(frozen.source.root, path) }));
  save();
  restoreRequired = true;
  for (const path of changedPaths) transition(path, originalBytes.get(path), "v1-to-v0");
  report.beforeV0 = inventory();
  assertImages(report.beforeV0);
  assertStable(report.beforeV1, report.beforeV0);
  assert.deepEqual(report.beforeV0.candidate.files, report.beforeV0.reference.files);
  assert.equal(report.beforeV0.candidate.productionSha256, originalDigest);
  report.beforeV0.byteEquality = equalProductionBytes(report.beforeV0, originalBytes);
  save();
  // Separate outer ledger: campaign.mjs records its own leaf commands in commands/.
  report.campaign = recordedCommand(join(import.meta.dir, "commands/null-control"), label,
    [runtime.path, join(import.meta.dir, "campaign.mjs"), label, "latest", "source", "off", "formal"], root);
  report.afterV0 = inventory();
  assertImages(report.afterV0);
  assertStable(report.beforeV0, report.afterV0);
  assert.deepEqual(report.afterV0.candidate.files, report.beforeV0.candidate.files);
  report.afterV0.byteEquality = equalProductionBytes(report.afterV0, originalBytes);
  assert.equal(report.campaign.exitCode, 0);
  assert.equal(report.campaign.signal, null);
  assert.equal(report.campaign.error, null);
  const campaign = JSON.parse(readFileSync(join(import.meta.dir, `${label}-integrity.json`)));
  assert.equal(campaign.unchanged, true);
  assert.equal(campaign.before.candidate.productionSha256, originalDigest);
  assert.equal(campaign.after.candidate.productionSha256, originalDigest);
  report.campaignUnchanged = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (restoreRequired) {
    const restoreErrors = [];
    // One unknown file must not prevent safely restoring another known file.
    for (const path of changedPaths) {
      try { transition(path, Buffer.from(archive.files[path].base64, "base64"), "v0-to-v1"); }
      catch (error) { restoreErrors.push({ path, error: error.stack ?? String(error) }); }
    }
    try {
      report.afterRestoreAttempt = inventory();
      assertImages(report.afterRestoreAttempt);
      assertStable(report.beforeV1, report.afterRestoreAttempt);
      assert.deepEqual(report.afterRestoreAttempt.candidate.files, report.beforeV1.candidate.files);
      report.afterRestoreAttempt.byteEquality = equalProductionBytes(report.afterRestoreAttempt, beforeBytes);
      report.afterV1 = report.afterRestoreAttempt;
      report.restoredV1 = restoreErrors.length === 0;
    } catch (error) {
      restoreErrors.push({ phase: "full-v1-inventory", error: error.stack ?? String(error) });
    }
    if (restoreErrors.length) {
      report.restoreFailures = restoreErrors;
      report.restoreFailure = restoreErrors.map(entry => entry.error).join("\n\n");
      process.exitCode = 1;
    }
  }
  report.ended = new Date().toISOString();
  save();
  console.log(JSON.stringify({ label, failure: report.failure ?? null, restoreFailure: report.restoreFailure ?? null,
    campaignUnchanged: report.campaignUnchanged ?? false, restoredV1: report.restoredV1 ?? false, reportPath }));
}
