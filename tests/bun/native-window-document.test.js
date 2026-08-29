import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNativeAvailable, liveDocumentCount } from "../../index.js";

// T22A native Window/Document binding smoke tests.
//
// They exercise the frozen native contract (crates/mad-dom-bun/src/extensions/
// window_document.rs) through the locally built artifact (build/mad-dom.node)
// and cover the acceptance criteria:
//
//   - createWindow() mints a Window strongly owning a fresh Document;
//   - WindowHandle.document() hands back one and the same DocumentHandle object
//     on every read (stable identity, no second facade cache needed);
//   - the document and its nodes are fully usable through the existing
//     T19/T20/T21 surface (node creation, navigation, errors);
//   - WindowHandle.destroy() eagerly destroys the document; every Core-touching
//     operation on any handle — window, document or node — then fails per the
//     T21 rules with ERR_MAD_DOM_DOCUMENT_DESTROYED (the pure accessor
//     document() keeps handing back the same, now-destroyed document handle);
//   - the Window → Document ownership chain follows T20: a lone surviving node
//     wrapper keeps the document's arena alive, and explicit destroy/GC
//     decrements the live-document counter exactly once.
//
// The root entry's `createWindow` is a pre-alpha placeholder (wired by T22), so
// these fixtures load the native module directly — the same artifact the dev
// entry loads. They need the locally built artifact (`npm run dev:build`, or
// MAD_DOM_NATIVE_PATH pointing at one); without it they skip so a clean
// checkout still passes `npm run validate`.
//
// The contract fixture (tests/bun/fixtures/native-window-document.contract.json)
// is the frozen, machine-readable native contract T22B and the later native
// subtasks depend on; the first block validates the live module against it.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/native-window-document.contract.json", import.meta.url),
);
const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

const nativeAvailable = isNativeAvailable();

function loadNative() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  const path =
    (explicit && (isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit))) ||
    fileURLToPath(new URL("../../build/mad-dom.node", import.meta.url));
  return createRequire(import.meta.url)(path);
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Runs a synchronous GC and drains one macrotask so napi finalizers fire (Bun
// defers them to the next event-loop turn, documented in ADR-0003).
async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
}

// The window holds its document through a strong napi_ref, so GC collects the
// window on one pass and the newly-unreferenced document on the next. `settleGc`
// runs both passes so a "everything reachable through JS is gone" assertion
// sees the fully settled document count.
async function settleGc() {
  await collectGarbage();
  await collectGarbage();
}

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.skipIf(!nativeAvailable)("native Window/Document binding (T22A)", () => {
  const native = loadNative();

  test("the contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/native-window-document-contract/1");
    expect(contract.owner).toBe("T22A");
    expect(contract.gate).toBe("T22");
    expect(contract.frozenFor).toEqual(["T22B", "T23A", "T24A", "T24B"]);
    expect(contract.exports.createWindow.returns).toBe("WindowHandle");
    expect(contract.classes.WindowHandle.methods).toHaveProperty("document");
    expect(contract.classes.WindowHandle.methods).toHaveProperty("destroy");
    expect(contract.documentContext.wrapperEntry).toContain("wrap_node");
    expect(contract.lifecycle.destroyedError.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("the native module surface matches the frozen contract", () => {
    expect(typeof native.createWindow).toBe("function");
    expect(typeof native.WindowHandle).toBe("function");
    const windowProto = native.WindowHandle.prototype;
    expect(typeof windowProto.document).toBe("function");
    expect(typeof windowProto.destroy).toBe("function");
  });

  test("createWindow returns a Window strongly owning a fresh Document", () => {
    const before = liveDocumentCount();
    const win = native.createWindow();
    expect(win.constructor.name).toBe("WindowHandle");
    expect(liveDocumentCount()).toBe(before + 1);

    const doc = win.document();
    expect(doc.constructor.name).toBe("DocumentHandle");
    expect(liveDocumentCount()).toBe(before + 1);

    // The document is fully usable through the existing T19/T20 surface.
    const ul = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    doc.appendChild(ul, a);
    doc.appendChild(ul, b);
    expect(ul.firstChild()).toBe(a);
    expect(ul.lastChild()).toBe(b);
    expect(a.parentNode()).toBe(ul);

    win.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("window.document() is one and the same object on every read", () => {
    const win = native.createWindow();
    const doc = win.document();
    expect(win.document()).toBe(doc);
    expect(win.document()).toBe(win.document());
    win.destroy();
  });

  test("destroying the Window destroys its Document: every handle fails per T21", () => {
    const win = native.createWindow();
    const doc = win.document();
    const div = doc.createElement("div");
    const text = doc.createText("x");
    doc.appendChild(div, text);

    win.destroy();

    const calls = [
      () => doc.createElement("span"),
      () => doc.createText("y"),
      () => div.nodeName(),
      () => div.childNodes(),
      () => doc.appendChild(div, text),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every Core-touching handle of a destroyed window must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(thrown(() => div.nodeName()).message).toBe(
      "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
    );

    // `document()` is a pure accessor: it keeps handing back one and the same
    // (now-destroyed) document handle — every use of that handle fails above.
    expect(win.document()).toBe(doc);

    // Destroy is idempotent and never crashes.
    win.destroy();
    expect(thrown(() => doc.createElement("span")).code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("cross-window documents never share identity or arena", () => {
    const winA = native.createWindow();
    const winB = native.createWindow();
    const slotA = winA.document().createElement("from-a");
    const slotB = winB.document().createElement("from-b");

    expect(winA.document()).not.toBe(winB.document());
    expect(slotA).not.toBe(slotB);
    expect(slotA.nodeName()).toBe("from-a");
    expect(slotB.nodeName()).toBe("from-b");

    const err = thrown(() => winB.document().appendChild(winB.document().createElement("p"), slotA));
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");

    winA.destroy();
    winB.destroy();
  });

  test("a lone node wrapper keeps its window's document arena alive", async () => {
    // Settle lingering documents from earlier tests so the baseline is clean.
    await settleGc();
    const before = liveDocumentCount();

    let survivor = null;
    // Creation and reads each run in their own function frame (same
    // frame-isolation rationale as gc.test.js): JSC scans the machine stack
    // conservatively, so an inline native call leaves stale register/spill
    // copies that would keep the wrappers alive past the explicit drop below.
    const spawn = () => {
      const win = native.createWindow();
      const doc = win.document();
      const ul = doc.createElement("ul");
      doc.appendChild(ul, doc.createElement("li"));
      survivor = ul.firstChild();
    };
    const readSurvivor = (wrapper) => ({
      type: wrapper.nodeType(),
      name: wrapper.nodeName(),
      parentName: wrapper.parentNode().nodeName(),
    });

    spawn();
    await settleGc();

    // The window and document wrappers are collected; the lone node wrapper
    // keeps the document's arena alive — and it is fully readable.
    expect(liveDocumentCount()).toBe(before + 1);
    expect(readSurvivor(survivor)).toEqual({ type: 1, name: "li", parentName: "ul" });

    survivor = null;
    await settleGc();
    expect(liveDocumentCount()).toBe(before);
  });

  test("repeated createWindow/destroy cycles never crash or leak", async () => {
    await settleGc();
    const before = liveDocumentCount();
    for (let i = 0; i < 1_000; i++) {
      const win = native.createWindow();
      const doc = win.document();
      doc.appendChild(doc.createElement("div"), doc.createText(`#${i}`));
      win.destroy();
    }
    expect(liveDocumentCount()).toBe(before);

    // Create-and-discard windows inside their own function frame: JSC scans
    // the machine stack conservatively, so a stale register/spill copy in this
    // test frame would keep the last window — and with it its document — alive
    // past the GC (same frame-isolation rationale as gc.test.js).
    const createAndDiscard = (count) => {
      for (let i = 0; i < count; i++) {
        native.createWindow();
      }
    };
    createAndDiscard(2_000);
    await settleGc();
    expect(liveDocumentCount()).toBe(before);
  });
});
