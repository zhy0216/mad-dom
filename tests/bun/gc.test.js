import { describe, expect, test } from "bun:test";
import {
  createDocument,
  isNativeAvailable,
  liveDocumentCount,
} from "../../index.js";

// T20 wrapper identity and GC lifecycle tests. They exercise the production
// binding through the official package dev entry (index.js → build/mad-dom.node)
// and cover the acceptance criteria: repeated reads of a node return one and
// the same JS object (strict equality), the wrapper cache is weak (a wrapper
// nobody references is collected, proving no strong cache), a lone child
// wrapper keeps its document's arena alive, and GC pressure neither leaks
// documents nor bleeds wrapper identity across nodes or documents.
//
// Slot-reuse semantics note: the current binding's removeChild is a detach —
// Core arena slot recycling only happens on the adoption path, which the
// binding layer cannot reach yet. The observable face of "slot delete + reuse"
// is therefore covered by three properties together: (1) a detached node's
// wrapper stays stable and usable, (2) two documents hand out wrappers for the
// same slot/generation that never compare equal and never misread each other,
// and (3) a collected wrapper's cache entry is evicted (WeakRef test below) so
// a future recycled slot cannot alias the old wrapper's identity — the
// generational handles guarantee that once recycling lands, an old wrapper can
// never reach a new node.
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

describe.skipIf(!nativeAvailable)("wrapper identity and GC (T20)", () => {
  test("repeated reads of the same node return the same wrapper object", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    expect(parent.firstChild()).toBe(parent.firstChild());
    expect(parent.firstChild()).toBe(parent.childNodes()[0]);
    expect(parent.lastChild()).toBe(parent.childNodes()[1]);
    expect(a.nextSibling()).toBe(parent.lastChild());
    expect(b.previousSibling()).toBe(parent.firstChild());
    expect(a.parentNode()).toBe(parent);
    expect(parent.parentNode()).toBeNull();

    // A created node's wrapper is minted once: appending it and reading it
    // back through navigation yields the identical object.
    const p2 = doc.createElement("div");
    const c = doc.createElement("span");
    doc.appendChild(p2, c);
    expect(p2.firstChild()).toBe(c);

    doc.destroy();
  });

  test("a detached wrapper keeps its identity across tree changes", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    doc.appendChild(parent, a);
    const alias = parent.firstChild();

    doc.removeChild(parent, a);
    expect(a.parentNode()).toBeNull();
    expect(alias.parentNode()).toBeNull();
    expect(a).toBe(alias);
    expect(a.nodeName()).toBe("li");

    // Re-appending the same detached node keeps the identity, too.
    doc.appendChild(parent, a);
    expect(parent.firstChild()).toBe(a);

    doc.destroy();
  });

  test("the wrapper cache is weak: collected wrappers are evicted", async () => {
    // Same frame-isolation rationale as the arena-survival test below: calls
    // that touch the wrapper run in their own function frame, so this test
    // frame keeps no stale register/spill copy of it when the reference is
    // dropped and the GC runs.
    const doc = createDocument();
    let parent = null;
    let wr = null;
    const spawn = () => {
      const p = doc.createElement("ul");
      const child = doc.createElement("li");
      doc.appendChild(p, child);
      // While alive, the cached wrapper is the very object just returned.
      expect(p.firstChild()).toBe(child);
      parent = p;
      wr = new WeakRef(child);
    };
    spawn();

    await collectGarbage();

    // The wrapper was collected (nothing kept it alive — the cache is weak,
    // the boundary requirement "no strong cache" made observable) ...
    expect(wr.deref()).toBeUndefined();

    // ... and the next read mints a fresh wrapper with a new stable identity.
    const readChild = (p) => p.firstChild();
    const fresh = readChild(parent);
    expect(fresh).not.toBeUndefined();
    expect(fresh.nodeName()).toBe("li");
    expect(fresh).toBe(readChild(parent));
    expect(new WeakRef(fresh).deref()).toBe(fresh);

    doc.destroy();
  });

  test("reads in the collected-but-not-yet-finalized window re-mint instead of returning undefined", () => {
    // Bun defers napi finalizers to the next event-loop turn, so right after
    // a synchronous GC a collected wrapper's cache entry is still present but
    // stale ("collected but not yet finalized"). wrap_node must detect the
    // dead reference and mint a fresh wrapper instead of handing JavaScript
    // `undefined` (the pre-fix behaviour, which truncated tree walks and
    // crashed chained reads).
    const doc = createDocument();
    let parent = null;
    let wr = null;
    const spawn = () => {
      const p = doc.createElement("ul");
      const child = doc.createElement("li");
      doc.appendChild(p, child);
      expect(p.firstChild()).toBe(child); // caches the child wrapper
      parent = p;
      wr = new WeakRef(child);
    };
    spawn();

    // Collect WITHOUT draining the event loop: the wrapper is collected but
    // its finalizer has not run yet, so the cache entry is stale.
    Bun.gc(true);
    expect(wr.deref()).toBeUndefined();

    const read = (p) => p.firstChild();
    const fresh = read(parent);
    expect(fresh).not.toBeUndefined();
    expect(fresh).not.toBeNull();
    expect(fresh.nodeName()).toBe("li");
    // The re-minted wrapper has stable identity for subsequent reads.
    expect(read(parent)).toBe(fresh);

    doc.destroy();
  });

  test("a lone child wrapper keeps its document arena alive", async () => {
    // Settle lingering documents from earlier tests so the baseline is clean
    // and the deltas below are precise.
    await collectGarbage();
    const before = liveDocumentCount();

    let survivor = null;
    // Creation and reads each run in their own function frame: JSC scans the
    // machine stack conservatively, so an inline native call on the wrapper
    // leaves stale register/spill copies that (correctly!) look like live
    // references and would keep the wrapper — and with it the document —
    // alive past the explicit drop below. Delegating the calls gives the
    // remnants their own frame, which is gone once the helper returns.
    const spawn = () => {
      const doc = createDocument();
      const parent = doc.createElement("ul");
      const child = doc.createElement("li");
      doc.appendChild(parent, child);
      survivor = child;
    };
    const readSurvivor = (wrapper) => ({
      type: wrapper.nodeType(),
      name: wrapper.nodeName(),
      parentName: wrapper.parentNode().nodeName(),
    });

    spawn();
    await collectGarbage();

    // doc and parent wrappers are collected; the lone child wrapper keeps
    // the document arena alive — and the arena is fully readable.
    expect(liveDocumentCount()).toBe(before + 1);
    expect(readSurvivor(survivor)).toEqual({ type: 1, name: "li", parentName: "ul" });

    survivor = null;
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });

  test("GC pressure: no document leak and collected wrappers stay collectable", async () => {
    await collectGarbage();
    const before = liveDocumentCount();

    let recycled = null;
    // One full scenario per iteration, in its own function frame (same
    // frame-isolation rationale as the arena-survival test above): the frame
    // — with every register/spill remnant of its wrappers — dies when it
    // returns, so nothing in this test frame keeps the recorded wrapper alive
    // past the drop and the final WeakRef assertion stays reliable.
    const iteration = (i) => {
      const doc = createDocument();
      const parent = doc.createElement("ul");
      const a = doc.createElement("li");
      const b = doc.createElement("li");
      doc.appendChild(parent, a);
      doc.appendChild(parent, b);

      const first = parent.firstChild();
      expect(first).toBe(a);
      if (i === 100) {
        // Record a wrapper whose only strong reference dies with the helper
        // frame; the weak cache must not keep it alive.
        recycled = new WeakRef(first);
      }

      doc.removeChild(parent, a);
      expect(a.parentNode()).toBeNull();
      expect(a).toBe(first);
      expect(parent.firstChild()).toBe(b);
      expect(parent.firstChild().nodeName()).toBe("li");

      doc.destroy();
    };

    for (let i = 0; i < 200; i++) {
      iteration(i);
      if (i % 50 === 49) {
        await collectGarbage();
      }
    }

    await collectGarbage();
    expect(recycled.deref()).toBeUndefined();
    expect(liveDocumentCount()).toBe(before);
  });

  test("cross-document wrappers never share identity on the same slot", () => {
    const docA = createDocument();
    const docB = createDocument();
    // Both documents allocate their first element, so the two NodeIds share
    // slot and generation and differ only by document.
    const slotA = docA.createElement("from-a");
    const slotB = docB.createElement("from-b");

    expect(slotA).not.toBe(slotB);
    expect(slotA.nodeName()).toBe("from-a");
    expect(slotB.nodeName()).toBe("from-b");
    expect(slotA.nodeType()).toBe(1);
    expect(slotB.nodeType()).toBe(1);

    docA.destroy();
    docB.destroy();
  });
});
