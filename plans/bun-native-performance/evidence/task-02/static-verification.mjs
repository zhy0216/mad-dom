import { readFileSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { root, evidence, reference, digest, save } from "./command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";

const frozen = JSON.parse(readFileSync(join(evidence, "../baseline/reference-source-files.json"), "utf8"));
const mismatches = [], writable = [];
for (const [path, sha256] of Object.entries(frozen.files)) {
  const actual = join(frozen.root, path);
  if (digest(readFileSync(actual)) !== sha256) mismatches.push(path);
  if (statSync(actual).mode & 0o222) writable.push(path);
}
assert.equal(Object.keys(frozen.files).length, 1498);
assert.deepEqual(mismatches, []);
assert.deepEqual(writable, []);
const symbols = path => {
  const p = spawnSync("nm", ["-D", "--defined-only", path], { encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim().split("\n").map(s => s.trim().split(/\s+/).at(-1))
    .filter(s => s.startsWith("mad_dom_ffi_")).sort();
};
const candidate = { source: sourceManifest(root), image: fileIdentity(join(root, "build/mad-dom.node")) };
const actualReference = { source: sourceManifest(reference.source.root), image: fileIdentity(reference.artifact.path) };
assert.equal(actualReference.source.productionSha256, reference.source.productionSha256);
assert.equal(actualReference.image.sha256, reference.artifact.sha256);
assert.notEqual(candidate.image.inode, actualReference.image.inode);
const ffiSymbols = { candidate: symbols(candidate.image.path), reference: symbols(actualReference.image.path) };
assert.deepEqual(ffiSymbols.candidate, ffiSymbols.reference);
assert.ok(ffiSymbols.candidate.length > 0);
const original = JSON.parse(readFileSync(join(evidence, "before.json"), "utf8")).candidate;
const changedProduction = Object.keys(candidate.source.files).filter(p => candidate.source.files[p] !== original.files[p]);
assert.deepEqual(changedProduction.sort(), ["crates/mad-dom-bun/src/handle.rs", ...["ABI.md", "buffer.rs", "mod.rs", "tests.rs"].map(p => `crates/mad-dom-bun/src/ffi/${p}`)].sort());
assert.equal(realpathSync(join(root, "target")), join(root, "target"));
assert.equal(realpathSync(join(root, "build")), join(root, "build"));
assert.match(readFileSync(join(root, "crates/mad-dom-core/src/lib.rs"), "utf8"), /#!\[forbid\(unsafe_code\)\]/);
const at = new Date().toISOString();
const result = { at, frozenTrackedFiles: Object.keys(frozen.files).length, mismatches, writable,
  candidate, reference: actualReference, ffiSymbols, changedProduction, harness: harnessManifest(),
  ffiFastPathTestSha256: digest(readFileSync(join(root, "tests/bun/ffi-fast-path.test.js"))),
  limits: "Symbol/source inventory checks complement real ABI tests; they do not prove arbitrary caller pointer validity or FFI memory safety." };
const file = `static-verification-${at.replaceAll(/[:.]/g, "-")}.json`;
save(file, result);
console.log(JSON.stringify({ file, frozenTrackedFiles: result.frozenTrackedFiles, ffiSymbols, changedProduction,
  candidateImage: candidate.image, referenceImage: actualReference.image }, null, 2));
