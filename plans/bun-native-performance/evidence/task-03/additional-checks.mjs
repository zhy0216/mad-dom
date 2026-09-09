// Remaining plan-level correctness gates; invoke under build-test permission.
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";

const root = resolve(import.meta.dir, "../../../..");
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
let failed = false;
for (const [lane, runtime] of Object.entries(runtimes)) {
  for (const [label, args] of [
    ["dom-report-tests", ["test", "benchmark/dom-bench/report.test.js", "benchmark/dom-bench/testing-worker.test.js"]],
    ["host-io-selftest", ["run", "bench:bun-io:selftest"]],
  ]) {
    const image = join(root, "build/mad-dom.node");
    const result = recordedCommand(join(import.meta.dir, "commands/additional"), `${lane}-${label}`, [runtime.path, ...args], root, {
      MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
      PATH: `${dirname(runtime.path)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1", CARGO_TARGET_DIR: join(root, "target"),
    });
    if (result.exitCode !== 0 || result.signal || result.error) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
