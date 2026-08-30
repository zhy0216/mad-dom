import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNativeAvailable, liveDocumentCount } from "../../index.js";

// T24A native append/insert mutation contract tests.
//
// They exercise the frozen native contract (audited and pinned in
// crates/mad-dom-bun/src/extensions/mutation_insert_api.rs) through the locally
// built artifact (build/mad-dom.node) and cover the acceptance criteria:
//
//   - appendChild / insertBefore convert the NodeHandle arguments to their Core
//     NodeId and delegate verbatim to Core's unified mutation entry
//     (Document::append_child / Document::insert_before) — the binding rewrites
//     no tree rule and keeps no second DOM state, and both return undefined;
//   - success paths: appending detached nodes, moving a node between parents,
//     reordering with insertBefore (first/middle/last), the no-op cases
//     (append an already-last child, insert before itself / its current next
//     sibling) and DocumentFragment splicing (children move, the fragment is
//     emptied, an empty fragment is a no-op);
//   - failure paths leave the tree byte-for-byte unchanged: illegal hierarchy
//     (a node into itself, an ancestor into a descendant, a fragment into one
//     of its own descendants) and a wrong reference node (a live node that is
//     not a child of the parent, or a detached node);
//   - cross-document handles are rejected with ERR_MAD_DOM_WRONG_DOCUMENT and
//     never corrupt either document;
//   - wrapper identity: a moved/inserted node reads back as one and the same JS
//     object through every navigation read (T20 weak per-document wrapper cache
//     via wrap_node);
//   - destroyed documents fail every mutation per T21 with
//     ERR_MAD_DOM_DOCUMENT_DESTROYED;
//   - no duplicate symbols: the native surface stays exactly the audited
//     T19/T20 handle surface — mutation_insert_api adds no export, and the
//     append/insert family exists only on DocumentHandle (the remove/replace
//     family is T24B's).
//
// The contract fixture (tests/bun/fixtures/native-mutation-insert.contract.json)
// is the frozen, machine-readable native contract T24C depends on; the first
// block validates the live module against it. Like the other native tests these
// need the locally built artifact (`npm run dev:build`, or MAD_DOM_NATIVE_PATH
// pointing at one); without it they skip so a clean checkout still passes
// `npm run validate`.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/native-mutation-insert.contract.json", import.meta.url),
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

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// Snapshot of a parent's live child list, preserving wrapper identity so a
// "tree unchanged" assertion can compare strict object equality.
function childSnapshot(parent) {
  return parent.childNodes();
}

// Same-snapshot comparison: same length and the same wrapper object at each
// position (identity, not deep equality).
function expectSameChildren(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i], `child at index ${i} must keep its wrapper identity`).toBe(expected[i]);
  }
}

describe.skipIf(!nativeAvailable)("native append/insert mutation contract (T24A)", () => {
  const native = loadNative();

  test("the contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/native-mutation-insert-contract/1");
    expect(contract.owner).toBe("T24A");
    expect(contract.gate).toBe("T24");
    expect(contract.status).toBe("frozen");
    expect(contract.frozenFor).toEqual(["T24B", "T24C"]);
    expect(contract.base).toBe("native-node-contract.json");

    const methods = contract.classes.DocumentHandle.methods;
    expect(methods).toHaveProperty("appendChild");
    expect(methods).toHaveProperty("insertBefore");

    expect(contract.coverage.detached).toContain("detached");
    expect(contract.coverage.documentFragment).toContain("DocumentFragment");
    expect(contract.coverage.wrongReference).toContain("ERR_MAD_DOM_HIERARCHY");
    expect(contract.delegation.noBindingTreeRules).toContain("mad-dom-core");
    expect(contract.documentContext.documentAccess).toContain("with_document");
    expect(contract.errors.destroyed.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    expect(contract.errors.hierarchy.code).toBe("ERR_MAD_DOM_HIERARCHY");
  });

  test("the native surface matches the frozen contract with no duplicate symbols", () => {
    // The frozen append/insert methods exist exactly once on the native
    // DocumentHandle — mutation_insert_api adds no export, so nothing is
    // duplicated.
    const documentProto = native.DocumentHandle.prototype;
    for (const name of Object.keys(contract.classes.DocumentHandle.methods)) {
      expect(typeof documentProto[name], `${name} must exist on DocumentHandle`).toBe("function");
    }

    // The append/insert family is DocumentHandle-only: NodeHandle carries no
    // mutation symbol, so there is exactly one appendChild/insertBefore in the
    // whole native surface.
    const nodeProto = native.NodeHandle.prototype;
    expect(nodeProto.appendChild).toBeUndefined();
    expect(nodeProto.insertBefore).toBeUndefined();

    // ABI pin: the module-level export surface is unchanged from the audited
    // T19/T20/T22/T23 shape (extended by T37: createEvent / EventHandle; by
    // T41: createMutationObserver / deliverObserverRecords /
    // registerObserverScheduler and the MutationObserverHandle /
    // MutationRecordHandle classes) (creating or renaming a module export breaks this).
    expect(Object.keys(native).sort()).toEqual([
      "DocumentHandle",
      "EventHandle",
      "MutationObserverHandle",
      "MutationRecordHandle",
      "NodeHandle",
      "NodeIteratorHandle",
      "TreeWalkerHandle",
      "WindowHandle",
      "abiVersion",
      "bindingIdentity",
      "createDocument",
      "createEvent",
      "createMutationObserver",
      "createWindow",
      "deliverObserverRecords",
      "liveDocumentCount",
      "registerObserverScheduler",
    ]);
  });

  test("appendChild appends a detached node and returns undefined", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    const text = doc.createText("first");

    expect(parent.childNodes()).toEqual([]);
    expect(doc.appendChild(parent, a)).toBeUndefined();
    expect(doc.appendChild(a, text)).toBeUndefined();

    expect(parent.firstChild()).toBe(a);
    expect(parent.lastChild()).toBe(a);
    expect(parent.childNodes()).toEqual([a]);
    expect(a.parentNode()).toBe(parent);
    expect(a.childNodes()).toEqual([text]);
    expect(text.parentNode()).toBe(a);

    doc.destroy();
  });

  test("navigation after mutation returns stable wrapper identity", () => {
    const doc = native.createDocument();
    const ul = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    const label = doc.createText("first");
    doc.appendChild(a, label);
    doc.appendChild(ul, a);
    doc.appendChild(ul, b);

    // The moved/inserted nodes read back as one and the same JS object.
    expect(ul.firstChild()).toBe(a);
    expect(ul.firstChild()).toBe(ul.firstChild());
    expect(ul.lastChild()).toBe(b);
    expect(a.parentNode()).toBe(ul);
    expect(label.parentNode()).toBe(a);
    expect(a.childNodes()[0]).toBe(label);

    const kids = ul.childNodes();
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(a);
    expect(kids[1]).toBe(b);
    expect(ul.childNodes()[1]).toBe(b);

    doc.destroy();
  });

  test("appendChild moves a node from one parent to another", () => {
    const doc = native.createDocument();
    const parentA = doc.createElement("div");
    const parentB = doc.createElement("section");
    const child = doc.createElement("span");
    doc.appendChild(parentA, child);

    doc.appendChild(parentB, child);

    expect(child.parentNode()).toBe(parentB);
    expect(parentA.childNodes()).toEqual([]);
    expect(parentA.firstChild()).toBeNull();
    expect(parentB.firstChild()).toBe(child);
    expect(parentB.childNodes()).toEqual([child]);

    // The moved wrapper is still the same JS object (no new wrapper was minted).
    expect(parentB.firstChild()).toBe(child);

    doc.destroy();
  });

  test("appending an already-last child is a no-op", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    const before = childSnapshot(parent);

    doc.appendChild(parent, b);

    expectSameChildren(parent.childNodes(), before);
    expect(parent.lastChild()).toBe(b);
    doc.destroy();
  });

  test("insertBefore inserts at first and middle positions and returns undefined", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    const d = doc.createElement("d");
    doc.appendChild(parent, b);
    doc.appendChild(parent, c);

    expect(doc.insertBefore(parent, a, b)).toBeUndefined(); // first
    expect(parent.firstChild()).toBe(a);
    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["a", "b", "c"]);

    expect(doc.insertBefore(parent, d, c)).toBeUndefined(); // middle
    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["a", "b", "d", "c"]);

    doc.destroy();
  });

  test("insertBefore reorders children and moves across parents", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    doc.appendChild(parent, a);
    doc.appendChild(parent, c);

    // Move b (detached) before c: [a, b, c].
    doc.insertBefore(parent, b, c);
    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["a", "b", "c"]);
    expect(b.previousSibling()).toBe(a);
    expect(b.nextSibling()).toBe(c);

    // Reorder b to the head: [b, a, c].
    doc.insertBefore(parent, b, a);
    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["b", "a", "c"]);
    expect(parent.firstChild()).toBe(b);
    expect(b.nextSibling()).toBe(a);
    expect(a.previousSibling()).toBe(b);

    doc.destroy();
  });

  test("insertBefore no-ops for before-itself and already-in-place", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    doc.appendChild(parent, c);
    const before = childSnapshot(parent);

    doc.insertBefore(parent, b, b); // child before itself: no-op
    doc.insertBefore(parent, a, b); // already immediately before reference: no-op

    expectSameChildren(parent.childNodes(), before);
    doc.destroy();
  });

  test("appendChild splices a DocumentFragment and empties it", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const frag = doc.createDocumentFragment();
    const x = doc.createElement("x");
    const y = doc.createElement("y");
    doc.appendChild(frag, x);
    doc.appendChild(frag, y);

    doc.appendChild(parent, frag);

    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["x", "y"]);
    expect(frag.childNodes()).toEqual([]);
    expect(frag.firstChild()).toBeNull();
    expect(frag.lastChild()).toBeNull();
    expect(x.parentNode()).toBe(parent);
    expect(y.parentNode()).toBe(parent);

    doc.destroy();
  });

  test("insertBefore splices a DocumentFragment before the reference", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const c = doc.createElement("c");
    const frag = doc.createDocumentFragment();
    const p = doc.createElement("p");
    doc.appendChild(parent, a);
    doc.appendChild(parent, c);
    doc.appendChild(frag, p);

    doc.insertBefore(parent, frag, c);

    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["a", "p", "c"]);
    expect(frag.childNodes()).toEqual([]);
    expect(p.parentNode()).toBe(parent);
    expect(p.previousSibling()).toBe(a);
    expect(p.nextSibling()).toBe(c);

    doc.destroy();
  });

  test("appending an empty DocumentFragment is a no-op", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const frag = doc.createDocumentFragment();
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    const before = childSnapshot(parent);

    doc.appendChild(parent, frag);

    expectSameChildren(parent.childNodes(), before);
    expect(frag.childNodes()).toEqual([]);
    doc.destroy();
  });

  test("illegal hierarchy is rejected without changing the tree", () => {
    const doc = native.createDocument();
    const div = doc.createElement("div");

    // A node into itself.
    const selfErr = thrown(() => doc.appendChild(div, div));
    expect(selfErr).toBeInstanceOf(Error);
    expect(selfErr.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(selfErr.message).toContain("HierarchyRequestError");
    expect(div.childNodes()).toEqual([]);
    expect(div.parentNode()).toBeNull();

    // An ancestor into its own descendant.
    const outer = doc.createElement("outer");
    const mid = doc.createElement("mid");
    const inner = doc.createElement("inner");
    doc.appendChild(outer, mid);
    doc.appendChild(mid, inner);
    const innerBefore = childSnapshot(inner);

    const cycleErr = thrown(() => doc.appendChild(inner, outer));
    expect(cycleErr).toBeInstanceOf(Error);
    expect(cycleErr.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expectSameChildren(inner.childNodes(), innerBefore);
    expect(inner.parentNode()).toBe(mid);
    expect(mid.parentNode()).toBe(outer);

    // A fragment into one of its own descendants (fragment child is the parent).
    const frag = doc.createDocumentFragment();
    const p = doc.createElement("p");
    doc.appendChild(frag, p);
    const fragBefore = childSnapshot(frag);

    const fragErr = thrown(() => doc.appendChild(p, frag));
    expect(fragErr).toBeInstanceOf(Error);
    expect(fragErr.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expectSameChildren(frag.childNodes(), fragBefore);
    expect(p.parentNode()).toBe(frag);

    doc.destroy();
  });

  test("a wrong reference node is rejected without changing the tree", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const child = doc.createElement("child");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    const before = childSnapshot(parent);

    // A live node that is not a child of the parent.
    const other = doc.createElement("other");
    const wrongLiveErr = thrown(() => doc.insertBefore(parent, child, other));
    expect(wrongLiveErr).toBeInstanceOf(Error);
    expect(wrongLiveErr.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expectSameChildren(parent.childNodes(), before);

    // A detached node as the reference.
    const detachedRef = doc.createElement("ref");
    const detachedErr = thrown(() => doc.insertBefore(parent, child, detachedRef));
    expect(detachedErr).toBeInstanceOf(Error);
    expect(detachedErr.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expectSameChildren(parent.childNodes(), before);

    // child stays detached and the tree is untouched.
    expect(child.parentNode()).toBeNull();
    expect(parent.childNodes().map((n) => n.nodeName())).toEqual(["a", "b"]);

    doc.destroy();
  });

  test("cross-document handles are rejected and never corrupt either document", () => {
    const docA = native.createDocument();
    const docB = native.createDocument();
    const elA = docA.createElement("from-a");
    const targetB = docB.createElement("from-b");
    const refB = docB.createElement("ref-b");
    docB.appendChild(targetB, refB);
    const beforeA = childSnapshot(elA);
    const beforeB = childSnapshot(targetB);

    // appendChild with a foreign child.
    const appendErr = thrown(() => docB.appendChild(targetB, elA));
    expect(appendErr).toBeInstanceOf(Error);
    expect(appendErr.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(appendErr.message).toContain("WrongDocumentError");

    // insertBefore with a foreign child and a foreign reference.
    const insertErr = thrown(() => docB.insertBefore(targetB, elA, refB));
    expect(insertErr).toBeInstanceOf(Error);
    expect(insertErr.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");

    const refErr = thrown(() => docB.insertBefore(targetB, docB.createElement("new"), elA));
    expect(refErr).toBeInstanceOf(Error);
    expect(refErr.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");

    // Neither document changed; navigation stays confined per document.
    expectSameChildren(elA.childNodes(), beforeA);
    expectSameChildren(targetB.childNodes(), beforeB);
    expect(elA.nodeName()).toBe("from-a");
    expect(elA.parentNode()).toBeNull();

    docA.destroy();
    docB.destroy();
  });

  test("destroyed documents fail every mutation per T21", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const child = doc.createElement("span");
    const ref = doc.createElement("ref");
    doc.appendChild(parent, ref);
    doc.destroy();

    const calls = [
      () => doc.appendChild(parent, child),
      () => doc.insertBefore(parent, child, ref),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every mutation on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(thrown(() => doc.appendChild(parent, child)).message).toBe(
      "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
    );

    // Destroy is idempotent and never crashes.
    doc.destroy();
    expect(thrown(() => doc.insertBefore(parent, child, ref)).code).toBe(
      "ERR_MAD_DOM_DOCUMENT_DESTROYED",
    );
  });

  test("a lone node wrapper keeps its document's arena alive under GC after mutation", async () => {
    const drainEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
    const collectGarbage = async () => {
      Bun.gc(true);
      await drainEventLoop();
    };
    await collectGarbage();
    const before = liveDocumentCount();

    let survivor = null;
    const spawn = () => {
      const doc = native.createDocument();
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
    await collectGarbage();

    expect(liveDocumentCount()).toBe(before + 1);
    expect(readSurvivor(survivor)).toEqual({ type: 1, name: "li", parentName: "ul" });

    survivor = null;
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });
});
