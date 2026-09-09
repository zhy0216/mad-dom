// Todo 04 loader-level output-memory protocol, one scenario per child process.
// Each scenario below asserts behaviour of the *enabled* FFI adapter: bound
// adapters, FFI-owned output buffers and Worker transfers of that storage. The
// parent cannot assert any of that in-process, because `js/native-loader.js`
// caches its resolution per process: a parent launched under a global
// MAD_DOM_FFI_DISABLED=1 has already resolved to the Node-API channel, and
// re-resolving it would mutate the shared state of every other suite in that
// process. So the parent launches one child per scenario whose env states the
// mode explicitly (MAD_DOM_FFI_DISABLED="0"), the same contract the digest and
// reuse fixtures in this directory already use.
//
// `bunVersion` is echoed so the parent can prove the child ran the executable it
// was launched with (`process.execPath`, i.e. the pinned baseline Bun when the
// suite runs there) rather than a newer Bun found on PATH.
import assert from "node:assert/strict";
import { Window, createDocument } from "../../../index.js";
import { nodeDocumentStateOf } from "../../../js/facade/extensions/classes.js";
import { ffiForDocument, loadNativeFfi } from "../../../js/native-loader.js";

const scenario = process.argv[2];
const tick = () => new Promise((done) => setTimeout(done, 0));

async function collectGarbage() {
  Bun.gc(true);
  await tick();
  Bun.gc(true);
  await tick();
}

// A child that quietly fell back to Node-API would measure a different code path
// than the suite claims to cover, so the channel itself is a precondition.
function requireEnabledChannel() {
  const report = loadNativeFfi();
  assert.ok(
    ["available", "partial"].includes(report.status),
    `FFI must be enabled in this child, got ${JSON.stringify(report)}`,
  );
  return report;
}

function boundAdapter(doc) {
  const bound = ffiForDocument(doc);
  assert.notEqual(bound, null, "an FFI-enabled document must bind an adapter");
  return bound;
}

const scenarios = {
  // Every adapter output stays owned by JS until it is transferred: the buffer
  // length the caller sees is the buffer's real byteLength, the view starts at
  // offset 0, and after transfer the source is detached while the destination
  // still matches the pre-transfer copy.
  "owned-outputs-survive-multi-document-churn": async () => {
    const retained = [];
    const copies = [];
    for (let i = 0; i < 24; i++) {
      const doc = createDocument();
      try {
        const { adapter: ffi, context } = boundAdapter(doc);
        doc.parseHtml(`<section>${`<span id="m${i}">你好 🦀</span>`.repeat(i % 2 ? 1200 : 1)}</section>`);
        const query = ffi.querySnapshot(context, context[2], "span");
        const section = ffi.querySnapshot(context, context[2], "section")[1];
        const outputs = [query, ffi.serialize(context, section), ffi.childSnapshot(context, section),
          ffi.preorderSnapshot(context, section), ffi.createElements(context, "span", i % 2 ? 4096 : 0),
          ffi.readBatch(context, new Uint32Array([query[1]]), 1)];
        for (const output of outputs) {
          assert.equal(output.buffer.byteLength, output.byteLength);
          assert.equal(output.byteOffset, 0);
          retained.push(output);
          copies.push(Array.from(output));
        }
      } finally {
        doc.destroy();
      }
    }
    const transferred = retained.map((value) => structuredClone(value, { transfer: [value.buffer] }));
    await collectGarbage();
    for (let i = 0; i < transferred.length; i++) {
      assert.equal(retained[i].byteLength, 0);
      assert.deepEqual(Array.from(transferred[i]), copies[i]);
    }
  },

  // An adapter bound in this process is inert inside the Worker, and results
  // the Worker owns survive local churn, transfer back and GC of both sides.
  "worker-adapters-isolate-owners": async () => {
    const doc = createDocument();
    const { adapter: ffi, context } = boundAdapter(doc);
    const worker = new Worker(new URL("./ffi-retained-worker.mjs", import.meta.url), { type: "module" });
    const exchange = (data, transfer = []) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data));
      worker.onerror = (event) => reject(new Error(String(event.message)));
      worker.postMessage(data, transfer);
    });
    try {
      const result = await exchange({ action: "create", context: Array.from(context) });
      assert.equal(result.bunVersion, Bun.version);
      assert.throws(() => ffi.serialize(result.context, result.context[2]), /DOCUMENT_INVALID/);
      for (let i = 0; i < 12; i++) {
        doc.parseHtml(`<div>${"m".repeat(i % 2 ? 160000 : 1)}</div>`);
        const token = ffi.querySnapshot(context, context[2], "div")[1];
        ffi.serialize(context, token);
      }
      doc.destroy();
      await collectGarbage();
      assert.deepEqual([Array.from(result.query), Array.from(result.bytes)], result.saved);
      const returned = await exchange(
        { action: "destroy", query: result.query, bytes: result.bytes, saved: result.saved },
        [result.query.buffer, result.bytes.buffer],
      );
      assert.equal(result.query.byteLength, 0);
      assert.equal(result.bytes.byteLength, 0);
      assert.deepEqual([Array.from(returned.query), Array.from(returned.bytes)], result.saved);
    } finally {
      await worker.terminate();
      doc.destroy();
    }
  },

  // 3000 exceeds outputWords' initial 256-word capacity. Under the old
  // grow-and-retry path this was safe only because native refuses to create
  // before capacity is proven; the loader now sizes the single-shot buffer to
  // exactly `count` words so a mutating C entry is never invoked twice. The
  // observable contract is a correct, complete batch.
  "create-elements-single-shot": async () => {
    const win = new Window();
    try {
      const { document } = win;
      const state = nodeDocumentStateOf(document.body);
      const ffi = state?.ffi;
      assert.equal(typeof ffi?.createElements, "function");
      assert.notEqual(state.ffiContext, null);

      const batch = ffi.createElements(state.ffiContext, "slot", 3000);
      assert.ok(batch instanceof Uint32Array);
      assert.equal(batch.length, 3000);
      const set = new Set(batch);
      assert.equal(set.size, 3000);
      assert.equal(Math.max(...batch), Math.min(...batch) + 2999);

      // The next (smaller) batch continues the process-unique token stream
      // without overlap: no hidden duplicate allocation was registered.
      const next = ffi.createElements(state.ffiContext, "slot", 4);
      assert.equal(next.length, 4);
      for (const token of next) assert.equal(set.has(token), false);

      // The rest of the hot path still works after the oversized batch.
      const marker = document.createElement("div");
      marker.id = "marker";
      document.body.append(marker);
      assert.equal(document.querySelector("#marker"), marker);
    } finally {
      win.destroy();
    }
  },

  // A destroyed document is a frozen error, never a crash or a silent retry.
  "destroyed-document-frozen-error": async () => {
    const win = new Window();
    const { document } = win;
    const state = nodeDocumentStateOf(document.body);
    const ffi = state?.ffi;
    assert.equal(typeof ffi?.querySnapshot, "function");
    assert.notEqual(state.ffiContext, null);
    const context = state.ffiContext;
    win.destroy();
    assert.throws(() => ffi.querySnapshot(context, 0, "div"), /ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    assert.throws(() => ffi.createElements(context, "div", 8), /ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    assert.throws(() => ffi.serialize(context, 0, 0), /ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  },

  // Results and the Node-API token buffer outlive later calls, a transfer, GC
  // and document destroy; the detached source and destroyed document still
  // refuse work, and JS-owned storage stays ordinary writable memory.
  "copies-survive-transfer-gc-destroy": async () => {
    const doc = createDocument();
    const bound = boundAdapter(doc);
    const { adapter: ffi, context } = bound;
    doc.parseHtml("<div>hello 🌍</div>");
    const packed = ffi.querySnapshot(context, context[2], "div");
    const original = Array.from(packed);
    const nativeTokens = doc.ffiContext();
    const nativeCopy = Array.from(nativeTokens);
    const bytes = ffi.serialize(context, packed[1]);
    const text = new TextDecoder().decode(bytes);
    assert.equal(text, "<div>hello 🌍</div>");
    ffi.querySnapshot(context, context[2], "*");
    const transferred = structuredClone(packed, { transfer: [packed.buffer] });
    assert.equal(packed.byteLength, 0);
    doc.destroy();
    await collectGarbage();
    assert.deepEqual(Array.from(transferred), original);
    assert.deepEqual(Array.from(nativeTokens), nativeCopy);
    assert.equal(new TextDecoder().decode(bytes), text);
    assert.throws(() => doc.materializeNodeToken(transferred[1]), /DOCUMENT_DESTROYED/);
    bytes[0] = 0x21;
    assert.equal(bytes[0], 0x21); // still ordinary writable JS-owned storage
  },

  // Lengths are read from the real view, and inputs that could lie about their
  // storage or coerce into a different one are rejected before any C call.
  "input-lengths-real-view": async () => {
    const doc = createDocument();
    const { adapter: ffi, context } = boundAdapter(doc);
    try {
      doc.parseHtml("<div></div>");
      const bytes = new TextEncoder().encode("!div!").subarray(1, 4);
      Object.defineProperty(bytes, "length", { value: 0xffffffff });
      const packed = ffi.querySnapshot(context, context[2], bytes);
      assert.equal(packed.length, 3);
      const tokens = new Uint32Array([packed[1]]);
      Object.defineProperty(tokens, "length", { value: 0xffffffff });
      assert.equal(ffi.readBatch(context, tokens, 1).length, 4);
      const detached = new Uint8Array(3);
      structuredClone(detached, { transfer: [detached.buffer] });
      for (const unsafeInput of [
        detached, new Uint8Array(new SharedArrayBuffer(3)),
        new Uint8Array(new ArrayBuffer(3, { maxByteLength: 6 })), new Uint32Array(3),
      ]) {
        assert.throws(() => ffi.querySnapshot(context, context[2], unsafeInput), /INVALID_ARGUMENT/);
      }
      const first = ffi.createElements(context, "span", 1)[0];
      for (const count of [-1, 1.5, NaN, Infinity, 4097, 2 ** 32, undefined]) {
        assert.throws(() => ffi.createElements(context, "span", count), /INVALID_ARGUMENT/);
      }
      assert.equal(ffi.createElements(context, "span", 0).length, 0);
      assert.equal(ffi.createElements(context, "span", 1)[0], first + 1);
      let coerced = false;
      assert.throws(
        () => ffi.querySnapshot(context, { valueOf() { coerced = true; return context[2]; } }, bytes),
        /INVALID_ARGUMENT/,
      );
      assert.equal(coerced, false);
      const stale = Array.from(context);
      stale[1]++;
      assert.throws(() => ffi.createElements(stale, "div", 1), /STALE_GENERATION/);
      assert.throws(() => ffi.serialize(stale, context[2]), /STALE_GENERATION/);
      const foreign = createDocument();
      try {
        assert.throws(() => ffi.serialize(foreign.ffiContext(), packed[1]), /INVALID_HANDLE/);
      } finally {
        foreign.destroy();
      }
    } finally {
      doc.destroy();
    }
  },
};

const run = scenarios[scenario];
if (run === undefined) throw new Error(`unknown FFI memory scenario: ${scenario}`);
const channel = requireEnabledChannel();
await run();
// `ffiStatus` is echoed for the parent: a child that had fallen back to
// Node-API could not have passed its own preconditions, but the report makes
// the measured channel visible in the recorded evidence as well.
console.log("SCENARIO " + JSON.stringify({
  scenario, bunVersion: Bun.version, ffiStatus: channel.status, passed: true,
}));
