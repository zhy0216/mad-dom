// Behavior-only probe of the frozen v1. Run through the build-test gate.
// This records real calls and outcomes; it contains no timing or route override.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileIdentity } from "../../../../benchmark/bun-performance/provenance.mjs";

const root = resolve(import.meta.dir, "../../../..");
const archived = JSON.parse(readFileSync(join(import.meta.dir, "candidate-v1-source.json")));
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "../baseline/reference-manifest.json")));
const lane = Object.keys(runtimes).find(name => runtimes[name].path === process.execPath);
assert.ok(lane, "use one of the two declared Bun executables");
const runtime = runtimes[lane];
const executableIdentity = fileIdentity(process.execPath);
const nativeIdentity = fileIdentity(join(root, "build/mad-dom.node"));
assert.equal(Bun.version, runtime.version);
assert.equal(Bun.revision, runtime.revision);
assert.equal(executableIdentity.sha256, runtime.sha256);
assert.equal(runtime.sha256, frozen.runtimes[lane].sha256);
assert.equal(runtime.revision, frozen.runtimes[lane].revision);
assert.equal(nativeIdentity.sha256, frozen.artifact.sha256);
assert.ok(nativeIdentity.dev !== frozen.artifact.dev || nativeIdentity.inode !== frozen.artifact.inode,
  "the probe must use this worktree's independent native image");
for (const [path, saved] of Object.entries(archived.files)) {
  assert.equal(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), saved.sha256,
    "this pre-change probe must run against the archived v1 bytes");
}

const { Window } = await import("../../../../index.js");
const { loadNative, ffiCapabilityReport, nativeLoadPath } = await import("../../../../js/native-loader.js");
const { Element, DocumentFragment, nodeHandleOf, nodeInternalsOf, hasMaterializedNodeHandle } =
  await import("../../../../js/facade/extensions/classes.js");
const native = loadNative();
assert.equal(nativeLoadPath(), join(root, "build/mad-dom.node"));
assert.equal(process.env.MAD_DOM_NATIVE_PATH, process.env.MAD_DOM_FFI_PATH);
const calls = [];
let active;
const restores = [];
function trace(object, name, channel) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  assert.equal(typeof descriptor?.value, "function", `missing real ${channel}.${name}`);
  Object.defineProperty(object, name, { ...descriptor, value(...args) {
    if (active !== undefined) calls.push({ phase: active, call: `${channel}.${name}` });
    return Reflect.apply(descriptor.value, this, args);
  } });
  restores.push(() => Object.defineProperty(object, name, descriptor));
}
trace(native.DocumentHandle.prototype, "materializeNodeToken", "NodeAPI");
trace(native.NodeHandle.prototype, "innerHTML", "NodeAPI");
trace(native.NodeHandle.prototype, "outerHTML", "NodeAPI");

const win = new Window();
const observations = [];
function outcome(operation) {
  try { return { value: operation() }; }
  catch (error) { return { error: { name: error?.name, code: error?.code ?? null, message: error?.message } }; }
}
function phase(name, wrapper, operation) {
  const before = hasMaterializedNodeHandle(wrapper);
  active = name;
  let result;
  try { result = outcome(operation); }
  finally { active = undefined; }
  const row = { name, kind: nodeInternalsOf(wrapper)?.nodeType, before,
    after: hasMaterializedNodeHandle(wrapper), ...result };
  observations.push(row);
  return row;
}
try {
  const { document } = win;
  const body = document.body;
  const state = nodeInternalsOf(body).documentState;
  assert.equal(typeof state.ffi?.serialize, process.env.MAD_DOM_FFI_DISABLED === "1" ? "undefined" : "function");
  if (state.ffi?.serialize) trace(state.ffi, "serialize", "adapter");
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML").get;
  const outer = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML").get;
  const fragmentInner = Object.getOwnPropertyDescriptor(DocumentFragment.prototype, "innerHTML").get;
  let publicKindReads = 0;
  function exercise(name, wrapper) {
    Object.defineProperty(wrapper, "nodeType", { configurable: true, get() {
      publicKindReads++;
      throw new Error("public nodeType must not decide HTML selection");
    } });
    phase(`${name}.before.inner`, wrapper, () => inner.call(wrapper));
    phase(`${name}.before.outer`, wrapper, () => outer.call(wrapper));
    phase(`${name}.materialize`, wrapper, () => { nodeHandleOf(wrapper); return "materialized"; });
    phase(`${name}.after.inner`, wrapper, () => inner.call(wrapper));
    phase(`${name}.after.outer`, wrapper, () => outer.call(wrapper));
    phase(`${name}.native.inner`, wrapper, () => nodeHandleOf(wrapper).innerHTML());
    phase(`${name}.native.outer`, wrapper, () => nodeHandleOf(wrapper).outerHTML());
  }
  body.innerHTML = "<div>你好 café 🦀 &amp; &lt;</div><div>\uFEFFleading mark</div><div></div>";
  const elements = body.querySelectorAll("div");
  for (let i = 0; i < elements.length; i++) exercise(`element${i}`, elements[i]);
  exercise("text", document.createTextNode("你好 < &"));
  exercise("comment", document.createComment("comment"));
  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode("\uFEFFfragment"));
  phase("fragment.inner", fragment, () => fragmentInner.call(fragment));
  phase("fragment.native.inner", fragment, () => nodeHandleOf(fragment).innerHTML());
  exercise("fragment.borrowed", fragment);
  const destroyedLazy = document.createElement("span");
  const destroyedMaterialized = document.createElement("span");
  nodeHandleOf(destroyedMaterialized);
  win.destroy();
  for (const [name, wrapper] of [["destroyedLazy", destroyedLazy], ["destroyedMaterialized", destroyedMaterialized]]) {
    phase(`${name}.inner`, wrapper, () => inner.call(wrapper));
    phase(`${name}.outer`, wrapper, () => outer.call(wrapper));
  }
  assert.equal(publicKindReads, 0);
  console.log(JSON.stringify({ schema: "mad-dom-task03-html-state-probe/1", bun: Bun.version,
    bunRevision: Bun.revision, executable: process.execPath, executableSha256: executableIdentity.sha256,
    nativePath: nativeLoadPath(), nativeSha256: nativeIdentity.sha256,
    executableIdentity, nativeIdentity, ffi: ffiCapabilityReport(),
    archiveProductionSha256: archived.productionSha256,
    publicKindReads, observations, calls }, null, 2));
} finally {
  win.destroy();
  for (const restore of restores.reverse()) restore();
}
