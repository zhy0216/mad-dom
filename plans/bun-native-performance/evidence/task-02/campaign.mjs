import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { root, evidence, reference, run, save, digest } from "./command.mjs";
import { sourceManifest, fileIdentity, harnessManifest, systemLoad } from "../../../../benchmark/bun-performance/provenance.mjs";

const { runtimes } = JSON.parse(readFileSync(join(evidence, "runtimes.json"), "utf8"));
const [kind, lane, ffi = "on"] = process.argv.slice(2);
assert.ok(["smoke", "formal", "supplemental", "profile"].includes(kind));
assert.ok(runtimes[lane]);
assert.ok(["on", "off"].includes(ffi));
const name = `${lane}-source-${ffi}-${kind}`;
const out = join(evidence, name);
assert.ok(!existsSync(out), `append-only evidence: ${out}`);
const capture = () => ({ candidateSource: sourceManifest(root), candidateImage: fileIdentity(join(root, "build/mad-dom.node")),
  referenceSource: sourceManifest(reference.source.root), referenceImage: fileIdentity(reference.artifact.path),
  runtime: fileIdentity(runtimes[lane].path), harness: harnessManifest(),
  driver: Object.fromEntries(["campaign.mjs", "command.mjs", "smokes.mjs", "supplement.mjs", "method.md"].map(p => [p, digest(readFileSync(join(evidence, p)))])) });
const before = capture();
const checks = JSON.parse(readFileSync(join(evidence, "checks-all.json"), "utf8"));
assert.ok(checks.every(r => r.exitCode === 0) && checks.at(-1)?.id.endsWith("-static-verification"),
  "complete checks must pass before sampling");
const verifiedFile = readdirSync(evidence).filter(p => /^static-verification-.*\.json$/.test(p)).sort().at(-1);
assert.ok(verifiedFile, "missing verification of the compiled candidate");
const verified = JSON.parse(readFileSync(join(evidence, verifiedFile), "utf8"));
assert.deepEqual(before.candidateSource, verified.candidate.source, "candidate source changed after verification");
assert.deepEqual(before.candidateImage, verified.candidate.image, "candidate image changed after verification");
if (kind !== "smoke") {
  const smoke = JSON.parse(readFileSync(join(evidence, `${lane}-source-${ffi}-smoke/manifest.json`), "utf8"));
  assert.equal(smoke.valid, true);
  assert.deepEqual(smoke.candidate.source, before.candidateSource);
  assert.deepEqual(smoke.candidate.image, before.candidateImage);
}
if (kind === "formal") {
  const order = ["baseline-source-on", "latest-source-on", "baseline-source-off", "latest-source-off"];
  const index = order.indexOf(`${lane}-source-${ffi}`);
  if (index > 0) {
    const previous = JSON.parse(readFileSync(join(evidence, `${order[index - 1]}-formal/manifest.json`), "utf8"));
    assert.equal(previous.valid, true, "preceding source comparison must be complete");
    assert.deepEqual(previous.candidate.source, before.candidateSource);
    assert.deepEqual(previous.candidate.image, before.candidateImage);
  }
}
assert.equal(before.referenceImage.sha256, reference.artifact.sha256);
assert.equal(before.referenceSource.productionSha256, reference.source.productionSha256);
assert.equal(before.runtime.sha256, runtimes[lane].sha256);
assert.notEqual(before.candidateImage.inode, before.referenceImage.inode);
assert.notEqual(before.candidateImage.sha256, before.referenceImage.sha256);
const original = JSON.parse(readFileSync(join(evidence, "before.json"), "utf8"));
assert.notEqual(before.candidateSource.files["crates/mad-dom-bun/src/handle.rs"], original.candidate.files["crates/mad-dom-bun/src/handle.rs"]);
let suites = ["core", "testing", "raw", "adapter", "facade"];
if (kind === "supplemental") {
  const initial = JSON.parse(readFileSync(join(evidence, `${lane}-source-${ffi}-formal/summary.json`), "utf8"));
  const flagged = new Set(initial.rows.filter(r => r.unstable || r.changePercent > 5 || r.groupChangesPercent.every(x => x > 5)).map(r => r.suite));
  suites = suites.filter(x => flagged.has(x));
  assert.ok(suites.length, "no suite triggered the predeclared supplement");
}
const bun = runtimes[lane].path;
const command = [bun, "benchmark/bun-performance/run.mjs", "--bun", bun,
  "--reference-root", reference.source.root, "--reference-image", reference.artifact.path,
  "--candidate-root", root, "--candidate-image", before.candidateImage.path,
  "--mode", "source", "--ffi", ffi, "--out", out];
if (kind === "smoke") command.push("--smoke");
else if (kind === "profile") command.push("--suites", "raw,adapter,facade", "--sizes", "1", "--iterations", "32", "--profile", `/tmp/mad-dom-bun-performance-02/profiles/${name}`);
else command.push("--suites", suites.join(","), "--groups", "2", "--sizes", "1,0.1,2", "--iterations", "32");
const record = { name, kind, lane, ffi, command, before, beforeLoad: systemLoad(), started: new Date().toISOString() };
save(`${name}-integrity.json`, record);
const result = run(name, command);
record.commandId = result.id;
record.exitCode = result.exitCode;
record.after = capture();
record.afterLoad = systemLoad();
record.ended = new Date().toISOString();
record.unchanged = JSON.stringify(before) === JSON.stringify(record.after);
save(`${name}-integrity.json`, record);
assert.ok(record.unchanged, "measured production/source/image/runtime/harness changed during campaign");
if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
assert.equal(run(`${name}-verify`, [bun, "benchmark/bun-performance/run.mjs", "--verify", out]).exitCode, 0);
