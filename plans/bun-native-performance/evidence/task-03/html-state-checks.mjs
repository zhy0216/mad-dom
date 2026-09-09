// Append-only v1 behavior controls. Invoke once via activity.py build-test.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";

const root = resolve(import.meta.dir, "../../../..");
const directory = join(import.meta.dir, "commands/semantic");
assert.equal(existsSync(join(directory, "commands.json")), false, "retain previous behavior controls");
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
let failed = false;
for (const lane of ["baseline", "latest"]) {
  const runtime = runtimes[lane];
  for (const mode of ["on", "off"]) {
    const image = join(root, "build/mad-dom.node");
    const record = recordedCommand(directory, `${lane}-v1-html-state-${mode}`,
      [runtime.path, join(import.meta.dir, "html-state-probe.mjs")], root, {
        MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: mode === "off" ? "1" : "0",
        PATH: `${dirname(runtime.path)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1",
        CARGO_TARGET_DIR: join(root, "target"),
      });
    if (record.exitCode !== 0 || record.signal || record.error) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
