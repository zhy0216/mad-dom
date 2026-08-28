import { describe, expect, test } from "bun:test";
import {
  createDocument,
  isNativeAvailable,
  liveDocumentCount,
  nativeAbiVersion,
} from "../../index.js";

// T19 native binding smoke tests. They exercise the production binding through
// the official package dev entry (index.js → build/mad-dom.node) and cover the
// acceptance criteria: minimal Core API calls, opaque handles, string/number
// results, document create/destroy and repeated load/destruct stability.
//
// They need the locally built artifact (`npm run dev:build`, or
// MAD_DOM_NATIVE_PATH pointing at one); without it they skip so a clean
// checkout still passes `npm run validate`.

const nativeAvailable = isNativeAvailable();

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Runs a synchronous GC and drains one macrotask so napi finalizers fire (Bun
// defers them to the next event-loop turn, documented in ADR-0003).
async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
}

describe.skipIf(!nativeAvailable)("native binding (T19)", () => {
  test("Bun loads the production artifact through the dev entry", () => {
    expect(nativeAvailable).toBe(true);
    expect(nativeAbiVersion()).toBe(1);
  });

  test("createDocument returns an opaque document handle and bumps the live count", () => {
    const before = liveDocumentCount();
    const doc = createDocument();
    expect(doc).toBeTruthy();
    expect(doc.constructor.name).toBe("DocumentHandle");
    expect(liveDocumentCount()).toBe(before + 1);
    doc.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("minimal Core API: create nodes and read string/number results", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    const text = doc.createText("hello \u{1F9A0}");
    const comment = doc.createComment("note");
    const fragment = doc.createDocumentFragment();

    expect(div.constructor.name).toBe("NodeHandle");
    expect(div.nodeType()).toBe(1);
    expect(div.nodeName()).toBe("div");
    expect(text.nodeType()).toBe(3);
    expect(text.nodeName()).toBe("#text");
    expect(comment.nodeType()).toBe(8);
    expect(comment.nodeName()).toBe("#comment");
    expect(fragment.nodeType()).toBe(11);
    expect(fragment.nodeName()).toBe("#document-fragment");
    doc.destroy();
  });

  test("opaque handles roundtrip through mutation and navigation", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    const label = doc.createText("first");
    doc.appendChild(a, label);
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    expect(parent.firstChild()?.nodeName()).toBe("li");
    expect(parent.lastChild()?.nodeName()).toBe("li");
    expect(a.nextSibling()?.nodeName()).toBe("li");
    expect(b.previousSibling()?.nodeName()).toBe("li");
    expect(a.parentNode()?.nodeName()).toBe("ul");
    expect(parent.childNodes()).toHaveLength(2);
    expect(a.childNodes()).toHaveLength(1);
    expect(parent.parentNode()).toBeNull();

    const c = doc.createElement("c");
    doc.insertBefore(parent, c, b);
    expect(parent.childNodes()).toHaveLength(3);
    doc.removeChild(parent, a);
    expect(parent.childNodes()).toHaveLength(2);
    expect(a.parentNode()).toBeNull();
    doc.destroy();
  });

  test("invalid usage maps to TypeError / Error with stable codes", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    let thrown;

    // invalid element name
    try {
      doc.createElement("1div");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");

    // hierarchy violation (cannot append a node into itself)
    thrown = undefined;
    try {
      doc.appendChild(div, div);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown.code).toBe("ERR_MAD_DOM_HIERARCHY");

    // operation on a destroyed document is a controlled Error
    doc.destroy();
    thrown = undefined;
    try {
      doc.createElement("span");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("cross-document handles are rejected, never misread", () => {
    const docA = createDocument();
    const docB = createDocument();
    const elA = docA.createElement("from-a");
    const targetB = docB.createElement("from-b");

    let thrown;
    try {
      docB.appendChild(targetB, elA);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(elA.nodeName()).toBe("from-a");
    expect(targetB.nodeName()).toBe("from-b");
    docA.destroy();
    docB.destroy();
  });

  test("any reachable node handle keeps its document alive under GC", async () => {
    // Settle lingering documents from earlier tests so the baseline is clean
    // and the deltas below are precise.
    await collectGarbage();
    const before = liveDocumentCount();
    let div = createDocument().createElement("div");
    expect(liveDocumentCount()).toBe(before + 1);

    div = null;
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });

  test("repeated create/destroy cycles never crash", async () => {
    await collectGarbage();
    const before = liveDocumentCount();
    for (let i = 0; i < 1_000; i++) {
      const doc = createDocument();
      const div = doc.createElement("div");
      doc.appendChild(div, doc.createText(`#${i}`));
      doc.destroy();
    }
    expect(liveDocumentCount()).toBe(before);

    for (let i = 0; i < 5_000; i++) {
      createDocument();
    }
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });
});
