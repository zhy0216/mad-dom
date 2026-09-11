// Process isolation keeps unrelated suites' deferred finalizers from changing
// the process-global wrapper-cache baseline while we test the late-finalizer
// window (see gc.test.js "reads in the collected-but-not-yet-finalized window").
import assert from "node:assert/strict";
import { createDocument } from "../../../index.js";

const diagnostics = createDocument();
diagnostics.destroy();
assert.deepEqual(diagnostics.memoryDiagnostics(), [0, 0, 0]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function collect() {
  for (let i = 0; i < 4; i++) {
    Bun.gc(true);
    await tick();
  }
}

const doc = createDocument();
let parent = null;
let wr = null;
function spawn() {
  const p = doc.createElement("ul");
  const child = doc.createElement("li");
  doc.appendChild(p, child);
  assert.strictEqual(p.firstChild(), child); // caches the child wrapper
  parent = p;
  wr = new WeakRef(child);
}
spawn();

// Collect WITHOUT draining: the wrapper is collected but its finalizer has
// not run yet, so the cache entry is stale.
Bun.gc(true);
assert.equal(wr.deref(), undefined);

const fresh = parent.firstChild();
assert.notEqual(fresh, undefined);
assert.equal(fresh.nodeName(), "li");
assert.strictEqual(parent.firstChild(), fresh);

const entries = diagnostics.memoryDiagnostics()[2];
Bun.gc(true);
await tick();
// A late finalizer for the old mint must neither evict nor decrement the
// replacement entry: identity and the cache count survive the drain.
assert.strictEqual(parent.firstChild(), fresh);
assert.equal(diagnostics.memoryDiagnostics()[2], entries);

doc.destroy();
await collect();
const released = diagnostics.memoryDiagnostics();
assert.deepEqual(released, [0, 0, 0]);

console.log(JSON.stringify({ bunVersion: Bun.version, entries }));
