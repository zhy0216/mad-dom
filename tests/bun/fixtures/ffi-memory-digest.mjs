// Task 04: repeated, isolated DOM/FFI churn. Lifecycle counters cover ownership
// objects and cache entries, not arbitrary native malloc bytes. Per-round heap
// and RSS samples corroborate those counts; Rust tests cover retained capacity.
import assert from "node:assert/strict";
import { noInline } from "bun:jsc";
import { Window, createDocument, isNativeAvailable, liveDocumentCount } from "../../../index.js";
import { nodeDocumentStateOf } from "../../../js/facade/extensions/classes.js";

export const FFI_METHODS = ["querySnapshot", "preorderSnapshot", "childSnapshot", "serialize", "createElements", "readBatch"];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
export async function collectGarbage() {
  for (let i = 0; i < 3; i++) {
    // GC gets its own shallow timer activation, away from stale native-call
    // spill slots on an async/JIT sampling stack; then drain N-API finalizers.
    await new Promise((resolve) => setTimeout(() => { Bun.gc(true); setTimeout(resolve, 0); }, 0));
  }
}

async function observeFinalizerTiming() {
  await collectGarbage();
  const before = liveDocumentCount();
  function abandon() {
    const doc = createDocument();
    doc.ffiContext();
    doc.createElement("div");
  }
  abandon();
  const afterCreate = liveDocumentCount();
  assert.equal(afterCreate, before + 1);
  Bun.gc(true);
  const afterSyncGc = liveDocumentCount();
  await tick();
  const afterDrain = liveDocumentCount();
  await collectGarbage();
  assert.equal(liveDocumentCount(), before);
  return {
    timing: afterSyncGc === before ? "synchronous" : afterDrain === before ? "deferred" : "later-gc",
    baseline: before, afterCreate, afterSyncGc, afterDrain,
  };
}

function churnOne() {
  const win = new Window();
  try {
    const { document } = win;
    document.body.innerHTML = '<ul id="list"><li class="even">one</li><li>two</li></ul>';
    const ul = document.querySelector("#list");
    for (let i = 0; i < 40; i++) {
      const li = document.createElement("li");
      li.className = i % 2 ? "odd" : "even";
      li.textContent = `li${i}`;
      ul.append(li);
    }
    assert.equal(ul.querySelectorAll("li.even").length, 21);
    assert.equal(ul.childNodes.length, 42);
    assert.ok(ul.innerHTML.includes("li39"));
    assert.ok(ul.outerHTML.startsWith("<ul"));
    const first = ul.firstChild;
    assert.equal(first, ul.childNodes.item(0));
    const state = nodeDocumentStateOf(ul);
    // Exercise every mounted FFI operation explicitly as well as the facade
    // workload above. Count calls, not just method availability.
    const { ffi, ffiContext, documentHandle } = state;
    if (ffi) {
      const root = ffiContext[2];
      const snapshot = ffi.querySnapshot(ffiContext, root, "li");
      assert.equal(snapshot.length, 85);
      assert.ok(ffi.preorderSnapshot(ffiContext, root).length > 85);
      assert.ok(ffi.childSnapshot(ffiContext, root).length > 1);
      assert.ok(ffi.serialize(ffiContext, root).length > 0);
      const batch = ffi.createElements(ffiContext, "section", 16);
      assert.equal(batch.length, 16);
      assert.equal(ffi.readBatch(ffiContext, batch, 1).length, 64);
      const node = documentHandle.materializeNodeToken(batch[0]);
      assert.equal(documentHandle.materializeNodeToken(batch[0]), node);
    }
    for (let i = 0; i < 16; i++) {
      const orphan = document.createElement("section");
      document.body.append(orphan);
      orphan.remove();
    }
  } finally { win.destroy(); }
}

// Keep DOM handles out of the sampling frame even after JIT warmup. This is
// a diagnostic harness control, never part of production lifecycle code.
noInline(churnOne);

// End the churn activation before GC. JSC may inline the synchronous workload
// into a long-lived async frame and conservatively retain its last wrapper.
function churnRound(count) {
  return new Promise((resolve, reject) => setTimeout(() => {
    try {
      for (let i = 0; i < count; i++) churnOne();
      resolve();
    } catch (error) { reject(error); }
  }, 0));
}

export async function memoryDigest({ rounds = 8, windowsPerRound = 30 } = {}) {
  assert.ok(isNativeAvailable(), "memory digest needs the local native artifact");
  const diagnostics = createDocument();
  diagnostics.destroy(); // observer has no Core document, FFI owner or wrappers
  function sample() {
    const [docs, ffiRegistrations, wrapperCacheEntries] = diagnostics.memoryDiagnostics();
    return { docs, ffiRegistrations, wrapperCacheEntries };
  }
  await collectGarbage();
  // Capture the ownership baseline before creating the probe Window or warming
  // the workload. A still-pending warmup finalizer is not a baseline owner: it
  // can disappear in a later round and make an equal-count assertion invalid.
  const before = sample();
  let adapter;
  function findAdapter() {
    const holder = new Window();
    try { return nodeDocumentStateOf(holder.document.body)?.ffi; }
    finally { holder.destroy(); }
  }
  adapter = findAdapter();
  const ffiMethods = FFI_METHODS.filter((name) => typeof adapter?.[name] === "function");
  const calls = Object.fromEntries(ffiMethods.map((name) => [name, 0]));
  const originals = {};
  for (const name of ffiMethods) {
    originals[name] = adapter[name];
    adapter[name] = (...args) => { calls[name]++; return originals[name](...args); };
  }
  try {
    await churnRound(10);
    await collectGarbage();
    const memoryBefore = process.memoryUsage();
    const samples = [];
    for (let round = 0; round < rounds; round++) {
      await churnRound(windowsPerRound);
      // Core documents and wrapper maps must release immediately, with no GC.
      assert.equal(sample().docs, before.docs);
      assert.equal(sample().wrapperCacheEntries, before.wrapperCacheEntries);
      await collectGarbage();
      let counters = sample();
      let extraGcRounds = 0;
      while (Object.keys(before).some((key) => counters[key] !== before[key]) && extraGcRounds < 20) {
        extraGcRounds++;
        await collectGarbage();
        counters = sample();
      }
      assert.deepEqual(counters, before, `lifecycle drift in round ${round}`);
      samples.push({ round, extraGcRounds, counters, ...process.memoryUsage() });
    }
    const after = sample();
    const memoryAfter = process.memoryUsage();
    const timing = await observeFinalizerTiming();
    assert.deepEqual(sample(), before, "abandoned FFI owners must drain too");
    const deltas = Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]));
    return {
      status: "ok", bunVersion: Bun.version, bunRevision: Bun.revision,
      platform: process.platform, arch: process.arch,
      ffiMethods, ffiCalls: calls, rounds, windowsPerRound,
      counterScopes: { docs: "process", ffiRegistrations: "calling-thread", wrapperCacheEntries: "process" },
      counters: { baseline: before, after, deltas }, samples,
      heapGrowthMb: (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1048576,
      rssGrowthMb: (memoryAfter.rss - memoryBefore.rss) / 1048576,
      finalizerTiming: timing,
    };
  } finally {
    for (const name of ffiMethods) adapter[name] = originals[name];
  }
}

if (import.meta.main) {
  function option(flag, fallback) {
    const index = process.argv.indexOf(flag);
    const value = index < 0 ? fallback : Number(process.argv[index + 1]);
    assert.ok(Number.isSafeInteger(value) && value > 0 && value <= 1000, `invalid ${flag}`);
    return value;
  }
  console.log("MEMORY " + JSON.stringify(await memoryDigest({
    rounds: option("--rounds", 8), windowsPerRound: option("--windows-per-round", 30),
  })));
}
