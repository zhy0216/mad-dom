import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNativeAvailable } from "../../index.js";

// T24B native remove/replace mutation contract tests.
//
// They exercise the frozen native contract (audited and pinned in
// crates/mad-dom-bun/src/extensions/mutation_remove_api.rs) through the locally
// built artifact (build/mad-dom.node) and cover the acceptance criteria:
//
//   - removeChild / replaceChild convert arguments, return `void` (undefined)
//     and propagate errors through the T21 error/affinity wiring protocol —
//     no tree rule is re-implemented and no second DOM state is kept;
//   - detach semantics: the removed node becomes detached (parent/sibling reads
//     return null) but stays live in the arena with its subtree and can be
//     re-inserted; navigation around the gap updates correctly;
//   - wrong references and illegal hierarchy fail with the frozen
//     ERR_MAD_DOM_HIERARCHY error (a detached child, a child of another parent,
//     parent-itself/ancestor replacements);
//   - cross-document handles are rejected with ERR_MAD_DOM_WRONG_DOCUMENT and
//     never corrupt per-document navigation;
//   - failure atomicity: every failed call leaves the tree byte-for-byte
//     unchanged;
//   - object identity: the removed/replaced node keeps the wrapper minted by
//     the per-document weak cache, so re-reading or re-inserting it hands back
//     one and the same JS object;
//   - destroyed documents fail removeChild / replaceChild per T21 with
//     ERR_MAD_DOM_DOCUMENT_DESTROYED (dangling handles);
//   - no duplicate symbols: the native surface stays exactly the audited
//     T19/T20 handle surface — mutation_remove_api adds no export and no
//     NodeHandle-level duplicate exists.
//
// The contract fixture (tests/bun/fixtures/native-mutation-remove-contract.json)
// is the frozen, machine-readable native contract T24C depends on; the first
// block validates the live module against it. Like the other native tests these
// need the locally built artifact (`npm run dev:build`, or MAD_DOM_NATIVE_PATH
// pointing at one); without it they skip so a clean checkout still passes
// `npm run validate`.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/native-mutation-remove-contract.json", import.meta.url),
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

describe.skipIf(!nativeAvailable)("native remove/replace mutation contract (T24B)", () => {
  const native = loadNative();

  // The ordered child *names* of `node` — a robust, identity-free way to assert
  // the child list (native wrappers have no enumerable own properties, so
  // deep-equality on the wrapper array would not distinguish handles).
  function childNames(node) {
    return node.childNodes().map((handle) => handle.nodeName());
  }

  test("the contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/native-mutation-remove-contract/1");
    expect(contract.owner).toBe("T24B");
    expect(contract.gate).toBe("T24");
    expect(contract.status).toBe("frozen");
    expect(contract.frozenFor).toEqual(["T24C"]);
    expect(contract.base).toBe("native-node-contract.json");

    const methods = contract.classes.DocumentHandle.methods;
    expect(methods).toHaveProperty("removeChild");
    expect(methods).toHaveProperty("replaceChild");

    expect(contract.identity.rule).toContain("wrap_node");
    expect(contract.delegation.rule).toContain("with_document");
    expect(contract.errors.hierarchy.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(contract.errors.crossDocument.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(contract.errors.destroyed.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("the native surface matches the frozen contract with no duplicate symbols", () => {
    // The frozen remove/replace methods exist exactly once on the native
    // DocumentHandle — mutation_remove_api adds no export, so nothing is
    // duplicated. They live on DocumentHandle only: no NodeHandle-level
    // duplicate exists for the facade to bind `this` to.
    const documentProto = native.DocumentHandle.prototype;
    for (const name of Object.keys(contract.classes.DocumentHandle.methods)) {
      expect(typeof documentProto[name], `${name} must exist on DocumentHandle`).toBe("function");
    }
    expect(native.NodeHandle.prototype.removeChild).toBeUndefined();
    expect(native.NodeHandle.prototype.replaceChild).toBeUndefined();

    // ABI pin: the module-level export surface is unchanged from the audited
    // T19/T20/T22/T23 shape (extended by T37: createEvent / EventHandle) (creating or renaming a module export breaks this).
    expect(Object.keys(native).sort()).toEqual([
      "DocumentHandle",
      "EventHandle",
      "NodeHandle",
      "NodeIteratorHandle",
      "TreeWalkerHandle",
      "WindowHandle",
      "abiVersion",
      "bindingIdentity",
      "createDocument",
      "createEvent",
      "createWindow",
      "liveDocumentCount",
    ]);
  });

  test("removeChild removes a child, returns void, and detaches it with its subtree", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    const label = doc.createText("first");
    doc.appendChild(a, label);
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    expect(doc.removeChild(parent, a)).toBeUndefined();
    expect(childNames(parent)).toEqual(["li"]);
    expect(parent.firstChild()).toBe(b);
    expect(parent.lastChild()).toBe(b);

    // The removed node is detached but stays live with its subtree.
    expect(a.parentNode()).toBeNull();
    expect(a.previousSibling()).toBeNull();
    expect(a.nextSibling()).toBeNull();
    expect(label.parentNode()).toBe(a);
    expect(label.nodeName()).toBe("#text");

    // A detached node can be re-inserted, carrying its subtree.
    doc.appendChild(parent, a);
    expect(childNames(parent)).toEqual(["li", "li"]);
    expect(a.parentNode()).toBe(parent);
    expect(label.parentNode()).toBe(a);

    doc.destroy();
  });

  test("removeChild of first, middle and last child keeps the sibling chain intact", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    doc.appendChild(parent, c);

    // Middle.
    doc.removeChild(parent, b);
    expect(childNames(parent)).toEqual(["a", "c"]);
    expect(a.nextSibling()).toBe(c);
    expect(c.previousSibling()).toBe(a);

    // First.
    doc.removeChild(parent, a);
    expect(childNames(parent)).toEqual(["c"]);
    expect(parent.firstChild()).toBe(c);
    expect(parent.lastChild()).toBe(c);
    expect(c.previousSibling()).toBeNull();

    // Last (only) child leaves the parent empty.
    doc.removeChild(parent, c);
    expect(childNames(parent)).toEqual([]);
    expect(parent.firstChild()).toBeNull();
    expect(parent.lastChild()).toBeNull();

    doc.destroy();
  });

  test("replaceChild swaps a child for a new node, returning void and detaching the old child", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    doc.appendChild(parent, c);

    const d = doc.createElement("d");
    expect(doc.replaceChild(parent, b, d)).toBeUndefined();
    expect(childNames(parent)).toEqual(["a", "d", "c"]);
    expect(d.parentNode()).toBe(parent);
    expect(a.nextSibling()).toBe(d);
    expect(c.previousSibling()).toBe(d);

    // The replaced child is detached.
    expect(b.parentNode()).toBeNull();
    expect(b.previousSibling()).toBeNull();
    expect(b.nextSibling()).toBeNull();

    doc.destroy();
  });

  test("replaceChild moves a node from another parent", () => {
    const doc = native.createDocument();
    const parent1 = doc.createElement("div");
    const parent2 = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const c = doc.createElement("c");
    doc.appendChild(parent1, a);
    doc.appendChild(parent1, b);
    doc.appendChild(parent2, c);

    doc.replaceChild(parent1, a, c);
    expect(childNames(parent1)).toEqual(["c", "b"]);
    expect(childNames(parent2)).toEqual([]);
    expect(c.parentNode()).toBe(parent1);
    expect(a.parentNode()).toBeNull();

    doc.destroy();
  });

  test("replacing a node with itself is a no-op", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    doc.replaceChild(parent, a, a);
    expect(childNames(parent)).toEqual(["a", "b"]);
    expect(a.parentNode()).toBe(parent);
    expect(b.parentNode()).toBe(parent);

    doc.destroy();
  });

  test("replacing a child with a DocumentFragment splices its children and empties the fragment", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const frag = doc.createDocumentFragment();
    const x = doc.createElement("x");
    const y = doc.createElement("y");
    doc.appendChild(parent, a);
    doc.appendChild(frag, x);
    doc.appendChild(frag, y);

    doc.replaceChild(parent, a, frag);
    expect(childNames(parent)).toEqual(["x", "y"]);
    expect(x.parentNode()).toBe(parent);
    expect(y.parentNode()).toBe(parent);
    // The fragment is emptied and never becomes a child.
    expect(childNames(frag)).toEqual([]);
    expect(frag.parentNode()).toBeNull();
    expect(a.parentNode()).toBeNull();

    doc.destroy();
  });

  test("replacing a child with an empty DocumentFragment removes the child", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const empty = doc.createDocumentFragment();
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    doc.replaceChild(parent, a, empty);
    expect(childNames(parent)).toEqual(["b"]);
    expect(a.parentNode()).toBeNull();

    doc.destroy();
  });

  test("removeChild with a detached child or a child of another parent fails with the frozen hierarchy error", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const detached = doc.createElement("detached");
    const otherParent = doc.createElement("other");
    const childOfOther = doc.createElement("kid");
    doc.appendChild(parent, doc.createElement("a"));
    doc.appendChild(otherParent, childOfOther);

    for (const badChild of [detached, childOfOther]) {
      const err = thrown(() => doc.removeChild(parent, badChild));
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(err.message).toContain("HierarchyRequestError");
    }

    // Failure atomicity: the tree is unchanged by the rejected calls.
    expect(childNames(parent)).toEqual(["a"]);
    expect(childNames(otherParent)).toEqual(["kid"]);

    doc.destroy();
  });

  test("replaceChild with an invalid child or an illegal hierarchy fails atomically", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    const detached = doc.createElement("detached");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);

    // child is not a child of parent.
    let err = thrown(() => doc.replaceChild(parent, detached, b));
    expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(err.message).toContain("HierarchyRequestError");

    // node is parent itself.
    err = thrown(() => doc.replaceChild(parent, a, parent));
    expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");

    // node is an ancestor of parent.
    const root = doc.createElement("root");
    doc.appendChild(root, parent);
    err = thrown(() => doc.replaceChild(parent, a, root));
    expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");

    // Failure atomicity: every rejected call leaves the tree unchanged.
    expect(childNames(parent)).toEqual(["a", "b"]);
    expect(a.parentNode()).toBe(parent);
    expect(b.parentNode()).toBe(parent);
    expect(childNames(root)).toEqual(["div"]);

    doc.destroy();
  });

  test("cross-document removeChild / replaceChild are rejected and never corrupt navigation", () => {
    const docA = native.createDocument();
    const docB = native.createDocument();
    const parentA = docA.createElement("from-a");
    const a = docA.createElement("a");
    const b = docA.createElement("b");
    docA.appendChild(parentA, a);
    docA.appendChild(parentA, b);

    const foreignParent = docB.createElement("from-b");
    const foreignChild = docB.createElement("foreign");
    docB.appendChild(foreignParent, foreignChild);

    let err = thrown(() => docA.removeChild(foreignParent, a));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(err.message).toContain("WrongDocumentError");

    err = thrown(() => docA.removeChild(parentA, foreignChild));
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");

    err = thrown(() => docB.replaceChild(foreignParent, a, foreignChild));
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");

    // Navigation stays confined to each node's owning document, unchanged.
    expect(childNames(parentA)).toEqual(["a", "b"]);
    expect(a.parentNode()).toBe(parentA);
    expect(childNames(foreignParent)).toEqual(["foreign"]);
    expect(foreignChild.parentNode()).toBe(foreignParent);

    docA.destroy();
    docB.destroy();
  });

  test("removed and replaced nodes keep stable wrapper identity", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    doc.appendChild(parent, a);

    // The removed node is one and the same wrapper before and after removal.
    expect(a.parentNode()).toBe(parent);
    doc.removeChild(parent, a);
    expect(a.parentNode()).toBeNull();
    expect(a.nodeName()).toBe("a");
    doc.appendChild(parent, a);
    expect(a.parentNode()).toBe(parent);
    expect(childNames(parent)).toEqual(["a"]);

    // Replace keeps the replacement wrapper identical across reads.
    const c = doc.createElement("c");
    const d = doc.createElement("d");
    doc.replaceChild(parent, a, c);
    expect(c.parentNode()).toBe(parent);
    expect(c.parentNode()).toBe(c.parentNode());
    expect(childNames(parent)).toEqual(["c"]);
    doc.replaceChild(parent, c, d);
    expect(c.parentNode()).toBeNull();
    expect(c.nodeName()).toBe("c");

    doc.destroy();
  });

  test("destroyed documents fail every remove/replace call per T21", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    doc.destroy();

    const calls = [
      () => doc.removeChild(parent, a),
      () => doc.replaceChild(parent, a, b),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every remove/replace on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(thrown(() => doc.removeChild(parent, a)).message).toBe(
      "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
    );

    // Destroy is idempotent and never crashes.
    doc.destroy();
    expect(thrown(() => doc.replaceChild(parent, a, b)).code).toBe(
      "ERR_MAD_DOM_DOCUMENT_DESTROYED",
    );
  });
});
