// Invoke once through task 02 sampling. All descendants are synchronous; no nested gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { root, evidence, digest, run, save } from "./command.mjs";

const { runtimes } = JSON.parse(readFileSync(join(evidence, "runtimes.json"), "utf8"));
const audit = JSON.parse(readFileSync(join(evidence, "recovery-20260908/audit.json"), "utf8"));
// Before appending commands, check every file inventoried at recovery. Original
// campaign/driver/empty reservation logs and the uncertain leaf stay untouched.
for (const [path, original] of Object.entries(audit.originalEvidenceInventory)) {
  assert.equal(digest(readFileSync(join(evidence, path))), original.sha256, `original evidence changed: ${path}`);
}
const prefix = "plans/bun-native-performance/evidence/task-02/";
assert.equal(run("resume-1-static-before", [runtimes.baseline.path, `${prefix}static-verification.mjs`]).exitCode, 0);
const order = [["baseline", "on"], ["latest", "on"], ["baseline", "off"], ["latest", "off"]];
for (const [lane, ffi] of order) {
  assert.equal(run(`resume-1-verify-${lane}-${ffi}-smoke`, [runtimes[lane].path,
    "benchmark/bun-performance/run.mjs", "--verify", join(evidence, `${lane}-source-${ffi}-smoke`)]).exitCode, 0);
}
const invoke = (lane, script, args = []) => {
  const result = spawnSync(runtimes[lane].path, [`${prefix}${script}`, ...args], { cwd: root, stdio: "inherit" });
  assert.equal(result.status, 0, `${script} ${args.join(" ")}: exit ${result.status}, signal ${result.signal}`);
};
for (const [lane, ffi] of order) invoke(lane, "campaign-resume-1.mjs", ["formal", lane, ffi]);
for (const [lane, ffi] of order) invoke(lane, "supplement-resume-1.mjs", [lane, ffi]);
for (const lane of ["baseline", "latest"]) invoke(lane, "campaign-resume-1.mjs", ["profile", lane, "on"]);
invoke("baseline", "finish-sampling-resume-1.mjs");
save("resume-1-completed.json", { at: new Date().toISOString(), completed: true,
  limitation: "Sampling/derivation completion is not performance acceptance. Review all regressions, public effects and noise before archiving." });
