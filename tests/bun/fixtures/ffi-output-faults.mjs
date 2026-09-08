// Isolated native fault injection: bad length/status reports, no bad writes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlopen } from "bun:ffi";
const temp = mkdtempSync(join(tmpdir(), "mad-dom-task04-faults-"));
const path = join(temp, process.platform === "darwin" ? "faults.dylib" : "faults.so");
const compile = Bun.spawnSync([
  "cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC",
  process.platform === "darwin" ? "-dynamiclib" : "-shared",
  join(import.meta.dir, "ffi-memory-spike.c"), "-o", path,
  "-pthread", ...(process.platform === "darwin" ? [] : ["-ldl"]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(compile.exitCode, 0, compile.stderr.toString());
process.env.MAD_DOM_FFI_PATH = path;
const library = dlopen(path, {
  spike_set_fault: { args: ["u32"], returns: "void" },
  spike_fault_calls: { args: [], returns: "u32" },
});
const { loadNativeFfi } = await import("../../../js/native-loader.js");
// Test the raw adapter directly. ffiForDocument correctly refuses this image
// for real documents because it does not own the Node-API document registry.
const adapter = loadNativeFfi().adapter;
try {
  assert.ok(adapter?.createElements && adapter?.serialize);
  const context = [1, 1, 0];
  for (const mode of [0, 1]) {
    library.symbols.spike_set_fault(mode);
    assert.throws(() => adapter.createElements(context, "div", 3), /invalid output length/);
    assert.equal(library.symbols.spike_fault_calls(), 1);
  }
  for (const mode of [2, 3, 4]) {
    library.symbols.spike_set_fault(mode);
    assert.equal(adapter.serialize(context, 0), undefined);
    assert.equal(library.symbols.spike_fault_calls(), 1);
  }
  library.symbols.spike_set_fault(5);
  assert.equal(adapter.createElements(context, "div", 3000).length, 3000);
  assert.equal(library.symbols.spike_fault_calls(), 1);
  console.log(JSON.stringify({ bunVersion: Bun.version, passed: true }));
} finally { rmSync(temp, { recursive: true, force: true }); }
