// Process isolation keeps unrelated suites' deferred finalizers from changing
// a liveDocumentCount baseline while we test one retained native wrapper.
import assert from "node:assert/strict";
import { createDocument } from "../../../index.js";

const diagnostics = createDocument();
diagnostics.destroy();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function collect() { for (let i = 0; i < 4; i++) { Bun.gc(true); await tick(); } }
let survivor = null;
let weakDocument;
function spawn() {
  const doc = createDocument();
  doc.ffiContext();
  const ul = doc.createElement("ul");
  doc.appendChild(ul, doc.createElement("li"));
  survivor = ul.firstChild();
  weakDocument = new WeakRef(doc);
}
function read(wrapper) {
  return { type: wrapper.nodeType(), name: wrapper.nodeName(), parentName: wrapper.parentNode().nodeName() };
}
const baseline = diagnostics.memoryDiagnostics();
assert.deepEqual(baseline, [0, 0, 0]);
spawn();
await collect();
assert.equal(weakDocument.deref(), undefined);
const retained = diagnostics.memoryDiagnostics();
assert.deepEqual(retained, [1, 1, 1]);
assert.deepEqual(read(survivor), { type: 1, name: "li", parentName: "ul" });
survivor = null;
await collect();
const released = diagnostics.memoryDiagnostics();
assert.deepEqual(released, baseline);
console.log(JSON.stringify({ bunVersion: Bun.version, baseline, retained, released }));
