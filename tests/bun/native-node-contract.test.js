import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNativeAvailable } from "../../index.js";

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
    expect(contract.optionalPerformance.NodeHandle).toHaveProperty(
      "firstChildPair",
    );
    expect(contract.optionalPerformance.NodeHandle).toHaveProperty(
      "nextSiblingChunk",
    );
    expect(contract.optionalPerformance.NodeHandle).toHaveProperty("idAttribute");
    expect(contract.optionalPerformance.NodeHandle).toHaveProperty("classAttribute");
    expect(contract.optionalPerformance.NodeHandle).toHaveProperty(
      "idClassAttributes",
    );
    expect(contract.optionalPerformance.DocumentHandle).toHaveProperty(
      "createElementTokenBatch",
    );
    expect(contract.optionalPerformance.DocumentHandle).toHaveProperty(
      "createElementTokenRange",
    );
    expect(contract.optionalPerformance.DocumentHandle).toHaveProperty(
      "preorderTokenSnapshot",
    );
    expect(contract.optionalPerformance.DocumentHandle).toHaveProperty("nodeToken");

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
    for (const name of Object.keys(contract.optionalPerformance.DocumentHandle)) {
      expect(typeof documentProto[name], `${name} must exist on DocumentHandle`).toBe("function");
    }

    const nodeProto = native.NodeHandle.prototype;
    for (const name of Object.keys(contract.classes.NodeHandle.methods)) {
      expect(typeof nodeProto[name], `${name} must exist on NodeHandle`).toBe("function");
    }
    for (const name of Object.keys(contract.optionalPerformance.NodeHandle)) {
      expect(typeof nodeProto[name], `${name} must exist on NodeHandle`).toBe("function");
    }

    // The WHATWG name createTextNode is a facade adaptation, deliberately NOT a
    // native symbol — a native duplicate of createText would violate the
    // "no duplicate symbols" rule.
    expect(documentProto.createTextNode).toBeUndefined();

    // ABI pin: the module-level export surface is unchanged from the audited
    // T19/T20/T22 shape (extended by T37: createEvent / EventHandle; by T35:
    // the TreeWalkerHandle / NodeIteratorHandle classes; by T41:
    // createMutationObserver / deliverObserverRecords / registerObserverScheduler
    // and the MutationObserverHandle / MutationRecordHandle classes; by T36:
    // the RangeHandle / SelectionHandle classes; by T42: defineCustomElement /
    // upgradeCustomElements / markCustomElementsInSubtree /
    // listCustomElementCandidates / takeCustomElementReactions / documentRootNode
    // and the CustomElementReactionHandle class) (creating or renaming a module
    // export breaks this).
    expect(Object.keys(native).sort()).toEqual([
      "CustomElementReactionHandle",
      "DocumentHandle",
      "EventHandle",
      "MutationObserverHandle",
      "MutationRecordHandle",
      "NodeHandle",
      "NodeIteratorHandle",
      "RangeHandle",
      "SelectionHandle",
      "TreeWalkerHandle",
      "WindowHandle",
      "abiVersion",
      "bindingIdentity",
      "createDocument",
      "createEvent",
      "createMutationObserver",
      "createWindow",
      "defineCustomElement",
      "deliverObserverRecords",
      "documentRootNode",
      "listCustomElementCandidates",
      "liveDocumentCount",
      "markCustomElementsInSubtree",
      "registerObserverScheduler",
      "takeCustomElementReactions",
      "upgradeCustomElements",
    ]);
  });

  test("memoryDiagnostics is an additive numeric array and remains usable after destroy", () => {
    const doc = native.createDocument();
    const before = doc.memoryDiagnostics();
    expect(Array.isArray(before)).toBe(true);
    expect(before).toHaveLength(3);
    for (const value of before) expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
    expect(before[0]).toBe(native.liveDocumentCount());
    const retained = doc.createElement("div");
    const context = doc.ffiContext();
    expect(doc.ffiContext()).toEqual(context);
    expect(doc.memoryDiagnostics()).toEqual([before[0], before[1] + 1, before[2] + 1]);
    doc.destroy();
    doc.destroy();
    expect(doc.memoryDiagnostics()).toEqual([before[0] - 1, before[1] + 1, before[2]]);
    before.fill(0xffffffff); // diagnostics are copies, not exposed atomics
    expect(doc.memoryDiagnostics()[0]).toBe(native.liveDocumentCount());
    expect(() => retained.nodeName()).toThrow(/DOCUMENT_DESTROYED/);
    expect(() => doc.ffiContext()).toThrow(/DOCUMENT_DESTROYED/);
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

  test("the bundled id/class reader preserves null and empty values", () => {
    const doc = native.createDocument();
    try {
      const element = doc.createElement("div");
      expect(element.idClassAttributes()).toEqual([null, null]);
      element.setAttribute("id", "");
      element.setAttribute("class", "item active");
      expect(element.idClassAttributes()).toEqual(["", "item active"]);
    } finally {
      doc.destroy();
    }
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

  test("nextSiblingChunk is bounded and marks only a proven chain end", () => {
    const doc = native.createDocument();
    const parent = doc.createElement("div");
    const children = Array.from({ length: 40 }, () => doc.createElement("i"));
    for (const child of children) doc.appendChild(parent, child);

    const first = children[0].nextSiblingChunk();
    expect(first).toHaveLength(32);
    expect(first[0]).toBe(children[1]);
    expect(first[31]).toBe(children[32]);
    expect(first.includes(null)).toBe(false);

    const final = children[32].nextSiblingChunk();
    expect(final).toHaveLength(8);
    expect(final.slice(0, -1)).toEqual(children.slice(33));
    expect(final.at(-1)).toBeNull();

    expect(children[39].nextSiblingChunk()).toEqual([null]);
    doc.destroy();
  });

  test("firstChildPair speculates at most one sibling and marks a proven end", () => {
    const doc = native.createDocument();
    const empty = doc.createElement("div");
    const parent = doc.createElement("div");
    const children = Array.from({ length: 3 }, () => doc.createElement("i"));
    for (const child of children) doc.appendChild(parent, child);

    expect(empty.firstChildPair()).toEqual([null]);
    const pair = parent.firstChildPair();
    expect(pair).toHaveLength(2);
    expect(pair).toEqual(children.slice(0, 2));
    expect(pair.includes(null)).toBe(false);

    const short = doc.createElement("div");
    doc.appendChild(short, children[2]);
    expect(short.firstChildPair()).toEqual([children[2], null]);

    const exact = doc.createElement("div");
    const a = doc.createElement("a");
    const b = doc.createElement("b");
    doc.appendChild(exact, a);
    doc.appendChild(exact, b);
    expect(exact.firstChildPair()).toEqual([a, b, null]);
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
      () => div.firstChildPair(),
      () => div.lastChild(),
      () => div.previousSibling(),
      () => div.nextSibling(),
      () => div.nextSiblingChunk(),
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

  test("a lone node wrapper keeps its document's arena alive under GC", () => {
    // Other suites may leave deferred finalizers pending. A child process
    // gives this ownership assertion its own exact baseline, on the same Bun
    // and native image as the parent, instead of weakening the live count.
    const fixture = fileURLToPath(new URL("./fixtures/native-gc-lifetime.mjs", import.meta.url));
    const result = Bun.spawnSync([process.execPath, fixture], {
      env: { ...process.env, MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node") },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.bunVersion).toBe(Bun.version);
    expect(report.baseline).toEqual([0, 0, 0]);
    expect(report.retained).toEqual([1, 1, 1]);
    expect(report.released).toEqual(report.baseline);
  });
});
