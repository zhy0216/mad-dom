// Run under sampling. Decide only after the complete initial matrix is valid.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { evidence, root, save } from "./command.mjs";
const [lane, ffi] = process.argv.slice(2);
assert.ok(["baseline", "latest"].includes(lane) && ["on", "off"].includes(ffi));
for (const key of ["baseline-source-on", "latest-source-on", "baseline-source-off", "latest-source-off"]) {
  assert.equal(JSON.parse(readFileSync(join(evidence, `${key}-formal/manifest.json`), "utf8")).valid, true);
}
const key = `${lane}-source-${ffi}`;
const initial = JSON.parse(readFileSync(join(evidence, `${key}-formal/summary.json`), "utf8"));
assert.equal(initial.valid, true);
assert.equal(initial.protocol.kind, "formal");
const triggers = initial.rows.filter(r => r.unstable || r.changePercent > 5 || r.groupChangesPercent.every(x => x > 5));
save(`${key}-supplement-decision.json`, { at: new Date().toISOString(), key,
  suites: [...new Set(triggers.map(r => r.suite))],
  triggers: triggers.map(({ suite, size, phase, unstable, changePercent, groupChangesPercent }) =>
    ({ suite, size, phase, unstable, changePercent, groupChangesPercent })),
  rule: "Predeclared full-suite repeat for instability, any pooled change >5%, or both group changes >5%; all initial samples retained." });
if (triggers.length) {
  const p = spawnSync(process.execPath, ["plans/bun-native-performance/evidence/task-02/campaign.mjs", "supplemental", lane, ffi],
    { cwd: root, stdio: "inherit" });
  process.exit(p.status ?? 1);
}
console.log(`${key}: no supplemental suite triggered; no additional samples run`);
