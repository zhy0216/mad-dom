// Task-01 sampling execution record / repeatable sequential driver.
// Run only after preparation and repository gates, under the coordinator reservation.
// Existing output is intentionally refused by run.mjs; use another evidence root
// for a new experiment instead of overwriting this baseline.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { strict as assert } from "node:assert";
const root = resolve(import.meta.dir, "../../../..");
const evidence = import.meta.dir;
const frozen = JSON.parse(readFileSync(join(evidence, "reference-manifest.json"), "utf8"));
const reference = frozen.source.root;
const runner = join(root, "benchmark/bun-performance/run.mjs");
assert.equal(sourceManifest(reference).productionSha256, frozen.source.productionSha256);
assert.equal(fileIdentity(frozen.artifact.path).sha256, frozen.artifact.sha256);
assert.equal(statSync(frozen.artifact.path).mode & 0o222, 0, "reference artifact must stay read-only");
assert.equal(sourceManifest(root).productionSha256, frozen.source.productionSha256, "task 01 must not change production source");
writeFileSync(join(evidence, "sampling-start.json"), JSON.stringify({
  started: new Date().toISOString(), reservation: "Coordinator explicitly grants task 01 exclusive serial timing until completion",
  method: fileIdentity(join(evidence, "method.md")), referenceManifest: fileIdentity(join(evidence, "reference-manifest.json")),
  harness: harnessManifest(), matrix: "baseline then latest; each two ABBA; 2 warmup/9 measured; sizes 1,0.1,2; 16 Core/13 Testing/19 hotspots per layer; predeclared supplementation; independent profiles",
}, null, 2) + "\n");
function run(lane, label, args) {
  const bun = frozen.runtimes[lane].path;
  const out = join(evidence, label);
  const command = [bun, runner, "--bun", bun, "--reference-root", reference, "--reference-image", frozen.artifact.path, "--out", out, ...args];
  const result = recordedCommand(join(evidence, "commands"), label, command, root, {
    MAD_DOM_NATIVE_PATH: join(root, "build/mad-dom.node"), MAD_DOM_FFI_PATH: join(root, "build/mad-dom.node"),
    MAD_DOM_FFI_DISABLED: "0", RUSTUP_TOOLCHAIN: "1.93.1",
  });
  if (result.exitCode !== 0) throw new Error(`${label} failed; retained complete failure evidence`);
  return out;
}
for (const lane of ["baseline", "latest"]) {
  run(lane, `${lane}-reference-smoke`, ["--smoke"]);
  for (const ffi of ["on", "off"]) run(lane, `${lane}-source-smoke-${ffi}`, ["--smoke", "--mode", "source", "--ffi", ffi,
    "--candidate-root", root, "--candidate-image", join(root, "build/mad-dom.node")]);
}
for (const lane of ["baseline", "latest"]) run(lane, `${lane}-formal`, []);
const supplementation = [];
for (const lane of ["baseline", "latest"]) {
  const summary = JSON.parse(readFileSync(join(evidence, `${lane}-formal/summary.json`), "utf8"));
  const suites = [...new Set(summary.rows.filter(r => r.unstable).map(r => r.suite))];
  supplementation.push({ lane, trigger: "predeclared unstable flag", rows: summary.rows.filter(r => r.unstable).map(r => ({ suite: r.suite, size: r.size, phase: r.phase })), suites });
  writeFileSync(join(evidence, "supplementation.json"), JSON.stringify(supplementation, null, 2) + "\n");
  if (suites.length) run(lane, `${lane}-supplemental`, ["--suites", suites.join(",")]);
}
for (const lane of ["baseline", "latest"]) {
  run(lane, `${lane}-profiles`, ["--suites", "raw,adapter,facade", "--sizes", "1", "--profile", `/tmp/mad-dom-bun-performance-01/profiles/${lane}`]);
}
