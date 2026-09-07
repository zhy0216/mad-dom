import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dlopen } from "bun:ffi";
import { loadNative } from "../../js/native-loader.js";

const libraryPath = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const available = existsSync(libraryPath);

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
