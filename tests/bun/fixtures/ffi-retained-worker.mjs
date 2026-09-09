import assert from "node:assert/strict";
import { createDocument } from "../../../index.js";
import { ffiForDocument } from "../../../js/native-loader.js";

let doc;
self.onmessage = ({ data }) => {
  try {
    if (data.action === "create") {
      doc = createDocument();
      const { adapter: ffi, context } = ffiForDocument(doc);
      doc.parseHtml("<span>Worker 你好 🦀</span>");
      assert.throws(() => ffi.serialize(data.context, data.context[2]), /DOCUMENT_INVALID/);
      const query = ffi.querySnapshot(context, context[2], "span");
      const bytes = ffi.serialize(context, query[1]);
      const saved = [Array.from(query), Array.from(bytes)];
      // Churn the same adapter while the results still belong to this Worker.
      for (let i = 0; i < 20; i++) {
        doc.parseHtml(`<div>${"x".repeat(i % 2 ? 150000 : 1)}</div>`);
        const other = ffi.querySnapshot(context, context[2], "div");
        ffi.serialize(context, other[1]);
        ffi.preorderSnapshot(context, context[2]);
      }
      assert.deepEqual([Array.from(query), Array.from(bytes)], saved);
      self.postMessage({ context: Array.from(context), query, bytes, saved, bunVersion: Bun.version },
        [query.buffer, bytes.buffer]);
      assert.equal(query.byteLength, 0);
      assert.equal(bytes.byteLength, 0);
    } else {
      doc.destroy();
      Bun.gc(true);
      assert.deepEqual([Array.from(data.query), Array.from(data.bytes)], data.saved);
      self.postMessage({ query: data.query, bytes: data.bytes }, [data.query.buffer, data.bytes.buffer]);
    }
  } catch (error) {
    doc?.destroy();
    self.postMessage({ error: error.stack ?? String(error) });
  }
};
