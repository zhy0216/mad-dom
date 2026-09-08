// Run once after the complete campaign, before changing inventory/verification.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { harnessManifest, fileIdentity } from "../../../../benchmark/bun-performance/provenance.mjs";
import { sha256 } from "../../../../benchmark/bun-performance/protocol.mjs";
const directory = import.meta.dir;
const json = path => JSON.parse(readFileSync(path, "utf8"));
const start = json(join(directory, "sampling-start.json"));
const harness = harnessManifest();
assert.deepEqual(harness, start.harness, "measured harness changed during the campaign");
const batches = readdirSync(directory).filter(name => /^(baseline|latest)-(reference-smoke|source-smoke-(on|off)|formal|supplemental|profiles)$/.test(name));
assert.equal(batches.length, 12);
const records = batches.map(name => {
  const manifest = json(join(directory, name, "manifest.json"));
  assert.equal(manifest.valid, true, `incomplete campaign: ${name}`);
  assert.deepEqual(manifest.harness, harness);
  return { directory: name, manifest: fileIdentity(join(directory, name, "manifest.json")), ended: manifest.ended };
});
const contents = Object.fromEntries(Object.keys(harness.files).map(name => {
  const utf8 = readFileSync(join(harness.root, name), "utf8");
  assert.equal(sha256(utf8), harness.files[name]);
  return [name, utf8];
}));
assert.equal(fileIdentity(join(directory, "reference-manifest.json")).sha256, start.referenceManifest.sha256);
assert.equal(fileIdentity(join(directory, "method.md")).sha256, start.method.sha256);
const out = join(directory, "measured-harness-source.json");
assert.equal(existsSync(out), false, "never overwrite the measurement snapshot");
writeFileSync(out, JSON.stringify({ captured: new Date().toISOString(), harness, contents, batches: records,
  driver: { ...fileIdentity(join(directory, "sample.mjs")), utf8: readFileSync(join(directory, "sample.mjs"), "utf8") },
  method: start.method, referenceManifest: start.referenceManifest,
  note: "Exact UTF-8 source bytes used for all twelve campaign batches. Later inventory/verification repairs do not rewrite these sources, manifests or samples." }, null, 2) + "\n");
console.log(JSON.stringify({ snapshot: fileIdentity(out), measuredHarnessSha256: harness.sha256, batches: batches.length }));
