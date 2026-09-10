// Task 05 single-lock campaign driver. This whole process is invoked under ONE
// `activity.py --task 05 --kind sampling` reservation; no child takes a nested
// lock and nothing detaches from this driver. Serial order (method.md):
// bench:check guard -> tiny smokes -> six formal campaigns (auto-supplemental)
// -> independent profiles -> final combined analysis.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";

const dir = import.meta.dir;
const root = resolve0();
function resolve0() { const u = new URL("../../../..", import.meta.url).pathname; return u.endsWith("/") ? u.slice(0, -1) : u; }
const frozen = JSON.parse(readFileSync(join(dir, "../baseline/reference-manifest.json")));
const runtimes = JSON.parse(readFileSync(join(dir, "runtimes.json")));
const image = join(root, "build/mad-dom.node");
const started = new Date().toISOString();

const inventory = () => ({ at: new Date().toISOString(),
  candidate: sourceManifest(root), reference: sourceManifest(frozen.source.root),
  candidateImage: fileIdentity(image), referenceImage: fileIdentity(frozen.artifact.path),
  baselineExe: fileIdentity(runtimes.baseline.path), latestExe: fileIdentity(runtimes.latest.path),
  harness: harnessManifest(),
  drivers: Object.fromEntries(["campaign.mjs", "analyze.mjs", "method.md", "campaign-all.mjs"]
    .map(n => [n, fileIdentity(join(dir, n))])) });
const pre = inventory();
assert.equal(pre.candidateImage.sha256, "6b7e7398119fe255a3aead79cf81d6e68da40923359dc2c8b2595c9663331903", "candidate image identity");
assert.equal(pre.referenceImage.sha256, frozen.artifact.sha256, "frozen reference image");
assert.notEqual(pre.candidateImage.inode, pre.referenceImage.inode);

const results = [];
function step(argv, label, env = { MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image }) {
  const fullEnv = { ...env };
  console.log(`\n=== ${label}: ${argv.slice(0, 3).join(" ")} ...`);
  const t0 = new Date().toISOString();
  const p = spawnSync(argv[0], argv.slice(1), { cwd: root, env: { ...process.env, ...fullEnv }, stdio: "inherit" });
  const code = p.status ?? -1;
  results.push({ label, argv, startedAt: t0, endedAt: new Date().toISOString(), exitCode: code, signal: p.signal ?? null, error: p.error?.message ?? null });
  if (code !== 0 || p.signal || p.error) throw new Error(`campaign step failed: ${label} exit=${code} signal=${p.signal}`);
}
function laneEnv(lane) {
  const exe = runtimes[lane].path;
  return { exe, env: { PATH: `${exe.slice(0, exe.lastIndexOf("/"))}:${process.env.PATH}`, MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image } };
}

try {
  // 1. Historical bench:check guard (unmodified baseline copy, per method.md).
  for (const lane of ["baseline", "latest"]) {
    const { exe, env } = laneEnv(lane);
    const rec = recordedCommand(join(dir, "commands"), `bench-check-${lane}`, [exe, "run", "bench:check"], root, { ...env, MAD_DOM_FFI_DISABLED: "0" });
    results.push({ label: `bench-check-${lane}`, recorded: true, exitCode: rec.exitCode, signal: rec.signal, error: rec.error });
    if (rec.exitCode !== 0 || rec.signal || rec.error) throw new Error(`bench:check ${lane} failed`);
  }
  // 2. Tiny correctness smokes for every campaign shape (no speedups).
  for (const lane of ["baseline", "latest"]) for (const [mode, ffi] of [["source", "on"], ["source", "off"], ["ffi", "on"]]) {
    step([runtimes[lane].path, join(dir, "campaign.mjs"), `smoke-${lane}-${mode}${ffi}`, lane, mode, ffi, "smoke"], `smoke ${lane} ${mode}${ffi}`);
  }
  // 3. Six formal campaigns (each auto-supplements flagged suites once).
  for (const lane of ["baseline", "latest"]) {
    step([runtimes[lane].path, join(dir, "campaign.mjs"), `${lane}-source-on`, lane, "source", "on", "formal"], `${lane} source-on`);
    step([runtimes[lane].path, join(dir, "campaign.mjs"), `${lane}-mode`, lane, "ffi", "on", "formal"], `${lane} FFI mode`);
    step([runtimes[lane].path, join(dir, "campaign.mjs"), `${lane}-source-off`, lane, "source", "off", "formal"], `${lane} source-off`);
  }
  // 4. Independent CPU profiles (diagnostics only, never ratios).
  for (const lane of ["baseline", "latest"]) {
    step([runtimes[lane].path, join(dir, "campaign.mjs"), `profile-${lane}`, lane, "source", "on", "profile", "raw,adapter,facade"], `${lane} profiles`);
  }
  // 5. Final combined analysis over every retained batch.
  step([runtimes.latest.path, join(dir, "analyze.mjs")], "final analysis");
} finally {
  const post = inventory();
  const unchanged = ["candidate", "reference"].every(k => post[k].productionSha256 === pre[k].productionSha256)
    && ["candidateImage", "referenceImage", "baselineExe", "latestExe", "harness"].every(k => post[k].sha256 === pre[k].sha256)
    && JSON.stringify(post.drivers) === JSON.stringify(pre.drivers);
  writeFileSync(join(dir, "campaign.json"), JSON.stringify({
    started, ended: new Date().toISOString(), reservation: "one activity.py --task 05 --kind sampling (held by this driver)",
    before: pre, after: post, unchanged, steps: results,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ finished: true, unchanged, steps: results.map(r => ({ label: r.label, exit: r.exitCode })) }));
}
