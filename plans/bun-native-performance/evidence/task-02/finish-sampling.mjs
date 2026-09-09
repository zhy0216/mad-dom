// Run under sampling, after all initial/supplemental campaigns and profiles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { root, evidence, run, save } from "./command.mjs";
const { runtimes } = JSON.parse(readFileSync(join(evidence, "runtimes.json"), "utf8"));
const bun = runtimes.baseline.path;
for (const [label, script] of [["source-analysis", "analyze.mjs"], ["profile-summary", "profile-summary.mjs"]]) {
  assert.equal(run(label, [bun, `plans/bun-native-performance/evidence/task-02/${script}`]).exitCode, 0);
}
// The historical driver records its own leaf command; do not nest recorders.
const historical = spawnSync(bun, ["plans/bun-native-performance/evidence/task-02/historical-gate.mjs"],
  { cwd: root, stdio: "inherit" });
assert.equal(historical.status, 0);
assert.equal(run("post-campaign-static", [bun, "plans/bun-native-performance/evidence/task-02/static-verification.mjs"]).exitCode, 0);
const review = JSON.parse(readFileSync(join(evidence, "repeated-regressions.json"), "utf8"));
save("finish-sampling.json", { at: new Date().toISOString(), completed: true, repeatedRowsToReview: review.length,
  limitation: "Driver completion does not accept a performance regression or establish public benefit. All rows and noise still require review before archiving." });
console.log(JSON.stringify({ completed: true, repeatedRowsToReview: review.length }));
