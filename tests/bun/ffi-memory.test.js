import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  Window,
  createDocument,
  liveDocumentCount,
} from "../../index.js";
import { nodeDocumentStateOf } from "../../js/facade/extensions/classes.js";
import { ffiForDocument } from "../../js/native-loader.js";

// Todo 04 memory/GC protocol. These tests prove, with *deterministic* native
// lifecycle counters (live documents, FFI owner registrations, live weak
// wrapper-cache entries) that a bounded DOM/FFI churn
// releases its tracked owners: the counters must return exactly to their
// baseline after explicit destroy plus GC, on both the FFI-enabled and the
// FFI-disabled channel. RSS/heap deltas are reported but only as corroborating
// evidence. The digest runs in child processes because the loader caches its
// FFI state per process (FFI-enabled vs FFI-disabled cannot share one).
//
// Children run through `process.execPath`, so a baseline-Bun parent launches a
// baseline-Bun child (not a newer `bun` on PATH); the fixture echoes its own
// `Bun.version` and the digest asserts it equals the parent's.

const MEMORY_DIGEST = resolve(import.meta.dir, "fixtures", "ffi-memory-digest.mjs");
const EXTERNAL_SPIKE = resolve(import.meta.dir, "../../scripts/probe-ffi-memory.mjs");
const ARTIFACT = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const hasArtifact = existsSync(ARTIFACT);
const diagnostics = hasArtifact ? createDocument() : null;
diagnostics?.destroy();

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
    const digest = runMemoryDigest({ MAD_DOM_FFI_DISABLED: "0" });
    expect(digest.status).toBe("ok");
    // Path-hit proof: the enabled run really mounted (and exercised) FFI.
    expect([...digest.ffiMethods].sort()).toEqual([...FULL_FFI_METHODS].sort());
    for (const method of FULL_FFI_METHODS) expect(digest.ffiCalls[method]).toBeGreaterThan(0);
    expect(digest.samples).toHaveLength(8);
    for (const sample of digest.samples) expect(sample.counters).toEqual(digest.counters.baseline);
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
    const ffiBefore = diagnostics.memoryDiagnostics()[1];

    // The deterministic free path: destroy() drops the Core document
    // immediately. No Bun.gc(), no finalizer wait, no event-loop turn.
    const frame = () => {
      const doc = createDocument();
      doc.createElement("div");
      doc.destroy();
    };
    frame();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(diagnostics.memoryDiagnostics()[1]).toBe(ffiBefore);

    // An abandoned (never destroyed) document is released by GC + macrotask,
    // proving the deferred napi finalizer path reclaims the FFI registration.
    const abandon = () => {
      const doc = createDocument();
      doc.ffiContext();
      doc.createElement("span");
      return new WeakRef(doc);
    };
    const wr = abandon();
    Bun.gc(true);
    expect(wr.deref()).toBeUndefined();
    await collectGarbage();
    expect(liveDocumentCount()).toBe(docsBefore);
    expect(diagnostics.memoryDiagnostics()[1]).toBe(ffiBefore);
  });

  test("native external ArrayBuffer callbacks honor retain/destroy/GC and release once", () => {
    if (!hasArtifact) return;
    const proc = Bun.spawnSync([process.execPath, EXTERNAL_SPIKE], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_NATIVE_PATH: ARTIFACT, MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const report = JSON.parse(proc.stdout.toString());
    expect(report.bunVersion).toBe(Bun.version);
    expect(report.externalArrayBuffer.status).toBe("verified");
    expect(report.externalArrayBuffer.productionEnabled).toBe(false);
    expect(report.externalArrayBuffer.final).toMatchObject({
      allocations: 258, frees: 258, callbacks: 258,
      duplicateReleasesSuppressed: 2, invalidCallbacks: 0, liveBytes: 0,
    });
    expect(report.jscPrivateApi.defaultPath).toBe(false);
  });
});

// Loader-level protocol checks run in-process with a single Window so the
// global counters stay readable and deterministic (this file owns its process).
describe("FFI loader output memory protocol", () => {
  test("bounded hints and length leases isolate real reentrant calls and recover after faults", () => {
    if (!hasArtifact) return;
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "fixtures/ffi-adapter-reuse.mjs")], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_NATIVE_PATH: ARTIFACT, MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ bunVersion: Bun.version, passed: true });
  });

  test("all owned adapter outputs survive alternating multi-document results and destroy", async () => {
    if (!hasArtifact) return;
    const retained = [];
    const copies = [];
    for (let i = 0; i < 24; i++) {
      const doc = createDocument();
      try {
        const { adapter: ffi, context } = ffiForDocument(doc);
        doc.parseHtml(`<section>${`<span id="m${i}">你好 🦀</span>`.repeat(i % 2 ? 1200 : 1)}</section>`);
        const query = ffi.querySnapshot(context, context[2], "span");
        const section = ffi.querySnapshot(context, context[2], "section")[1];
        const outputs = [query, ffi.serialize(context, section), ffi.childSnapshot(context, section),
          ffi.preorderSnapshot(context, section), ffi.createElements(context, "span", i % 2 ? 4096 : 0),
          ffi.readBatch(context, new Uint32Array([query[1]]), 1)];
        for (const output of outputs) {
          expect(output.buffer.byteLength).toBe(output.byteLength);
          expect(output.byteOffset).toBe(0);
          retained.push(output);
          copies.push(Array.from(output));
        }
      } finally { doc.destroy(); }
    }
    const transferred = retained.map(value => structuredClone(value, { transfer: [value.buffer] }));
    await collectGarbage();
    for (let i = 0; i < transferred.length; i++) {
      expect(retained[i].byteLength).toBe(0);
      expect(Array.from(transferred[i])).toEqual(copies[i]);
    }
  });

  test("live Worker adapters isolate owners and transferred results survive churn and destroy", async () => {
    if (!hasArtifact) return;
    const doc = createDocument();
    const { adapter: ffi, context } = ffiForDocument(doc);
    const worker = new Worker(new URL("./fixtures/ffi-retained-worker.mjs", import.meta.url), { type: "module" });
    const exchange = (data, transfer = []) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = event => reject(new Error(String(event.message)));
      worker.postMessage(data, transfer);
    });
    try {
      const result = await exchange({ action: "create", context: Array.from(context) });
      expect(result.bunVersion).toBe(Bun.version);
      expect(() => ffi.serialize(result.context, result.context[2])).toThrow(/DOCUMENT_INVALID/);
      for (let i = 0; i < 12; i++) {
        doc.parseHtml(`<div>${"m".repeat(i % 2 ? 160000 : 1)}</div>`);
        const token = ffi.querySnapshot(context, context[2], "div")[1];
        ffi.serialize(context, token);
      }
      doc.destroy();
      await collectGarbage();
      expect([Array.from(result.query), Array.from(result.bytes)]).toEqual(result.saved);
      const returned = await exchange({ action: "destroy", query: result.query, bytes: result.bytes, saved: result.saved },
        [result.query.buffer, result.bytes.buffer]);
      expect(result.query.byteLength).toBe(0);
      expect(result.bytes.byteLength).toBe(0);
      expect([Array.from(returned.query), Array.from(returned.bytes)]).toEqual(result.saved);
    } finally { await worker.terminate(); doc.destroy(); }
  });

  test("corrupt output lengths cannot cause duplicate mutations or unbounded allocation", () => {
    if (!hasArtifact) return;
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "fixtures/ffi-output-faults.mjs")], {
      env: { ...process.env, MAD_DOM_FFI_DISABLED: "0", MAD_DOM_FFI_PATH: ARTIFACT },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ bunVersion: Bun.version, passed: true });
  });

  test("createElements is served single-shot at any legal batch size", () => {
    if (!hasArtifact) return;
    const win = new Window();
    try {
      const { document } = win;
      const state = nodeDocumentStateOf(document.body);
      const ffi = state?.ffi;
      expect(typeof ffi?.createElements).toBe("function");
      expect(state.ffiContext).not.toBeNull();

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
    expect(typeof ffi?.querySnapshot).toBe("function");
    expect(state.ffiContext).not.toBeNull();
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

  test("FFI copies and Node-API token buffers survive later calls, transfer, GC and destroy", async () => {
    if (!hasArtifact) return;
    const doc = createDocument();
    const bound = ffiForDocument(doc);
    expect(bound).not.toBeNull();
    const { adapter: ffi, context } = bound;
    doc.parseHtml("<div>hello 🌍</div>");
    const packed = ffi.querySnapshot(context, context[2], "div");
    const original = Array.from(packed);
    const nativeTokens = doc.ffiContext();
    const nativeCopy = Array.from(nativeTokens);
    const bytes = ffi.serialize(context, packed[1]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe("<div>hello 🌍</div>");
    ffi.querySnapshot(context, context[2], "*");
    const transferred = structuredClone(packed, { transfer: [packed.buffer] });
    expect(packed.byteLength).toBe(0);
    doc.destroy();
    await collectGarbage();
    expect(Array.from(transferred)).toEqual(original);
    expect(Array.from(nativeTokens)).toEqual(nativeCopy);
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(() => doc.materializeNodeToken(transferred[1])).toThrow(/DOCUMENT_DESTROYED/);
    bytes[0] = 0x21;
    expect(bytes[0]).toBe(0x21); // still ordinary writable JS-owned storage
  });

  test("input lengths use the real view and mutable/detached stores are rejected", () => {
    if (!hasArtifact) return;
    const doc = createDocument();
    const { adapter: ffi, context } = ffiForDocument(doc);
    try {
      doc.parseHtml("<div></div>");
      const bytes = new TextEncoder().encode("!div!").subarray(1, 4);
      Object.defineProperty(bytes, "length", { value: 0xffffffff });
      const packed = ffi.querySnapshot(context, context[2], bytes);
      expect(packed.length).toBe(3);
      const tokens = new Uint32Array([packed[1]]);
      Object.defineProperty(tokens, "length", { value: 0xffffffff });
      expect(ffi.readBatch(context, tokens, 1).length).toBe(4);
      const detached = new Uint8Array(3);
      structuredClone(detached, { transfer: [detached.buffer] });
      for (const unsafeInput of [
        detached, new Uint8Array(new SharedArrayBuffer(3)),
        new Uint8Array(new ArrayBuffer(3, { maxByteLength: 6 })), new Uint32Array(3),
      ]) {
        expect(() => ffi.querySnapshot(context, context[2], unsafeInput)).toThrow(/INVALID_ARGUMENT/);
      }
      const first = ffi.createElements(context, "span", 1)[0];
      for (const count of [-1, 1.5, NaN, Infinity, 4097, 2 ** 32, undefined]) {
        expect(() => ffi.createElements(context, "span", count)).toThrow(/INVALID_ARGUMENT/);
      }
      expect(ffi.createElements(context, "span", 0).length).toBe(0);
      expect(ffi.createElements(context, "span", 1)[0]).toBe(first + 1);
      let coerced = false;
      expect(() => ffi.querySnapshot(context, { valueOf() { coerced = true; return context[2]; } }, bytes))
        .toThrow(/INVALID_ARGUMENT/);
      expect(coerced).toBe(false);
      const stale = Array.from(context);
      stale[1]++;
      expect(() => ffi.createElements(stale, "div", 1)).toThrow(/STALE_GENERATION/);
      expect(() => ffi.serialize(stale, context[2])).toThrow(/STALE_GENERATION/);
      const foreign = createDocument();
      try {
        expect(() => ffi.serialize(foreign.ffiContext(), packed[1])).toThrow(/INVALID_HANDLE/);
      } finally { foreign.destroy(); }
    } finally { doc.destroy(); }
  });
});
