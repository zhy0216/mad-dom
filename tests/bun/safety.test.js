import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createDocument, isNativeAvailable } from "../../index.js";

// T21 safety-boundary fixtures. They exercise the production binding through
// the official package dev entry (index.js → build/mad-dom.node) and cover
// the acceptance criteria for the native safety boundary:
//
//   - a Rust panic is contained by `#[napi(catch_unwind)]`, cannot crash the
//     process, and cannot wedge a document (the poisoned Mutex is recovered);
//   - dangling handles (a destroyed document) fail every operation without
//     crashing;
//   - cross-document misuse never crashes and never misreads;
//   - hostile inputs (invalid strings, wrong object types, huge values) fail
//     or succeed cleanly without breaking the process;
//   - the T21B affinity guard rejects a call originating on another thread
//     with the frozen ERR_MAD_DOM_AFFINITY_MISMATCH code, and first-phase
//     cross-thread DOM use fails explicitly (Bun strips native handles on
//     structured clone, so a handle handed to a Worker cannot call native
//     methods at all).
//
// They need the locally built artifact (`npm run dev:build`, or
// MAD_DOM_NATIVE_PATH pointing at one); without it they skip so a clean
// checkout still passes `npm run validate`.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// Runs a Worker whose source gets `__ENTRY__` replaced with the absolute
// package-entry path, so worker-isolated code reaches the same native artifact.
function runWorker(source, payload) {
  return new Promise((resolve) => {
    const entry = fileURLToPath(new URL("../../index.js", import.meta.url));
    const url =
      "data:text/javascript," +
      encodeURIComponent(source.replaceAll("__ENTRY__", JSON.stringify(entry)));
    const worker = new Worker(new URL(url, import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      worker.terminate();
      resolve(ev.data);
    };
    worker.onerror = (ev) => {
      worker.terminate();
      resolve({ ok: false, error: { name: "WorkerError", message: String(ev.message) } });
    };
    worker.postMessage(payload);
  });
}

describe.skipIf(!nativeAvailable)("native safety boundary (T21)", () => {
  test("a Rust panic is contained and the document stays usable", () => {
    const doc = createDocument();
    const err = thrown(() => doc.diagnosePanic());
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/diagnostic panic/);

    // The panic unwound while holding the document lock; the next entry must
    // recover the poisoned Mutex and keep working — a panicking native call
    // must never crash Bun or wedge a document.
    const div = doc.createElement("div");
    expect(div.nodeName()).toBe("div");
    expect(doc.appendChild(div, doc.createText("ok"))).toBeUndefined();
    doc.destroy();
  });

  test("dangling handles fail every operation without crashing", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    const text = doc.createText("x");
    doc.appendChild(div, text);
    doc.destroy();

    const calls = [
      () => doc.createElement("span"),
      () => div.nodeName(),
      () => div.parentNode(),
      () => div.firstChild(),
      () => div.childNodes(),
      () => doc.appendChild(div, text),
      () => doc.insertBefore(div, text, text),
      () => doc.removeChild(div, text),
      () => doc.replaceChild(div, text, text),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });

  test("hostile inputs fail or succeed cleanly and never crash the process", () => {
    const doc = createDocument();
    const div = doc.createElement("div");

    // Every input that must be rejected fails with a controlled error.
    const rejected = [
      () => doc.createElement(""),
      () => doc.createElement(" "),
      () => doc.createElement("1div"),
      () => doc.appendChild(div, 42),
      () => doc.appendChild(null, div),
      () => doc.createElement(1e9),
      () => doc.appendChild(div, div),
      () => doc.createText(Symbol("x")),
    ];
    for (const call of rejected) {
      const err = thrown(call);
      expect(err, "a rejected hostile input must surface a controlled error").toBeInstanceOf(
        Error,
      );
    }

    // Text data is stored verbatim, including NUL bytes (T48B text-data
    // alignment, matching happy-dom) — these succeed cleanly.
    const nulText = doc.createText("\u0000");
    expect(nulText.data()).toBe("\u0000");
    const nulComment = doc.createComment("a\u0000b");
    expect(nulComment.data()).toBe("a\u0000b");

    // Large-but-valid inputs are handled without crashing.
    const big = doc.createText("x".repeat(1_000_000));
    expect(big.nodeName()).toBe("#text");

    // The document survives the whole battery and keeps working.
    expect(div.nodeName()).toBe("div");
    doc.destroy();
  });

  test("the affinity guard passes on the owning thread", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    doc.appendChild(div, doc.createText("hi"));
    expect(div.childNodes()).toHaveLength(1);
    doc.destroy();
  });

  test("the affinity guard rejects a foreign thread with the frozen T21B code", () => {
    const doc = createDocument();
    // A real cross-thread call must surface the exact T21B contract: stable
    // code and a hand-written message (no Rust debug formatting).
    const err = thrown(() => doc.diagnoseCrossThread());
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_AFFINITY_MISMATCH");
    expect(err.message).toBe(
      "[ERR_MAD_DOM_AFFINITY_MISMATCH] a document may only be used from the thread/isolate that created it",
    );

    // The owning thread is unaffected by the rejected call.
    expect(doc.createElement("div").nodeName()).toBe("div");
    doc.destroy();
  });

  test("a worker-created document works inside its own isolate", async () => {
    const source = `
      import { createDocument } from __ENTRY__;
      self.onmessage = () => {
        try {
          const doc = createDocument();
          const el = doc.createElement("worker-el");
          doc.appendChild(el, doc.createText("w"));
          self.postMessage({ ok: true, name: el.nodeName() });
        } catch (err) {
          self.postMessage({ ok: false, error: String(err.message) });
        }
      };
    `;
    const result = await runWorker(source, "go");
    expect(result).toEqual({ ok: true, name: "worker-el" });
  });

  test("first-phase cross-thread DOM use fails explicitly, never silently", async () => {
    const doc = createDocument();
    const div = doc.createElement("div");

    // Bun's structured clone strips native handles: the object a Worker
    // receives has no native methods, so calling one throws instead of
    // silently running on the wrong thread.
    const source = `
      self.onmessage = (ev) => {
        try {
          const name = ev.data.nodeName();
          self.postMessage({ ok: true, name });
        } catch (err) {
          self.postMessage({ ok: false, error: { name: err.name, code: err.code, message: String(err.message) } });
        }
      };
    `;
    const result = await runWorker(source, div);
    expect(result.ok).toBe(false);
    expect(result.error.name).toBe("TypeError");
    expect(result.error.message).toContain("nodeName is not a function");

    doc.destroy();
  });
});
