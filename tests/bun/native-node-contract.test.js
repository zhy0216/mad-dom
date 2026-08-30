import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNativeAvailable, liveDocumentCount } from "../../index.js";

// T23A native node creation and navigation contract tests.
//
// They exercise the frozen native contract (audited and pinned in
// crates/mad-dom-bun/src/extensions/node_api.rs) through the locally built
// artifact (build/mad-dom.node) and cover the acceptance criteria:
//
//   - createElement / createText (the native implementation of the WHATWG
//     document.createTextNode) mint detached Element / Text nodes with the
//     frozen nodeType / nodeName results;
//   - the parent/child/sibling navigation methods hand back *stable wrapper
//     identity*: while a wrapper is alive, repeated reads of the same node are
//     strictly equal (T20 weak per-document wrapper cache via wrap_node);
//   - detached nodes, empty relations and distinct creates behave as frozen;
//   - cross-document handles are rejected on mutation with
//     ERR_MAD_DOM_WRONG_DOCUMENT and never corrupt per-document navigation;
//   - destroyed documents fail every creation and navigation read per T21 with
//     ERR_MAD_DOM_DOCUMENT_DESTROYED (dangling handles);
//   - no duplicate symbols: the native surface stays exactly the audited
//     T19/T20 handle surface — node_api adds no export, and the WHATWG name
//     createTextNode is deliberately absent natively (the facade adapts it);
//   - a lone surviving node wrapper keeps its document's arena alive under GC.
//
// The contract fixture (tests/bun/fixtures/native-node-contract.json) is the
// frozen, machine-readable native contract T23B depends on; the first block
// validates the live module against it. Like the other native tests these need
// the locally built artifact (`npm run dev:build`, or MAD_DOM_NATIVE_PATH
// pointing at one); without it they skip so a clean checkout still passes
// `npm run validate`.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/native-node-contract.json", import.meta.url),
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

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.skipIf(!nativeAvailable)("native node creation and navigation contract (T23A)", () => {
  const native = loadNative();

  test("the contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/native-node-contract/1");
    expect(contract.owner).toBe("T23A");
    expect(contract.gate).toBe("T23");
    expect(contract.status).toBe("frozen");
    expect(contract.frozenFor).toEqual(["T23B"]);
    expect(contract.base).toBe("native-window-document.contract.json");

    const creation = contract.creation.DocumentHandle;
    expect(creation).toHaveProperty("createElement");
    expect(creation).toHaveProperty("createText");

    const methods = contract.classes.NodeHandle.methods;
    expect(methods).toHaveProperty("nodeType");
    expect(methods).toHaveProperty("nodeName");
    expect(methods).toHaveProperty("parentNode");
    expect(methods).toHaveProperty("firstChild");
    expect(methods).toHaveProperty("lastChild");
    expect(methods).toHaveProperty("previousSibling");
    expect(methods).toHaveProperty("nextSibling");
    expect(methods).toHaveProperty("childNodes");

    expect(contract.identity.rule).toContain("wrap_node");
    expect(contract.documentContext.documentAccess).toContain("with_document");
    expect(contract.errors.destroyed.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("the native surface matches the frozen contract with no duplicate symbols", () => {
    // The frozen creation/navigation methods exist exactly once on the native
    // classes — node_api adds no export, so nothing is duplicated.
    const documentProto = native.DocumentHandle.prototype;
    for (const name of Object.keys(contract.creation.DocumentHandle)) {
      expect(typeof documentProto[name], `${name} must exist on DocumentHandle`).toBe("function");
    }

    const nodeProto = native.NodeHandle.prototype;
    for (const name of Object.keys(contract.classes.NodeHandle.methods)) {
      expect(typeof nodeProto[name], `${name} must exist on NodeHandle`).toBe("function");
    }

    // The WHATWG name createTextNode is a facade adaptation, deliberately NOT a
    // native symbol — a native duplicate of createText would violate the
    // "no duplicate symbols" rule.
    expect(documentProto.createTextNode).toBeUndefined();

    // ABI pin: the module-level export surface is unchanged from the audited
    // T19/T20/T22 shape (extended by T37: createEvent / EventHandle; by T35:
    // the TreeWalkerHandle / NodeIteratorHandle classes) (creating or renaming
    // a module export breaks this).
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

  test("createElement / createText mint detached Element and Text with frozen type and name", () => {
    const doc = native.createDocument();
    const div = doc.createElement("div");
    const text = doc.createText("hello");

    expect(div.constructor.name).toBe("NodeHandle");
    expect(div.nodeType()).toBe(1);
    expect(div.nodeName()).toBe("div");

    expect(text.constructor.name).toBe("NodeHandle");
    expect(text.nodeType()).toBe(3);
    expect(text.nodeName()).toBe("#text");

    // Detached: no parent, no children, no siblings.
    expect(div.parentNode()).toBeNull();
    expect(div.childNodes()).toEqual([]);
    expect(div.firstChild()).toBeNull();
    expect(div.lastChild()).toBeNull();
    expect(div.previousSibling()).toBeNull();
    expect(div.nextSibling()).toBeNull();

    expect(text.parentNode()).toBeNull();
    expect(text.firstChild()).toBeNull();
    expect(text.childNodes()).toEqual([]);

    doc.destroy();
  });

  test("each create call mints a distinct node", () => {
    const doc = native.createDocument();
    const a = doc.createElement("div");
    const b = doc.createElement("div");
    const textA = doc.createText("x");
    const textB = doc.createText("x");
    expect(a).not.toBe(b);
    expect(textA).not.toBe(textB);
    expect(textA.nodeName()).toBe(textB.nodeName());
    doc.destroy();
  });

  test("invalid element names throw the frozen error", () => {
    const doc = native.createDocument();
    const err = thrown(() => doc.createElement("1div"));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    expect(err.message).toContain("InvalidCharacterError");
    doc.destroy();
  });

  test("navigation returns stable wrapper identity on repeated reads", () => {
    const doc = native.createDocument();
    const ul = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    const label = doc.createText("first");
    doc.appendChild(a, label);
    doc.appendChild(ul, a);
    doc.appendChild(ul, b);

    // Strict equality on every repeat of the same relationship read.
    expect(ul.firstChild()).toBe(a);
    expect(ul.firstChild()).toBe(ul.firstChild());
    expect(ul.lastChild()).toBe(b);
    expect(ul.lastChild()).toBe(ul.lastChild());
    expect(a.parentNode()).toBe(ul);
    expect(a.parentNode()).toBe(a.parentNode());
    expect(label.parentNode()).toBe(a);
    expect(a.nextSibling()).toBe(b);
    expect(b.previousSibling()).toBe(a);
    expect(label.previousSibling()).toBeNull();
    expect(label.nextSibling()).toBeNull();

    // childNodes hands back the stable wrappers, in order, on every read.
    const kids = ul.childNodes();
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(a);
    expect(kids[1]).toBe(b);
    expect(ul.childNodes()[0]).toBe(a);
    expect(ul.childNodes()[1]).toBe(b);

    // Empty relations.
    expect(b.firstChild()).toBeNull();
    expect(b.lastChild()).toBeNull();
    expect(b.childNodes()).toEqual([]);

    doc.destroy();
  });

  test("cross-document handles are rejected and never corrupt navigation", () => {
    const docA = native.createDocument();
    const docB = native.createDocument();
    const elA = docA.createElement("from-a");
    const targetB = docB.createElement("from-b");

    const err = thrown(() => docB.appendChild(targetB, elA));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(err.message).toContain("WrongDocumentError");

    // Navigation stays confined to each node's owning document.
    expect(elA.nodeName()).toBe("from-a");
    expect(targetB.nodeName()).toBe("from-b");
    expect(elA.parentNode()).toBeNull();
    expect(targetB.parentNode()).toBeNull();

    docA.destroy();
    docB.destroy();
  });

  test("destroyed documents fail every creation and navigation read per T21", () => {
    const doc = native.createDocument();
    const div = doc.createElement("div");
    const text = doc.createText("x");
    doc.appendChild(div, text);
    doc.destroy();

    const calls = [
      () => doc.createElement("span"),
      () => doc.createText("y"),
      () => div.nodeType(),
      () => div.nodeName(),
      () => div.parentNode(),
      () => div.firstChild(),
      () => div.lastChild(),
      () => div.previousSibling(),
      () => div.nextSibling(),
      () => div.childNodes(),
      () => text.nodeName(),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(thrown(() => div.nodeName()).message).toBe(
      "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
    );

    // Destroy is idempotent and never crashes.
    doc.destroy();
    expect(thrown(() => div.childNodes()).code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("a lone node wrapper keeps its document's arena alive under GC", async () => {
    await collectGarbage();
    const before = liveDocumentCount();

    let survivor = null;
    // Reads run in their own function frame (same frame-isolation rationale as
    // gc.test.js): JSC scans the machine stack conservatively, so an inline
    // native call leaves stale register/spill copies that would keep the
    // wrapper alive past the explicit drop below.
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

    // The document wrapper is collected; the lone node wrapper keeps its
    // document's arena alive — and it stays fully readable.
    expect(liveDocumentCount()).toBe(before + 1);
    expect(readSurvivor(survivor)).toEqual({ type: 1, name: "li", parentName: "ul" });

    survivor = null;
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });
});
