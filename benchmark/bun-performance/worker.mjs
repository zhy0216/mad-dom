#!/usr/bin/env bun
import { strict as assert } from "node:assert";
import { config, native, loader, fromRoot } from "./preload.mjs";
import { HOTSPOTS, fixture, hotWorkload, fingerprint, operationPath, SCHEMA } from "./protocol.mjs";
import { collectAndDrain, summarize } from "../dom-bench/stats.mjs";

const diagnostic = config.diagnostic ? (await import("./diagnostics.mjs")).installDiagnostics(native, loader) : null;
const { Window } = await fromRoot("index.js");
const { nodeDocumentStateOf, nodeHandleOf, nodeInternalsOf } = await fromRoot("js/facade/extensions/classes.js");
const { suite: layer, ffi, iterations, runs, sizes } = config;
const adapter = loader.loadNativeFfi().adapter;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const definitions = {
  mad_dom_ffi_query_snapshot: { args: ["u32", "u32", "u32", "buffer", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  mad_dom_ffi_child_tokens: { args: ["u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  mad_dom_ffi_preorder_snapshot: { args: ["u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  mad_dom_ffi_serialize: { args: ["u32", "u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  mad_dom_ffi_create_elements: { args: ["u32", "u32", "buffer", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
};
// Pin the raw library for the entire worker. No library or output is borrowed across documents.
const library = layer === "raw" && ffi === "on" ? (await import("bun:ffi")).dlopen(config.image.path, definitions) : null;
if (diagnostic && library) diagnostic.raw(library.symbols);

function walk(root) {
  const out = [];
  function visit(node) {
    out.push(node);
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  }
  visit(root);
  return out;
}

function prepare(wl) {
  const window = layer === "facade" ? new Window() : null;
  const doc = window ? nodeDocumentStateOf(window.document).documentHandle : native.createDocument();
  const context = doc.ffiContext();
  const create = wl.name.startsWith("create.");
  let root, token, handle;
  if (!create) {
    root = window ? window.document.createElement("section") : doc.createElement("section");
    handle = window ? nodeHandleOf(root) : root;
    token = doc.nodeToken(handle);
    handle.setInnerHTML(fixture(wl.count, wl.name.endsWith("ascii")));
  } else if (window) {
    // The actual pool ramps 1, 8, 32, 128, 256. Drain complete earlier tiers;
    // the timed public loop then consumes exactly the named tier, including refill.
    const prime = wl.count === 1 ? 0 : wl.count === 8 ? 1 : wl.count === 32 ? 9 : wl.count === 128 ? 41 : 169;
    for (let i = 0; i < prime; i++) window.document.createElement("span");
    const state = nodeDocumentStateOf(window.document);
    if (wl.count !== 1) {
      const pool = state.getElementTokenPool("span");
      assert.equal(pool.next, wl.count);
      assert.equal(pool.pos, 0);
      assert.equal(pool.rangeRemaining, 0);
    }
  }
  const words = new Uint32Array(create ? wl.count : Math.max(3, (wl.large * 4 + 1) * 2 + 1));
  const bytes = new Uint8Array(Buffer.byteLength(`<section>${fixture(wl.large)}</section>`) + 16);
  const written = new Uint32Array(1);
  const selector = encoder.encode(wl.selector);
  const name = encoder.encode("span");
  const ctx = { window, doc, context, root, token, handle, words, bytes, written, selector, name, wl };
  if (wl.name.endsWith("grow-shrink")) {
    handle.setInnerHTML(fixture(wl.large));
    // Consume a large result on this SAME context before the small timed result.
    ctx.wl = { ...wl, count: wl.large };
    const large = operate(ctx);
    validate(ctx, large);
    ctx.wl = wl;
    handle.setInnerHTML(fixture(wl.count));
  }
  if (wl.name.endsWith("hot")) validate(ctx, operate(ctx));
  return ctx;
}

function operate(c) {
  const { wl, context, token, handle, doc } = c;
  const name = wl.name;
  const create = name.startsWith("create.");
  if (layer === "facade") {
    if (create) return Array.from({ length: wl.count }, () => c.window.document.createElement("span"));
    if (name.startsWith("query")) return Array.from(c.root.querySelectorAll(wl.selector));
    if (name.startsWith("child")) return Array.from(c.root.childNodes);
    if (name.startsWith("preorder")) return walk(c.root);
    const text = name.startsWith("inner") ? c.root.innerHTML : c.root.outerHTML;
    c.consumedLength = text.length;
    return text;
  }
  if (ffi === "off") {
    if (create) return doc.createElementTokenRange("span", wl.count);
    if (name.startsWith("query")) return handle.querySelectorAllTokens(wl.selector);
    if (name.startsWith("child")) return doc.childNodesTokens(token);
    if (name.startsWith("preorder")) return doc.preorderTokenSnapshot(token);
    const text = name.startsWith("inner") ? handle.innerHTML() : handle.outerHTML();
    c.consumedLength = text.length;
    return text;
  }
  if (layer === "adapter") {
    let result;
    if (create) result = adapter.createElements(context, "span", wl.count);
    else if (name.startsWith("query")) result = adapter.querySnapshot(context, token, wl.selector);
    else if (name.startsWith("child")) result = adapter.childSnapshot(context, token);
    else if (name.startsWith("preorder")) result = adapter.preorderSnapshot(context, token);
    else {
      const bytes = adapter.serialize(context, token, name.startsWith("inner") ? 1 : 0);
      if (bytes === undefined) throw new Error("unexpected adapter serialization fallback");
      result = new TextDecoder().decode(bytes);
      c.consumedLength = result.length;
    }
    if (result === undefined) throw new Error("unexpected adapter fallback");
    return result;
  }
  const [owner, generation] = context;
  const s = library.symbols;
  let status;
  if (create) status = s.mad_dom_ffi_create_elements(owner, generation, c.name, c.name.length, wl.count, c.words, c.words.length, c.written);
  else if (name.startsWith("query")) status = s.mad_dom_ffi_query_snapshot(owner, generation, token, c.selector, c.selector.length, c.words, c.words.length, c.written);
  else if (name.startsWith("child")) status = s.mad_dom_ffi_child_tokens(owner, generation, token, c.words, c.words.length, c.written);
  else if (name.startsWith("preorder")) status = s.mad_dom_ffi_preorder_snapshot(owner, generation, token, c.words, c.words.length, c.written);
  else status = s.mad_dom_ffi_serialize(owner, generation, token, name.startsWith("inner") ? 1 : 0, c.bytes, c.bytes.length, c.written);
  if (status !== 0) throw new Error(`raw FFI ${name} status ${status}`);
  return /HTML/.test(name) ? c.bytes : c.words;
}

function validate(c, result) {
  const { wl, doc } = c;
  const rawFfi = layer === "raw" && ffi === "on";
  if (/HTML/.test(wl.name)) {
    const html = fixture(wl.count, wl.name.endsWith("ascii"));
    const expected = wl.name.startsWith("inner") ? html : `<section>${html}</section>`;
    const text = rawFfi ? decoder.decode(result.subarray(0, c.written[0])) : result;
    assert.equal(text, expected, "complete serialized string differs");
    if (rawFfi) assert.equal(c.written[0], Buffer.byteLength(expected));
    else assert.equal(c.consumedLength, expected.length);
    return { sha256: fingerprint(text), utf8Bytes: Buffer.byteLength(text), utf16Units: text.length };
  }
  const create = wl.name.startsWith("create.");
  let nodes;
  if (layer === "facade") nodes = result;
  else {
    const tokens = create ? typeof result === "number" ? Array.from({ length: wl.count }, (_, i) => result + i) :
      Array.from(rawFfi ? result.subarray(0, c.written[0]) : result) :
      Array.from(rawFfi ? result.subarray(0, c.written[0]) : result).filter((_, i) => i % 2 === 1);
    assert.equal(new Set(tokens).size, tokens.length, "duplicate tokens");
    if (!create) assert.equal(result[0], 0, "unexpected continuation/skipped subtree");
    nodes = tokens.map(t => doc.materializeNodeToken(t));
  }
  assert.equal(new Set(nodes).size, nodes.length, "duplicate wrappers");
  const semantic = nodes.map(node => {
    const type = layer === "facade" ? node.nodeType : node.nodeType();
    const name = layer === "facade" ? node.nodeName : node.nodeName();
    const data = type === 3 || type === 8 ? layer === "facade" ? node.textContent : node.textContent() : null;
    return [type, type === 1 ? name.toUpperCase() : name, data];
  });
  const expected = [];
  if (wl.name.startsWith("preorder")) expected.push([1, "SECTION", null]);
  for (let i = 0; i < wl.count; i++) {
    expected.push([1, "SPAN", null]);
    if (wl.name.startsWith("preorder")) expected.push([1, "B", null], [3, "#text", `你好 café 🦀 ${i}`], [8, "#comment", "edge"]);
    if (create) {
      const node = nodes[i];
      assert.equal(layer === "facade" ? node.parentNode : node.parentNode(), null);
    }
    if (wl.name.startsWith("query") || wl.name.startsWith("child")) {
      const html = layer === "facade" ? nodes[i].outerHTML : nodes[i].outerHTML();
      // An index-sensitive complete oracle detects duplicate/reordered contents.
      assert.equal(html, `<span data-i="${i}" class="hit"><b>你好 café 🦀 ${i}</b><!--edge--></span>`);
    }
  }
  assert.deepEqual(semantic, expected);
  return { count: nodes.length, semanticSha256: fingerprint(semantic), orderedContents: "verified", unique: true };
}

const results = [];
for (const size of sizes) {
  const phases = {}, checks = {}, workload = {};
  for (const name of HOTSPOTS) {
    const wl = hotWorkload(name, size, iterations);
    workload[name] = wl;
    const samples = [], warmupSamples = [], roundChecks = [], diagnostics = [];
    let failed = null;
    for (let round = 0; round < runs + 2; round++) {
      const contexts = [], values = [];
      try {
        for (let i = 0; i < iterations; i++) contexts.push(prepare(wl));
        await collectAndDrain();
        if (diagnostic) diagnostic.start();
        const start = performance.now();
        for (const c of contexts) values.push(operate(c));
        const ms = performance.now() - start;
        if (diagnostic) diagnostics.push(diagnostic.stop());
        (round < 2 ? warmupSamples : samples).push(ms);
        const verified = contexts.map((c, i) => validate(c, values[i]));
        assert.ok(verified.every(v => fingerprint(v) === fingerprint(verified[0])));
        roundChecks.push({ iterations: verified.length, ...verified[0] });
      } catch (error) {
        if (diagnostic) diagnostic.stop();
        failed = { round, stage: round < 2 ? "warmup" : "measured", message: error.stack ?? String(error) };
        break;
      } finally {
        for (const c of contexts) c.window ? c.window.destroy() : c.doc.destroy();
      }
    }
    if (!failed && !roundChecks.every(v => fingerprint(v) === fingerprint(roundChecks[0]))) failed = { message: "round correctness changed" };
    phases[name] = { status: failed ? "failed" : "passed", samples, warmupSamples,
      ...(!failed ? summarize(samples) : { error: failed }), expectedPath: operationPath(layer, name, ffi),
      observedPath: config.observedPaths?.[size]?.[name] ?? null,
      ...(diagnostic ? { diagnostics } : {}) };
    checks[name] = { rounds: roundChecks, fingerprint: fingerprint(roundChecks[0]) };
    await collectAndDrain();
  }
  results.push({ size, workload: { runs, iterations, cases: workload }, phases, checks,
    valid: Object.values(phases).every(p => p.status === "passed"), memory: process.memoryUsage() });
}
const valid = results.every(r => r.valid);
console.log(JSON.stringify({ schema: `${SCHEMA}/hotspots`, suite: layer, engine: "mad-dom", runs,
  host: { bun: Bun.version, os: process.platform, arch: process.arch }, sizes, results, valid }, null, 2));
process.exitCode = valid ? 0 : 1;
