// Run under sampling. Reuse the committed historical Linux guard unchanged.
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { root, evidence, save, run } from "./command.mjs";
import { fileIdentity } from "../../../../benchmark/bun-performance/provenance.mjs";
const { runtimes } = JSON.parse(readFileSync(join(evidence, "runtimes.json"), "utf8"));
const original = fileIdentity(join(root, "docs/bun-native-runtime-evidence/06-baseline.linux-x64.json"));
assert.equal(original.sha256, "bc571c411ed1b61efc25b03bb9ad1e06b1d2032460e62ce2127c16943e43d9ff");
const historical = JSON.parse(readFileSync(original.path, "utf8"));
assert.equal(historical.host.os, process.platform);
assert.equal(historical.host.arch, process.arch);
assert.equal(historical.host.bun, runtimes.latest.version);
assert.equal(historical.host.rust, "1.93.1");
const target = join(root, "bench/baseline.linux-x64.json");
if (existsSync(target)) assert.equal(fileIdentity(target).sha256, original.sha256);
else copyFileSync(original.path, target);
const copy = fileIdentity(target);
assert.equal(copy.sha256, original.sha256);
save("historical-gate-reference.json", { original, copy, copiedAt: new Date().toISOString(), host: historical.host,
  limitation: "Existing historical guard. Matching OS/arch and runtime does not establish matching CPU/load; not a formal source-comparison ratio or a new first-host baseline." });
const result = run("latest-bench-check", [runtimes.latest.path, "run", "bench:check"]);
process.exit(result.exitCode ?? 1);
