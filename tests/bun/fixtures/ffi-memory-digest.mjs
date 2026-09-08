// Child-process FFI memory digest (todo 04). Runs a bounded Window/DOM churn
// that drives the FFI facade hot paths (createElement token batch, query,
// serialize, child snapshot) and reports the *deterministic* native lifecycle
// counters around it: live documents, FFI owner registrations and live weak
// wrapper-cache entries must all return to their pre-churn baseline after
// explicit destroy plus GC. RSS/heap deltas are corroborating evidence only —
// the counters are the leak proof.
//
// Runs as a child process under a forced loader state (FFI-enabled or
// FFI-disabled), printing `MEMORY {json}` on stdout. `ffiMethods` is the
// path-hit proof that the enabled run really exercised the FFI channel, and
// `finalizerTiming` records whether an abandoned document was released
// synchronously by `Bun.gc(true)` or only after the macrotask drain (a
// capability-matrix data point, not an assertion).

import {
  Window,
  createDocument,
  ffiRegistrationCount,
  isNativeAvailable,
  liveDocumentCount,
  liveWrapperCacheEntries,
} from "../../../index.js";
import { nodeDocumentStateOf } from "../../../js/facade/extensions/classes.js";

function mountedFfiMethods(wrapper) {
  const adapter = nodeDocumentStateOf(wrapper)?.ffi;
  if (adapter === null || adapter === undefined) return [];
  return [
    "querySnapshot",
    "preorderSnapshot",
    "childSnapshot",
    "serialize",
    "createElements",
    "readBatch",
  ].filter((name) => adapter[name] !== undefined);
}

function sample() {
  return {
    docs: liveDocumentCount(),
    ffiRegistrations: ffiRegistrationCount(),
    wrapperCacheEntries: liveWrapperCacheEntries(),
  };
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
  Bun.gc(true);
  await drainEventLoop();
}

async function observeFinalizerTiming() {
  const before = liveDocumentCount();
  // Frame isolation: the document and its element wrappers must die with the
  // helper frame so no conservative stack/register copy keeps them alive.
  const spawn = () => {
    const doc = createDocument();
    doc.createElement("div");
  };
  spawn();
  Bun.gc(true);
  const afterSyncGc = liveDocumentCount();
  await drainEventLoop();
  const afterDrain = liveDocumentCount();
  return {
    timing:
      afterSyncGc === before ? "synchronous" : afterDrain === before ? "deferred" : "retained",
    baseline: before,
    afterSyncGc,
    afterDrain,
  };
}

function churnOne(win) {
  const { document } = win;
  const body = document.body;
  for (let i = 0; i < 24; i++) {
    const span = document.createElement("span");
    span.textContent = `s${i}`;
    body.append(span);
  }
  const ul = document.createElement("ul");
  body.append(ul);
  for (let i = 0; i < 16; i++) {
    const li = document.createElement("li");
    li.className = i % 2 === 0 ? "even" : "odd";
    li.textContent = `li${i}`;
    ul.append(li);
  }
  // Hot paths: query snapshot, child snapshot, serialize, read batch.
  void ul.querySelectorAll("li.even").length;
  void ul.childNodes.length;
  void ul.innerHTML;
  void ul.outerHTML;
  void Array.from(body.children).map((node) => node.textContent);
  // Detached wrapper churn (mints + collects wrappers, exercising the weak
  // wrapper cache eviction path).
  for (let i = 0; i < 16; i++) {
    const orphan = document.createElement("section");
    document.body.append(orphan);
    orphan.remove();
  }
}

export async function memoryDigest() {
  if (!isNativeAvailable()) return { status: "no-native", bunVersion: Bun.version };

  const holder = new Window();
  const ffiMethods = mountedFfiMethods(holder.document.body);

  await collectGarbage();
  const before = sample();
  const heapBefore = process.memoryUsage().heapUsed;
  const rssBefore = process.memoryUsage().rss;

  const windows = [];
  for (let i = 0; i < 30; i++) {
    const win = new Window();
    churnOne(win);
    win.destroy();
    windows.push(win);
  }
  windows.length = 0;
  await collectGarbage();

  const after = sample();
  const heapAfter = process.memoryUsage().heapUsed;
  const rssAfter = process.memoryUsage().rss;

  const timing = await observeFinalizerTiming();

  holder.destroy();
  await collectGarbage();

  return {
    status: "ok",
    bunVersion: Bun.version,
    ffiMethods,
    counters: {
      baseline: before,
      after,
      deltas: {
        docs: after.docs - before.docs,
        ffiRegistrations: after.ffiRegistrations - before.ffiRegistrations,
        wrapperCacheEntries: after.wrapperCacheEntries - before.wrapperCacheEntries,
      },
    },
    heapGrowthMb: (heapAfter - heapBefore) / (1024 * 1024),
    rssGrowthMb: (rssAfter - rssBefore) / (1024 * 1024),
    finalizerTiming: timing,
  };
}

if (import.meta.main) {
  const report = await memoryDigest();
  console.log("MEMORY " + JSON.stringify(report));
}
