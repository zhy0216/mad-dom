import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dlopen } from "bun:ffi";
import { loadNative } from "../../js/native-loader.js";

const libraryPath = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const available = existsSync(libraryPath);

function snapshotLibrary() {
  return dlopen(libraryPath, {
    mad_dom_ffi_abi_version: { args: [], returns: "u32" },
    mad_dom_ffi_capabilities: { args: [], returns: "u32" },
    mad_dom_ffi_query_snapshot: { args: ["u32", "u32", "u32", "buffer", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    mad_dom_ffi_preorder_snapshot: { args: ["u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    mad_dom_ffi_child_tokens: { args: ["u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
  });
}

function fixture(html) {
  const document = loadNative().createDocument();
  document.parseHtml(html);
  const context = document.ffiContext();
  const scope = document.querySelector("#scope");
  return { document, context, scope, token: document.nodeToken(scope) };
}

function invokeSnapshot(lib, f, kind, output, capacity, written, token = f.token) {
  const [owner, generation] = f.context;
  if (kind === "query") {
    const selector = new TextEncoder().encode("*");
    return lib.symbols.mad_dom_ffi_query_snapshot(owner, generation, token, selector, selector.length, output, capacity, written);
  }
  const symbol = kind === "child" ? "mad_dom_ffi_child_tokens" : "mad_dom_ffi_preorder_snapshot";
  return lib.symbols[symbol](owner, generation, token, output, capacity, written);
}

function ownedSnapshot(f, kind, token = f.token) {
  if (kind === "query") return f.scope.querySelectorAllTokens("*");
  return kind === "child" ? f.document.childNodesTokens(token) : f.document.preorderTokenSnapshot(token);
}

function semantics(document, snapshot) {
  const nodes = [];
  for (let i = 1; i < snapshot.length; i += 2) {
    const node = document.materializeNodeToken(snapshot[i]);
    const type = node.nodeType();
    nodes.push([snapshot[i + 1] & 0x7fffffff, type, node.nodeName(), type === 3 || type === 8 ? node.textContent() : null]);
  }
  return { continuation: snapshot[0], nodes };
}

describe("Bun FFI data fast path", () => {
  test("matches Node-API query and serialization on a real DOM workload", () => {
    if (!available) return;
    const native = loadNative();
    if (typeof native?.createDocument !== "function") return;
    const candidate = native.createDocument();
    const hasContext = typeof candidate?.ffiContext === "function";
    candidate.destroy();
    if (!hasContext) return;
    const lib = dlopen(libraryPath, {
      mad_dom_ffi_query_snapshot: { args: ["u32", "u32", "u32", "buffer", "u32", "ptr", "u32", "ptr"], returns: "i32" },
      mad_dom_ffi_serialize: { args: ["u32", "u32", "u32", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    });
    const document = native.createDocument();
    try {
      const context = document.ffiContext();
      const [owner, generation, root] = context;
      const html = "<main><span data-id='a'>one</span><span data-id='b'>two</span></main>";
      document.parseHtml(html);
      const nodeApi = document.querySelectorAll("span[data-id]");
      const selector = new TextEncoder().encode("span[data-id]");
      const tokens = new Uint32Array(16);
      const count = new Uint32Array(1);
      expect(lib.symbols.mad_dom_ffi_query_snapshot(owner, generation, root, selector, selector.length,
        tokens, tokens.length, count)).toBe(0);
      expect(count[0]).toBe(nodeApi.length * 2 + 1);
      const bytes = new Uint8Array(256);
      const byteCount = new Uint32Array(1);
      expect(lib.symbols.mad_dom_ffi_serialize(owner, generation, tokens[1], 0, bytes, bytes.length, byteCount)).toBe(0);
      expect(new TextDecoder().decode(bytes.subarray(0, byteCount[0]))).toBe(nodeApi[0].outerHTML());
      const tooSmall = new Uint32Array(1).fill(0xa5a5a5a5);
      expect(lib.symbols.mad_dom_ffi_query_snapshot(owner, generation, root, selector, selector.length,
        tooSmall, tooSmall.length, count)).toBe(2);
      expect(count[0]).toBe(5);
      expect(tooSmall[0]).toBe(0xa5a5a5a5);
    } finally {
      document.destroy();
    }
  });
});

describe.skipIf(!available)("caller-buffer snapshot packing", () => {
  for (const kind of ["query", "child", "preorder"]) {
    test(`${kind}: exact/short/zero capacity, fresh proof and Node-API semantic parity`, () => {
      const html = '<main id="scope"><span id="seen">你好 café 🦀</span><!--注释--><b>unknown</b><svg><path/></svg></main>';
      const native = fixture(html);
      const ffi = fixture(html);
      const lib = snapshotLibrary();
      try {
        expect(lib.symbols.mad_dom_ffi_abi_version()).toBe(1);
        expect(lib.symbols.mad_dom_ffi_capabilities()).toBe(31);
        const seen = ffi.document.querySelector("#seen");
        const seenToken = ffi.document.nodeToken(seen);
        const expected = ownedSnapshot(native, kind);
        const count = new Uint32Array(1).fill(99);
        expect(invokeSnapshot(lib, ffi, kind, null, 0, count)).toBe(2);
        expect(count[0]).toBe(expected.length);
        const guarded = new Uint32Array(expected.length + 2).fill(0xa5a5a5a5);
        const out = guarded.subarray(1, -1);
        expect(invokeSnapshot(lib, ffi, kind, out, out.length - 1, count)).toBe(2);
        expect(count[0]).toBe(expected.length);
        expect(Array.from(guarded).every(x => x === 0xa5a5a5a5)).toBe(true);
        expect(invokeSnapshot(lib, ffi, kind, out, out.length, count)).toBe(0);
        expect(count[0]).toBe(expected.length);
        expect(guarded[0]).toBe(0xa5a5a5a5);
        expect(guarded.at(-1)).toBe(0xa5a5a5a5);
        // Fresh proof is document-local and tested before materialization.
        for (let i = 1; i < out.length; i += 2) {
          expect(out[i + 1] >>> 31).toBe(out[i] === ffi.token || out[i] === seenToken ? 0 : 1);
        }
        // Opaque numeric tokens from independent documents are never compared.
        expect(semantics(ffi.document, out)).toEqual(semantics(native.document, expected));
        expect(ffi.document.materializeNodeToken(seenToken)).toBe(seen);
        const repeated = ownedSnapshot(ffi, kind);
        expect(invokeSnapshot(lib, ffi, kind, out, out.length, count)).toBe(0);
        expect(Array.from(out)).toEqual(Array.from(repeated));
        expect(Array.from(out).filter((_, i) => i > 1 && i % 2 === 0).every(x => x >>> 31 === 0)).toBe(true);
        const savedOwned = Array.from(expected);
        const savedFfi = Array.from(out);
        const transferred = structuredClone(out, { transfer: [out.buffer] });
        ownedSnapshot(native, "preorder");
        native.document.destroy();
        ffi.document.destroy();
        Bun.gc(true);
        expect(Array.from(expected)).toEqual(savedOwned);
        expect(Array.from(transferred)).toEqual(savedFfi);
      } finally {
        native.document.destroy();
        ffi.document.destroy();
        lib.close();
      }
    });
  }

  test("deep topology and empty snapshots match the owned Node-API layout", () => {
    const depth = 1024;
    const html = `<main id="scope">${"<div>".repeat(depth)}你好 🦀${"</div>".repeat(depth)}</main>`;
    const native = fixture(html);
    const ffi = fixture(html);
    const lib = snapshotLibrary();
    try {
      const expected = ownedSnapshot(native, "preorder");
      const out = new Uint32Array(expected.length);
      const written = new Uint32Array(1);
      expect(invokeSnapshot(lib, ffi, "preorder", out, out.length, written)).toBe(0);
      expect(written[0]).toBe(2 * (depth + 2) + 1);
      expect(semantics(ffi.document, out)).toEqual(semantics(native.document, expected));
      expect(out.at(-1) & 0xffff).toBe(depth + 1);
      const leaf = out.at(-2);
      const empty = new Uint32Array(1).fill(99);
      expect(invokeSnapshot(lib, ffi, "child", null, 0, written, leaf)).toBe(2);
      expect(written[0]).toBe(1);
      expect(invokeSnapshot(lib, ffi, "child", empty, 1, written, leaf)).toBe(0);
      expect(Array.from(empty)).toEqual([0]);
    } finally {
      native.document.destroy();
      ffi.document.destroy();
      lib.close();
    }
  });

  test("wide trees preserve the 65,535-node boundary and all continuation subtrees", () => {
    const children = 65_538;
    const html = `<main id="scope">${"<b></b>".repeat(children)}</main>`;
    const native = fixture(html);
    const ffi = fixture(html);
    const lib = snapshotLibrary();
    try {
      const expected = ownedSnapshot(native, "preorder");
      const out = new Uint32Array(expected.length);
      const written = new Uint32Array(1);
      expect(invokeSnapshot(lib, ffi, "preorder", null, 0, written)).toBe(2);
      expect(written[0]).toBe(2 * 65_535 + 1);
      expect(invokeSnapshot(lib, ffi, "preorder", out, out.length, written)).toBe(0);
      expect(out[0]).toBe(2);
      expect(expected[0]).toBe(2);
      expect(semantics(ffi.document, out)).toEqual(semantics(native.document, expected));
      let next = ffi.document.materializeNodeToken(out.at(-2)).nextSibling();
      let nativeNext = native.document.materializeNodeToken(expected.at(-2)).nextSibling();
      let visited = (out.length - 1) / 2;
      while (next !== null) {
        const nextToken = ffi.document.nodeToken(next);
        const nativeToken = native.document.nodeToken(nativeNext);
        const tail = new Uint32Array(3);
        expect(invokeSnapshot(lib, ffi, "preorder", tail, tail.length, written, nextToken)).toBe(0);
        expect(written[0]).toBe(3);
        expect(semantics(ffi.document, tail)).toEqual(semantics(native.document, ownedSnapshot(native, "preorder", nativeToken)));
        visited++;
        next = next.nextSibling();
        nativeNext = nativeNext.nextSibling();
      }
      expect(nativeNext).toBeNull();
      expect(visited).toBe(children + 1);
    } finally {
      native.document.destroy();
      ffi.document.destroy();
      lib.close();
    }
  }, 30_000);
});
