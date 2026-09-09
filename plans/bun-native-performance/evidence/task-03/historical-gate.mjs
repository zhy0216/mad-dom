// Run after the formal campaigns under activity.py --task 03 --kind sampling.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileIdentity, sourceManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";

const root = resolve(import.meta.dir, "../../../..");
const original = fileIdentity(join(root, "docs/bun-native-runtime-evidence/06-baseline.linux-x64.json"));
assert.equal(original.sha256, "bc571c411ed1b61efc25b03bb9ad1e06b1d2032460e62ce2127c16943e43d9ff");
const baseline = JSON.parse(readFileSync(original.path));
assert.equal(baseline.host.os, process.platform);
assert.equal(baseline.host.arch, process.arch);
assert.equal(baseline.host.bun, Bun.version);
assert.equal(baseline.host.rust, "1.93.1");
assert.equal(Object.keys(baseline.metrics).length, 19);
const target = join(root, "bench/baseline.linux-x64.json");
if (existsSync(target)) assert.equal(fileIdentity(target).sha256, original.sha256);
else copyFileSync(original.path, target);
chmodSync(target, 0o444);
const image = join(root, "build/mad-dom.node");
const before = { source: sourceManifest(root), image: fileIdentity(image) };
const command = recordedCommand(join(import.meta.dir, "commands"), "latest-historical-bench-check",
  [process.execPath, "run", "bench:check"], root, {
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1", CARGO_TARGET_DIR: join(root, "target"),
  });
const after = { source: sourceManifest(root), image: fileIdentity(image) };
const report = { original, copy: fileIdentity(target), host: baseline.host, metrics: 19,
  before, after, command,
  limitation: "Unchanged historical Linux guard from task 01's documented original. OS/arch/Bun/Rust agreement does not prove identical CPU or load; this is neither a first-host recording nor an ABBA comparison. Original RSS limitations remain." };
writeFileSync(join(import.meta.dir, "historical-gate.json"), JSON.stringify(report, null, 2) + "\n");
assert.equal(report.copy.sha256, original.sha256);
assert.equal(after.source.productionSha256, before.source.productionSha256);
assert.equal(after.image.sha256, before.image.sha256);
process.exitCode = command.exitCode === 0 && !command.signal && !command.error ? 0 : 1;
