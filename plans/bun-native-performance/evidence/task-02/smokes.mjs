// Run under one sampling reservation; synchronous descendants retain the lock.
import { spawnSync } from "node:child_process";
import { root } from "./command.mjs";
for (const lane of ["baseline", "latest"]) for (const ffi of ["on", "off"]) {
  const p = spawnSync(process.execPath, ["plans/bun-native-performance/evidence/task-02/campaign.mjs", "smoke", lane, ffi],
    { cwd: root, stdio: "inherit" });
  if (p.status !== 0) process.exit(p.status ?? 1);
}
