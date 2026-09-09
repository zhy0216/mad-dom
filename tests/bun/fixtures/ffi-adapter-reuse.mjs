// Isolated JS boundary hooks around real C calls. No alternate native image,
// skipped native work, production instrumentation, or borrowed result helper.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const realFfi = createRequire(import.meta.url)("bun:ffi");
const realDlopen = realFfi.dlopen;
let afterCall;
let calls = [];
realFfi.dlopen = function dlopen(path, definitions) {
  const library = realDlopen(path, definitions);
  const symbols = Object.fromEntries(Object.entries(library.symbols).map(([name, fn]) => [name, (...args) => {
    const status = fn(...args);
    if (args.length) {
      const written = args.at(-1);
      calls.push({ name, capacity: args.at(-2), written });
      if (afterCall) return afterCall(status, args, name);
    }
    return status;
  }]));
  return { symbols, library }; // pin the actual Library and its C functions
};
const { createDocument } = await import("../../../index.js");
const { ffiForDocument, loadNativeFfi } = await import("../../../js/native-loader.js");
assert.equal(loadNativeFfi().status, "available");
const a = createDocument();
const b = createDocument();
const { adapter: ffi, context: ac } = ffiForDocument(a);
const { context: bc } = ffiForDocument(b);
const ah = a.createElement("section");
const bh = b.createElement("section");
ac[2] = a.nodeToken(ah);
bc[2] = b.nodeToken(bh);
const decode = bytes => new TextDecoder().decode(bytes);
const owned = value => {
  assert.equal(value.byteOffset, 0);
  assert.equal(value.byteLength, value.buffer.byteLength);
  return value;
};
const serialize = (context = ac) => owned(ffi.serialize(context, context[2], 1));
const observe = fn => { calls = []; const result = fn(); return { result, calls: [...calls] }; };
try {
  ah.setInnerHTML(`<main>${"你好 café 🦀".repeat(1800)}</main>`);
  bh.setInnerHTML("<span>B</span>");
  const expectedA = ah.innerHTML();
  const expectedB = bh.innerHTML();
  const first = observe(() => serialize());
  assert.equal(decode(first.result), expectedA);
  assert.equal(first.calls.length, 2);
  assert.equal(first.calls[0].capacity, 1024);
  const second = observe(() => serialize());
  assert.equal(second.calls.length, 1);
  assert.equal(second.calls[0].capacity, first.result.length);
  assert.equal(second.calls[0].written, first.calls[0].written);
  assert.notEqual(first.result.buffer, second.result.buffer);

  // Same operation reenters on another real document after native has written
  // the outer length. The inner operation must use a different length word.
  let inner;
  afterCall = (status, args) => {
    afterCall = undefined;
    const outerLength = args.at(-1)[0];
    inner = serialize(bc);
    assert.equal(args.at(-1)[0], outerLength);
    return status;
  };
  const reentrant = observe(() => serialize());
  assert.equal(decode(inner), expectedB);
  assert.equal(decode(reentrant.result), expectedA);
  assert.notEqual(reentrant.calls[0].written, reentrant.calls[1].written);

  // Shrink on the next success; a small result owns only its own bytes.
  ah.setInnerHTML("<i>x</i>");
  serialize();
  assert.equal(observe(() => serialize()).calls[0].capacity, 1024);
  // Above the hint ceiling, temporary output is still allowed by the original
  // hard budget, but the next call starts at the minimum, never the maximum.
  ah.setInnerHTML(`<p>${"x".repeat(140000)}</p>`);
  const large = serialize();
  ah.setInnerHTML("<i>x</i>");
  assert.equal(observe(() => serialize()).calls[0].capacity, 1024);
  assert.equal(large.length, 140007);

  // All native exceptions and injected JS exceptions release the lease and
  // clear the hint; the original exception object/taxonomy survives.
  ah.setInnerHTML(`<p>${"y".repeat(3000)}</p>`);
  serialize();
  const sentinel = new Error("after native exception");
  afterCall = () => { afterCall = undefined; throw sentinel; };
  assert.throws(() => serialize(), error => error === sentinel);
  assert.equal(observe(() => serialize()).calls[0].capacity, 1024);
  assert.throws(() => ffi.serialize([ac[0], ac[1] + 1, ac[2]], ac[2]), /STALE_GENERATION/);
  assert.equal(observe(() => serialize()).calls[0].capacity, 1024);

  // Safe length/status corruption only: the real native call always receives
  // valid writable storage. Read anomalies decline; they never allocate from
  // an untrusted oversized count or retry a mutating operation.
  for (const fault of ["success", "non-growing", "oversize", "exhaustion"]) {
    afterCall = (status, args) => {
      const capacity = args.at(-2), written = args.at(-1);
      written[0] = fault === "non-growing" ? capacity : fault === "oversize" ? 64000001 : capacity + 1;
      return fault === "success" ? 0 : 2;
    };
    const bad = observe(() => ffi.serialize(ac, ac[2], 1));
    afterCall = undefined;
    assert.equal(bad.result, undefined);
    assert.equal(bad.calls.length, fault === "exhaustion" ? 8 : 1);
    assert.equal(observe(() => serialize()).calls[0].capacity, 1024);
  }

  // Per-operation word hints grow, shrink, and reset above their own ceiling.
  const query = () => owned(ffi.querySnapshot(ac, ac[2], "span"));
  ah.setInnerHTML("<span></span>".repeat(600));
  query();
  assert.equal(observe(query).calls.length, 1);
  ah.setInnerHTML("<span></span>".repeat(9000));
  query();
  ah.setInnerHTML("<span></span>");
  assert.equal(observe(query).calls[0].capacity, 256);
  assert.throws(() => ffi.querySnapshot(ac, ac[2], "["), /SYNTAX/);
  assert.equal(observe(query).calls[0].capacity, 256);
  const retained = [query(), owned(ffi.childSnapshot(ac, ac[2])), owned(ffi.preorderSnapshot(ac, ac[2]))];
  const retainedCopies = retained.map(v => Array.from(v));

  let createdInner;
  afterCall = (status, args) => {
    afterCall = undefined;
    createdInner = ffi.createElements(bc, "span", 1);
    assert.equal(args.at(-1)[0], 8);
    return status;
  };
  const created = observe(() => owned(ffi.createElements(ac, "span", 8)));
  assert.equal(created.result.length, 8);
  assert.equal(createdInner.length, 1);
  assert.notEqual(created.calls[0].written, created.calls[1].written);
  for (const delta of [-1, 1]) {
    afterCall = (status, args) => { args.at(-1)[0] = 8 + delta; return status; };
    calls = [];
    assert.throws(() => ffi.createElements(ac, "span", 8), /invalid output length/);
    afterCall = undefined;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].capacity, 8);
    assert.equal(ffi.createElements(ac, "span", 8).length, 8);
  }
  for (const count of [0, 1, 8, 32, 128, 256, 257, 3000, 4095, 4096]) {
    const batch = observe(() => owned(ffi.createElements(ac, "span", count)));
    assert.equal(batch.calls.length, 1);
    assert.equal(batch.calls[0].capacity, count);
    assert.equal(batch.result.length, count);
    assert.equal(new Set(batch.result).size, count);
  }
  a.destroy(); b.destroy(); Bun.gc(true);
  assert.equal(decode(first.result), expectedA);
  retained.forEach((v, i) => assert.deepEqual(Array.from(v), retainedCopies[i]));
  console.log(JSON.stringify({ bunVersion: Bun.version, passed: true }));
} finally { afterCall = undefined; a.destroy(); b.destroy(); realFfi.dlopen = realDlopen; }
