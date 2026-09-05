import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Window, isNativeAvailable } from "../../index.js";

// Navigation-memo + wrapper-stability tests.
//
// The facade memoizes the five `Node` navigation reads (firstChild /
// lastChild / nextSibling / previousSibling / parentNode) per wrapper,
// validated against the native document's structural epoch
// (crates/mad-dom-bun `epoch_api` / `with_document`): the binding bumps the
// epoch whenever a call changed the tree relations, so a memoized answer can
// only be served while the tree is provably unchanged. Wrappers are pinned in
// the per-document facade state while the document's native handle is
// reachable, so the memo survives garbage collection over a stable tree.
//
// These tests pin the observable contract of that machinery:
//
//   - navigation stays exactly correct across every mutation shape (the memo
//     must invalidate, never serve stale nodes);
//   - repeated reads stay identity-stable and wrappers survive GC while the
//     document is held (the stability the memo builds on);
//   - the raw native surface carries the epoch view and the wrapper
//     classification stamps with the frozen null/identity semantics.
//
// They need the locally built artifact (`npm run dev:build`, or
// MAD_DOM_NATIVE_PATH pointing at one); without it they skip so a clean
// checkout still passes `npm run validate`.

const nativeAvailable = isNativeAvailable();

function loadNative() {
  const require = createRequire(import.meta.url);
  return require(fileURLToPath(new URL("../../build/mad-dom.node", import.meta.url)));
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
}

describe.skipIf(!nativeAvailable)("navigation memo correctness", () => {
  test("memoized reads invalidate on remove / insert / replace", () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML = '<div id="a"><span>1</span><em>2</em></div>';
      const a = document.getElementById("a");
      const span = a.firstChild;
      const em = a.lastChild;

      // Identity-stable while the tree is unchanged (memo hits).
      expect(a.firstChild).toBe(span);
      expect(a.lastChild).toBe(em);
      expect(span.nextSibling).toBe(em);
      expect(em.previousSibling).toBe(span);
      expect(em.nextSibling).toBeNull();

      a.removeChild(span);
      expect(a.firstChild).toBe(em);
      expect(a.lastChild).toBe(em);
      expect(a.firstChild).toBe(a.lastChild);

      a.insertBefore(span, em);
      expect(a.firstChild).toBe(span);
      expect(span.nextSibling).toBe(em);

      const replacement = document.createElement("strong");
      a.replaceChild(replacement, em);
      expect(a.lastChild).toBe(replacement);
      expect(span.nextSibling).toBe(replacement);
      expect(replacement.previousSibling).toBe(span);
    } finally {
      window.destroy();
    }
  });

  test("memoized reads invalidate on innerHTML / textContent writes", () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML = "<section><p>old</p></section>";
      const section = document.body.firstChild;
      const oldP = section.firstChild;

      section.innerHTML = "<i>new</i>";
      expect(section.firstChild).not.toBe(oldP);
      expect(section.firstChild.tagName).toBe("I");
      expect(section.firstChild.nextSibling).toBeNull();

      section.textContent = "plain";
      expect(section.firstChild.nodeType).toBe(3);
      expect(section.firstChild.nextSibling).toBeNull();
    } finally {
      window.destroy();
    }
  });

  test("parentNode memo follows attach / detach", () => {
    const window = new Window();
    try {
      const { document } = window;
      const node = document.createElement("i");
      expect(node.parentNode).toBeNull();
      document.body.appendChild(node);
      expect(node.parentNode).toBe(document.body);
      node.remove();
      expect(node.parentNode).toBeNull();
    } finally {
      window.destroy();
    }
  });

  test("long sibling walks keep every seeded relation correct and invalidate on mutation", () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML =
        '<ul><li id="a"></li><li id="b"></li><li id="c"></li>' +
        '<li id="d"></li><li id="e"></li></ul>';
      const ul = document.body.firstChild;
      const a = ul.firstChild;
      const b = a.nextSibling;
      const c = b.nextSibling;

      // Reaching the third sibling activates the axis-prefetch path. Every
      // relation it seeds must retain normal Node identity and parentage.
      const d = c.nextSibling;
      const e = d.nextSibling;
      expect(e.nextSibling).toBeNull();
      expect(d.previousSibling).toBe(c);
      expect(e.previousSibling).toBe(d);
      expect(a.parentNode).toBe(ul);
      expect(c.parentNode).toBe(ul);
      expect(e.parentNode).toBe(ul);
      expect(ul.lastChild).toBe(e);

      // One structural mutation invalidates the entire prefetched axis.
      ul.insertBefore(e, a);
      expect(ul.firstChild).toBe(e);
      expect(e.previousSibling).toBeNull();
      expect(e.nextSibling).toBe(a);
      expect(d.nextSibling).toBeNull();
      expect(a.previousSibling).toBe(e);
    } finally {
      window.destroy();
    }
  });

  test("first-child pair seeds short axes and invalidates every relation", () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML = '<div><i id="a"></i><i id="b"></i></div>';
      const parent = document.body.firstChild;
      const first = parent.firstChild;
      const second = first.nextSibling;

      expect(second).toBe(parent.lastChild);
      expect(first.previousSibling).toBeNull();
      expect(first.parentNode).toBe(parent);
      expect(second.previousSibling).toBe(first);
      expect(second.parentNode).toBe(parent);
      expect(second.nextSibling).toBeNull();

      const third = document.createElement("i");
      parent.appendChild(third);
      expect(parent.firstChild).toBe(first);
      expect(second.nextSibling).toBe(third);
      expect(third.previousSibling).toBe(second);
      expect(parent.lastChild).toBe(third);
    } finally {
      window.destroy();
    }
  });

  test("bounded sibling fallback crosses an ultra-wide parent exactly once", () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML =
        `<aside id="guard"></aside><div id="wide">${"<i></i>".repeat(1000)}</div>`;
      const guard = document.getElementById("guard");
      const parent = document.getElementById("wide");
      // Consume this generation's one whole-subtree snapshot on the empty
      // guard so the wide parent exercises pair + bounded sibling chunks.
      expect(guard.firstChild).toBeNull();
      const first = parent.firstChild;
      const second = first.nextSibling;
      const third = second.nextSibling;

      // The third nextSibling read activates native's bounded chunk API; its
      // 32-node allocation cap is pinned separately by the native contract.
      const fourth = third.nextSibling;
      expect(fourth.previousSibling).toBe(third);

      // Crossing multiple chunk boundaries still yields every node exactly
      // once, and only the native chunk that reaches the tail seeds `null`.
      let count = 4;
      let cursor = fourth;
      while ((cursor = cursor.nextSibling) !== null) count += 1;
      expect(count).toBe(1000);
      expect(cursor).toBeNull();
      expect(parent.lastChild.nextSibling).toBeNull();
    } finally {
      window.destroy();
    }
  });

  test("wrappers stay identity-stable across GC while the document is held", async () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML = "<ul><li>1</li><li>2</li></ul>";
      const ul = document.body.firstChild;
      const firstLi = ul.firstChild;

      await collectGarbage();

      // The pin keeps the wrappers alive over the GC, and navigation reads
      // hand back the very same objects (strict equality) afterwards.
      expect(document.body.firstChild).toBe(ul);
      expect(ul.firstChild).toBe(firstLi);
      expect(ul.firstChild.nextSibling).toBe(firstLi.nextSibling);
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("native epoch and classification stamps", () => {
  test("epochView registers a 4-byte epoch that bumps on structural mutation", () => {
    const native = loadNative();
    const doc = native.createDocument();
    const view = new Int32Array(doc.epochView());
    expect(view.byteLength).toBe(4);
    const baseline = view[0];

    // Creation alone does not change tree relations.
    const parent = doc.createElement("div");
    const child = doc.createElement("span");
    expect(view[0]).toBe(baseline);

    doc.appendChild(parent, child);
    expect(view[0]).toBe(baseline + 1);

    doc.removeChild(parent, child);
    expect(view[0]).toBe(baseline + 2);

    // Attribute writes are not structural.
    doc.appendChild(parent, child);
    const afterReattach = view[0];
    child.setAttribute("class", "x");
    expect(view[0]).toBe(afterReattach);

    // Repeated calls hand back views over the same slot.
    const second = new Int32Array(doc.epochView());
    doc.appendChild(doc.createElement("p"), doc.createText("t"));
    expect(second[0]).toBe(view[0]);
    doc.destroy();
  });

  test("minted handles carry their immutable classification stamp", () => {
    const native = loadNative();
    const doc = native.createDocument();

    const div = doc.createElement("div");
    expect(div.madDomType).toBe(1);
    expect(div.madDomName).toBe("div");
    expect(div.madDomNamespace).toBe("http://www.w3.org/1999/xhtml");

    const svg = doc.createElementNs("http://www.w3.org/2000/svg", "feBlend");
    expect(svg.madDomName).toBe("feBlend");
    expect(svg.madDomNamespace).toBe("http://www.w3.org/2000/svg");

    const text = doc.createText("hi");
    expect(text.madDomType).toBe(3);
    expect(text.madDomName).toBeUndefined();

    const comment = doc.createComment("c");
    expect(comment.madDomType).toBe(8);

    const fragment = doc.createDocumentFragment();
    expect(fragment.madDomType).toBe(11);

    doc.destroy();
  });

  test("navigation keeps the frozen null and identity semantics", async () => {
    const native = loadNative();
    const doc = native.createDocument();
    const parent = doc.createElement("ul");
    const child = doc.createElement("li");
    doc.appendChild(parent, child);

    expect(child.firstChild()).toBe(null);
    expect(child.nextSibling()).toBe(null);
    expect(parent.parentNode()).toBe(null);
    expect(parent.firstChild()).toBe(child);
    expect(parent.firstChild()).toBe(parent.firstChild());

    doc.destroy();
    await collectGarbage();
  });
});

describe.skipIf(!nativeAvailable)("navigation memo never masks lifecycle errors", () => {
  test("reads after destroy miss the memo and surface the destroyed error", () => {
    const window = new Window();
    const { document } = window;
    document.body.innerHTML = "<div><span>x</span></div>";
    const div = document.body.firstChild;
    const text = div.firstChild.firstChild;
    // Warm the memo, then destroy: the cached answer must not be served.
    expect(div.firstChild).toBe(div.firstChild);
    expect(text.firstChild).toBeNull();
    window.destroy();
    expect(() => div.firstChild).toThrow();
    expect(() => div.parentNode).toThrow();
    expect(() => text.firstChild).toThrow();
    expect(() => document.body.firstChild).toThrow();
  });

  test("a childless fast read revalidates an adoption-stale wrapper", () => {
    const sourceWindow = new Window();
    const targetWindow = new Window();
    try {
      const text = sourceWindow.document.createTextNode("x");
      expect(text.firstChild).toBeNull();
      targetWindow.document.adoptNode(text);
      expect(() => text.firstChild).toThrow(/ERR_MAD_DOM_STALE_HANDLE/);
      expect(() => text.lastChild).toThrow(/ERR_MAD_DOM_STALE_HANDLE/);
    } finally {
      sourceWindow.destroy();
      targetWindow.destroy();
    }
  });
});
