import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  Window,
  createDocument,
  ffiRegistrationCount,
  liveDocumentCount,
  liveWrapperCacheEntries,
} from "../../index.js";
import { nodeDocumentStateOf } from "../../js/facade/extensions/classes.js";

// Todo 04 memory/GC protocol. These tests prove, with *deterministic* native
// lifecycle counters (live documents, FFI owner registrations, live weak
// wrapper-cache entries) rather than RSS noise, that a bounded DOM/FFI churn
// releases every native allocation: the counters must return exactly to their
// baseline after explicit destroy plus GC, on both the FFI-enabled and the
// FFI-disabled channel. RSS/heap deltas are reported but only as corroborating
// evidence. The digest runs in child processes because the loader caches its
// FFI state per process (FFI-enabled vs FFI-disabled cannot share one).
//
// Children run through `process.execPath`, so a baseline-Bun parent launches a
// baseline-Bun child (not a newer `bun` on PATH); the fixture echoes its own
// `Bun.version` and the digest asserts it equals the parent's.

const MEMORY_DIGEST = resolve(import.meta.dir, "fixtures", "ffi-memory-digest.mjs");
const ARTIFACT = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const hasArtifact = existsSync(ARTIFACT);

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
  Bun.gc(true);
  await drainEventLoop();
}

function runMemoryDigest(extraEnv = {}) {
  const proc = Bun.spawnSync([process.execPath, MEMORY_DIGEST], {
    env: {
      ...process.env,
      MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node"),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${proc.stdout}\n${proc.stderr}`);
  const json = proc.stdout.toString().match(/^MEMORY (\{.*\})$/m)?.[1];
  if (json === undefined) throw new Error(`no memory digest produced: ${proc.stdout}\n${proc.stderr}`);
  const parsed = JSON.parse(json);
  expect(parsed.bunVersion).toBe(Bun.version);
  return parsed;
}

const FULL_FFI_METHODS = [
  "querySnapshot",
  "preorderSnapshot",
  "childSnapshot",
  "serialize",
  "createElements",
  "readBatch",
];

describe("Bun FFI memory and GC protocol", () => {
  test("bounded churn returns every native lifecycle counter to baseline (FFI-enabled)", () => {
    if (!hasArtifact) return;
    const digest = runMemoryDigest({});
    expect(digest.status).toBe("ok");
    // Path-hit proof: the enabled run really mounted (and exercised) FFI.
    expect([...digest.ffiMethods].sort()).toEqual([...FULL_FFI_METHODS].sort());
    expect(digest.counters.deltas).toEqual({ docs: 0, ffiRegistrations: 0, wrapperCacheEntries: 0 });
    expect(digest.finalizerTiming.timing).not.toBe("retained");
    // Corroborating bound: RSS/heap must not grow without limit. The counters
    // above are the deterministic proof; this is a coarse smoke ceiling.
    expect(digest.rssGrowthMb).toBeLessThan(128);
    expect(digest.heapGrowthMb).toBeLessThan(128);
  });

  test("the same churn returns the same counters to baseline on the Node-API channel", () => {
    if (!hasArtifact) return;
    const digest = runMemoryDigest({ MAD_DOM_FFI_DISABLED: "1" });
    expect(digest.status).toBe("ok");
    expect(digest.ffiMethods).toEqual([]);
    expect(digest.counters.deltas).toEqual({ docs: 0, ffiRegistrations: 0, wrapperCacheEntries: 0 });
    expect(digest.finalizerTiming.timing).not.toBe("retained");
    expect(digest.rssGrowthMb).toBeLessThan(128);
  });

  test("explicit destroy releases documents without any GC, and counters drain after collect", async () => {
    if (!hasArtifact) return;
    await collectGarbage();
    const docsBefore = liveDocumentCount();
    const ffiBefore = ffiRegistrationCount();

    // The deterministic free path: destroy() drops the Core document
    // immediately. No Bun.gc(), no finalizer wait, no event-loop turn.
    const frame = () => {
      const doc = createDocument();
      doc.createElement("div");
      doc.destroy();
    };
    frame();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(ffiRegistrationCount()).toBe(ffiBefore);

    // An abandoned (never destroyed) document is released by GC + macrotask,
    // proving the deferred napi finalizer path reclaims the FFI registration.
    const abandon = () => {
      const doc = createDocument();
      doc.createElement("span");
      return new WeakRef(doc);
    };
    const wr = abandon();
    Bun.gc(true);
    expect(wr.deref()).toBeUndefined();
    await collectGarbage();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(ffiRegistrationCount()).toBe(ffiBefore);
  });
});

// Loader-level protocol checks run in-process with a single Window so the
// global counters stay readable and deterministic (this file owns its process).
describe("FFI loader output memory protocol", () => {
  test("createElements is served single-shot at any legal batch size", () => {
    if (!hasArtifact) return;
    const win = new Window();
    try {
      const { document } = win;
      const state = nodeDocumentStateOf(document.body);
      const ffi = state?.ffi;
      if (ffi?.createElements === undefined || state.ffiContext === null) return;

      // 3000 exceeds outputWords' initial 256-word capacity. Under the old
      // grow-and-retry path this was safe only because native refuses to
      // create before capacity is proven; the loader now sizes the single-shot
      // buffer to exactly `count` words so a mutating C entry is never invoked
      // twice. The observable contract is a correct, complete batch.
      const batch = ffi.createElements(state.ffiContext, "slot", 3000);
      expect(batch).toBeInstanceOf(Uint32Array);
      expect(batch.length).toBe(3000);
      const set = new Set(batch);
      expect(set.size).toBe(3000);
      expect(Math.max(...batch)).toBe(Math.min(...batch) + 2999);

      // The next (smaller) batch continues the process-unique token stream
      // without overlap: no hidden duplicate allocation was registered.
      const next = ffi.createElements(state.ffiContext, "slot", 4);
      expect(next.length).toBe(4);
      for (const token of next) expect(set.has(token)).toBe(false);

      // The rest of the hot path still works after the oversized batch.
      const marker = document.createElement("div");
      marker.id = "marker";
      document.body.append(marker);
      expect(document.querySelector("#marker")).toBe(marker);
    } finally {
      win.destroy();
    }
  });

  test("destroyed-document FFI calls surface the frozen error, not a crash", () => {
    if (!hasArtifact) return;
    const win = new Window();
    const { document } = win;
    const state = nodeDocumentStateOf(document.body);
    const ffi = state?.ffi;
    if (ffi?.querySnapshot === undefined || state.ffiContext === null) {
      win.destroy();
      return;
    }
    const context = state.ffiContext;
    win.destroy();
    expect(() => ffi.querySnapshot(context, 0, "div")).toThrowError(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
    expect(() => ffi.createElements(context, "div", 8)).toThrowError(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
    expect(() => ffi.serialize(context, 0, 0)).toThrowError(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });
});
