// Keep the complete outer driver's output, including prerequisite failures.
// Invoke once through the ordinary activity.py sampling gate.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";

const root = resolve(import.meta.dir, "../../../..");
const directory = join(import.meta.dir, "commands/null-control-launch");
assert.equal(existsSync(join(directory, "commands.json")), false, "retain previous control launches");
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
const runtime = runtimes.latest;
const image = join(root, "build/mad-dom.node");
assert.equal(process.execPath, runtime.path);
const record = recordedCommand(directory, "latest-v0-source-off-control-driver",
  [runtime.path, join(import.meta.dir, "null-control.mjs")], root, {
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "1",
    PATH: `${dirname(runtime.path)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1",
    CARGO_TARGET_DIR: join(root, "target"),
  });
process.exitCode = record.exitCode === 0 && !record.signal && !record.error ? 0 : 1;
