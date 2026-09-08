#!/usr/bin/env bun
// Task 04: actual native callback spike, isolated from the production ABI.
// Run under process.execPath on each runtime; requires cc and the local .node.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlopen, toArrayBuffer } from "bun:ffi";
import { createDocument } from "../index.js";
import { ffiForDocument } from "../js/native-loader.js";

const temp = mkdtempSync(join(tmpdir(), "mad-dom-task04-spike-"));
const source = new URL("../tests/bun/fixtures/ffi-memory-spike.c", import.meta.url).pathname;
const path = join(temp, process.platform === "darwin" ? "spike.dylib" : "spike.so");
const compile = Bun.spawnSync([
  "cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC",
  process.platform === "darwin" ? "-dynamiclib" : "-shared", source, "-o", path,
  "-pthread", ...(process.platform === "darwin" ? [] : ["-ldl"]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(compile.exitCode, 0, `native spike build failed: ${compile.stderr}`);
const u32 = (args) => ({ args, returns: "u32" });
// This handle stays live until every external view has been collected. It must
// never be closed while Bun might still call a deallocator in this image.
const library = dlopen(path, {
  spike_allocate: u32(["u32", "u32", "u32", "u32", "u32"]),
  spike_bytes: { args: ["u32"], returns: "ptr" },
  spike_context: { args: ["u32"], returns: "ptr" },
  spike_released: u32(["u32"]),
  spike_callbacks: u32(["u32"]),
  spike_callback_offset: u32(["u32"]),
  spike_validate: u32(["u32", "u32", "u32", "u32", "u32"]),
  spike_destroy: { args: ["u32"], returns: "void" },
  spike_deallocator: { args: ["u32"], returns: "ptr" },
  spike_repeat_release: { args: ["u32"], returns: "void" },
  spike_metric: u32(["u32"]),
  spike_jsc_symbol: u32(["cstring"]),
});
const s = library.symbols;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function gc() { Bun.gc(true); await tick(); }
function metrics() {
  return Object.fromEntries([
    "allocations", "frees", "callbacks", "duplicateReleasesSuppressed",
    "invalidCallbacks", "liveBytes", "foreignThreadCallbacks",
  ].map((name, field) => [name, s.spike_metric(field)]));
}
async function waitForRelease(id) {
  for (let i = 0; i < 20 && !s.spike_released(id); i++) await gc();
  assert.equal(s.spike_released(id), 1, `lease ${id} was not released`);
  assert.equal(s.spike_callbacks(id), 1, `lease ${id} callback count`);
}

function prepareLease(withoutContext, offset) {
  const doc = createDocument();
  const bound = ffiForDocument(doc);
  assert.ok(bound, "spike requires the real, same-image FFI channel");
  const [owner, generation, root] = bound.context;
  const length = 32, capacity = 64;
  const id = s.spike_allocate(owner, generation, length, capacity, offset);
  assert.notEqual(id, 0);
  assert.equal(s.spike_validate(id, owner, generation, length, capacity), 0);
  assert.equal(s.spike_validate(id, owner + 1, generation, length, capacity), 3);
  assert.equal(s.spike_validate(id, owner, generation + 1, length, capacity), 4);
  assert.equal(s.spike_validate(id, owner, generation, capacity + 1, capacity), 1);
  assert.equal(s.spike_validate(id, owner, generation, length, capacity + 1), 1);
  // Keep only a TypedArray alias; it must retain the backing ArrayBuffer.
  function view() {
    const bytes = s.spike_bytes(id);
    const callback = s.spike_deallocator(Number(withoutContext));
    return new Uint8Array(withoutContext
      ? toArrayBuffer(bytes, offset, length, callback)
      : toArrayBuffer(bytes, offset, length, s.spike_context(id), callback));
  }
  const held = [view()];
  const weak = new WeakRef(held[0].buffer);
  const flags = { finalized: false };
  const registry = new FinalizationRegistry(() => { flags.finalized = true; });
  registry.register(held[0].buffer, id);
  return { doc, bound, owner, generation, root, length, capacity, id, held, weak, flags, registry };
}

function checkRetained(state) {
  assert.equal(s.spike_released(state.id), 0, "must not free a live view");
  assert.equal(state.held[0][0], 0xa5);
  assert.equal(state.held[0].at(-1), 0xa5);
}

async function retainedLease(withoutContext, offset) {
  const state = prepareLease(withoutContext, offset);
  const { id, owner, generation, root, length, capacity } = state;
  await gc();
  checkRetained(state);
  state.doc.destroy();
  state.doc.destroy();
  s.spike_destroy(id);
  assert.equal(s.spike_validate(id, owner, generation, length, capacity), 5);
  assert.throws(() => state.bound.adapter.serialize(state.bound.context, root), /DOCUMENT_DESTROYED/);
  await gc();
  checkRetained(state);
  state.held[0] = null;
  Bun.gc(true);
  const syncReleased = s.spike_released(id);
  await tick();
  const afterMacrotask = s.spike_released(id);
  await waitForRelease(id);
  for (let i = 0; i < 10 && !state.flags.finalized; i++) await gc();
  assert.equal(state.weak.deref(), undefined);
  assert.ok(state.flags.finalized);
  await gc();
  assert.equal(s.spike_callbacks(id), 1, "further GC must not repeat the callback");
  s.spike_repeat_release(id);
  assert.equal(s.spike_released(id), 1);
  return {
    overload: withoutContext ? "callback-fourth-argument" : "context-and-callback",
    owner, generation, length, capacity, offset,
    syncReleased, afterMacrotask, callbacks: s.spike_callbacks(id),
    callbackOffset: s.spike_callback_offset(id), finalizationRegistry: state.flags.finalized,
    retainedAcrossGcAndDestroy: true, staleGenerationRejected: true,
  };
}

async function churn() {
  function batch() {
    const ids = [];
    for (let i = 0; i < 32; i++) {
      const id = s.spike_allocate(1, 1, 16384, 16384, 0);
      assert.notEqual(id, 0);
      const buffer = toArrayBuffer(s.spike_bytes(id), 0, 16384, s.spike_context(id), s.spike_deallocator(0));
      assert.equal(new Uint8Array(buffer)[16383], 0xa5);
      ids.push(id);
    }
    return ids;
  }
  const samples = [];
  for (let round = 0; round < 8; round++) {
    const ids = batch();
    for (const id of ids) await waitForRelease(id);
    samples.push({ round, ...metrics(), ...process.memoryUsage() });
    assert.equal(samples.at(-1).liveBytes, 0);
    assert.equal(samples.at(-1).allocations, samples.at(-1).frees);
  }
  return samples;
}

try {
  const overloads = [await retainedLease(false, 8), await retainedLease(true, 0)];
  const samples = await churn();
  const jsc = await import("bun:jsc");
  const symbols = Object.fromEntries([
    "JSObjectMakeArrayBufferWithBytesNoCopy", "JSObjectMake", "JSGlobalContextCreate",
  ].map((name) => [name, Boolean(s.spike_jsc_symbol(name))]));
  const final = metrics();
  assert.equal(final.allocations, final.frees);
  assert.equal(final.callbacks, final.allocations);
  assert.equal(final.invalidCallbacks, 0);
  assert.equal(final.duplicateReleasesSuppressed, 2);
  console.log(JSON.stringify({
    schema: "mad-dom/ffi-memory-spike/1", bunVersion: Bun.version, bunRevision: Bun.revision,
    platform: process.platform, arch: process.arch,
    externalArrayBuffer: { status: "verified", productionEnabled: false, overloads, samples, final },
    jscPrivateApi: {
      status: "discovery-only", defaultPath: false, exportedSymbols: symbols,
      publicModuleExports: Object.keys(jsc).sort(),
      reason: "No public Bun API supplies its live JSContextRef for custom DOM wrappers; symbol visibility alone cannot establish VM, rooting, affinity, or finalizer ownership.",
    },
  }, null, 2));
  // Keep the callback image mapped until process exit, including a callback
  // that has incremented its counter but has not yet returned on a GC thread.
  assert.ok(library.symbols);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
