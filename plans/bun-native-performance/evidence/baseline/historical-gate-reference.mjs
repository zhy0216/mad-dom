// Coordinator explicitly authorized this unchanged copy into the ignored host path.
import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { fileIdentity } from "../../../../benchmark/bun-performance/provenance.mjs";
const root = resolve(import.meta.dir, "../../../..");
const original = fileIdentity(join(root, "docs/bun-native-runtime-evidence/06-baseline.linux-x64.json"));
const target = join(root, "bench/baseline.linux-x64.json");
const report = JSON.parse(readFileSync(original.path, "utf8"));
assert.equal(report.host.os, process.platform);
assert.equal(report.host.arch, process.arch);
assert.equal(report.host.bun, Bun.version, "run this historical gate with its recorded Bun version");
assert.equal(report.host.rust, "1.93.1");
assert.equal(Object.keys(report.metrics).length, 19);
if (existsSync(target)) assert.equal(fileIdentity(target).sha256, original.sha256, "do not overwrite an unrelated host baseline");
else copyFileSync(original.path, target);
chmodSync(target, 0o444);
const copy = fileIdentity(target);
assert.equal(copy.sha256, original.sha256);
writeFileSync(join(import.meta.dir, "historical-gate-reference.json"), JSON.stringify({ original, copy, host: report.host,
  metrics: Object.keys(report.metrics).length, copiedAt: new Date().toISOString(),
  authorization: "Coordinator explicitly allows this unchanged ignored host-baseline copy after the campaign",
  limitation: "OS/arch and Bun/Rust agreement do not prove matching CPU, hardware or load. This is an existing historical guard, not a first-host recording or a formal performance ratio." }, null, 2) + "\n");
console.log(JSON.stringify({ original, copy, host: report.host, metrics: 19 }));
