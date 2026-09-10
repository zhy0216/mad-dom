// Task 05 formal campaign worker-driver. Invoke under the single task-05
// sampling reservation held by campaign-all.mjs (never nested, never detached).
// Usage: campaign.mjs LABEL baseline|latest [source|ffi] [on|off] [formal|smoke|profile] [suites]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";

const root = resolve(import.meta.dir, "../../../..");
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "../baseline/reference-manifest.json")));
const runtimes = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
const [label, lane, mode = "source", ffi = "on", kind = "formal", suites = "core,testing,raw,adapter,facade"] = process.argv.slice(2);
if (!label || !runtimes[lane] || !["source", "ffi"].includes(mode) || !["on", "off"].includes(ffi) || !["formal", "smoke", "profile"].includes(kind)) {
  throw new Error("campaign.mjs LABEL baseline|latest [source|ffi] [on|off] [formal|smoke|profile] [suites]");
}
const runtime = runtimes[lane];
const integrityFile = join(import.meta.dir, `${label}-integrity.json`);
assert.equal(existsSync(integrityFile), false, "evidence must be append-only");
const inventory = () => ({ at: new Date().toISOString(), candidate: sourceManifest(root),
  reference: sourceManifest(frozen.source.root), candidateImage: fileIdentity(join(root, "build/mad-dom.node")),
  referenceImage: fileIdentity(frozen.artifact.path), executable: fileIdentity(runtime.path), harness: harnessManifest(),
  drivers: Object.fromEntries(["campaign.mjs", "analyze.mjs", "method.md"].map(name => [name, fileIdentity(join(import.meta.dir, name))])) });
const before = inventory();
assert.equal(before.reference.productionSha256, frozen.source.productionSha256, "frozen reference production digest changed");
assert.equal(before.referenceImage.sha256, frozen.artifact.sha256, "frozen reference image changed");
assert.equal(before.executable.sha256, runtime.sha256, "runtime executable changed");
assert.notEqual(before.referenceImage.inode, before.candidateImage.inode, "endpoints must own separate image instances");
const evidence = { before, sourceBytes: Object.fromEntries(Object.entries(before.candidate.files)
  .filter(([path, hash]) => (path.startsWith("js/") || path.startsWith("crates/")) && frozen.source.files[path] !== hash)
  .map(([path]) => [path, readFileSync(join(root, path), "utf8")])) };
writeFileSync(integrityFile, JSON.stringify(evidence, null, 2) + "\n");
const reference = mode === "source" ? frozen.source.root : root;
const out = join(import.meta.dir, label);
const command = [runtime.path, join(root, "benchmark/bun-performance/run.mjs"), "--bun", runtime.path,
  "--reference-root", reference, "--reference-image", join(reference, "build/mad-dom.node"),
  "--mode", mode, "--ffi", ffi, "--suites", suites, "--out", out];
if (mode === "source") command.push("--candidate-root", root, "--candidate-image", join(root, "build/mad-dom.node"));
if (kind === "smoke") command.push("--smoke");
if (kind === "profile") command.push("--profile", join(import.meta.dir, "profiles", label));
try {
  evidence.command = recordedCommand(join(import.meta.dir, "commands"), label, command, root);
  process.exitCode = evidence.command.exitCode === 0 && !evidence.command.signal && !evidence.command.error ? 0 : 1;
  if (kind === "formal" && process.exitCode === 0) {
    evidence.analysisCommand = recordedCommand(join(import.meta.dir, "commands"), `${label}-analysis`,
      [runtime.path, join(import.meta.dir, "analyze.mjs")], root);
    if (evidence.analysisCommand.exitCode !== 0 || evidence.analysisCommand.signal || evidence.analysisCommand.error) process.exitCode = 1;
    if (process.exitCode === 0 && !label.endsWith("-supplemental")) {
      const analysis = JSON.parse(readFileSync(join(import.meta.dir, "analysis.json")));
      const selected = analysis.find(batch => batch.name === label).supplementalSuites;
      if (selected.length) {
        const child = [runtime.path, import.meta.path, `${label}-supplemental`, lane, mode, ffi, "formal", selected.join(",")];
        // The child records its own leaf commands; no nested recordedCommand.
        const started = new Date().toISOString();
        const proc = spawnSync(child[0], child.slice(1), { cwd: root, env: process.env, stdio: "inherit" });
        evidence.supplemental = { command: child, started, ended: new Date().toISOString(),
          exitCode: proc.status, signal: proc.signal, error: proc.error?.message ?? null };
        if (proc.status !== 0 || proc.signal || proc.error) process.exitCode = 1;
      }
    }
  }
} finally {
  evidence.after = inventory();
  for (const field of ["candidate", "reference"]) assert.equal(evidence.after[field].productionSha256, before[field].productionSha256);
  for (const field of ["candidateImage", "referenceImage", "executable", "harness"]) assert.equal(evidence.after[field].sha256, before[field].sha256);
  assert.deepEqual(evidence.after.drivers, before.drivers);
  evidence.unchanged = true;
  writeFileSync(integrityFile, JSON.stringify(evidence, null, 2) + "\n");
}
