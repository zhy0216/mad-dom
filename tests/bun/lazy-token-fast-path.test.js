import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { Window, isNativeAvailable } from "../../index.js";
import {
  hasMaterializedNodeHandle,
  nodeHandleOf,
  nodeTokenOf,
} from "../../js/facade/extensions/classes.js";

const nativeAvailable = isNativeAvailable();
const native = nativeAvailable
  ? createRequire(import.meta.url)(
      fileURLToPath(new URL("../../build/mad-dom.node", import.meta.url)),
    )
  : null;
const LEGACY_BINDING_PROBE = fileURLToPath(
  new URL("./fixtures/lazy-token-legacy-binding-probe.mjs", import.meta.url),
);

function runLegacyBindingProbe(scenario) {
  const proc = Bun.spawnSync([process.execPath, LEGACY_BINDING_PROBE, scenario], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    throw new Error(
      `legacy binding probe ${JSON.stringify(scenario)} failed (exit ${proc.exitCode})` +
        `\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
    );
  }
  const match = stdout.match(/^PROBE (\{.*\})$/m);
  if (match === null) {
    throw new Error(
      `legacy binding probe ${JSON.stringify(scenario)} produced no result` +
        `\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
    );
  }
  return JSON.parse(match[1]);
}

const DESTROYED_EPOCH = -2147483648;
const SNAPSHOT_FRESH_TOKEN_FLAG = 0x80000000;
const SNAPSHOT_DESCRIPTOR_MASK = 0x7fff;
const SNAPSHOT_NAMES = [
  "html", "head", "body", "title", "div", "span", "p", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "table", "caption", "tr", "td", "th", "thead", "tbody", "tfoot",
  "br", "hr", "form", "input", "button", "select", "option",
  "textarea", "label", "img", "script", "style", "link", "meta",
  "blockquote", "q", "slot", "template", "section",
];

describe.skipIf(!nativeAvailable)("document-scoped lazy node tokens", () => {
  test("token creation, writes, materialization and identity share one Core node", () => {
    const document = native.createDocument();
    try {
      const parentToken = document.createElementToken("div");
      const childTokens = document.createElementTokenBatch("span", 3);
      const textToken = document.createTextToken("hello");

      expect(Array.isArray(childTokens)).toBe(true);
      expect(childTokens[1]).toBe(childTokens[0] + 1);
      expect(childTokens[2]).toBe(childTokens[1] + 1);
      expect(new Set([parentToken, ...childTokens, textToken]).size).toBe(5);
      document.setAttributeToken(childTokens[0], "id", "child");
      document.appendChildToken(parentToken, childTokens[0]);
      document.appendChildToken(childTokens[0], textToken);

      const parent = document.materializeNodeToken(parentToken);
      const child = document.materializeNodeToken(childTokens[0]);
      const text = document.materializeNodeToken(textToken);
      expect(parent.madDomToken).toBe(parentToken);
      expect(child.madDomToken).toBe(childTokens[0]);
      expect(text.madDomToken).toBe(textToken);
      expect(document.materializeNodeToken(childTokens[0])).toBe(child);
      expect(parent.firstChild()).toBe(child);
      expect(child.firstChild()).toBe(text);
      expect(child.getAttribute("id")).toBe("child");
      expect(text.textContent()).toBe("hello");
    } finally {
      document.destroy();
    }
  });

  test("tokens are scoped to their document and batches enforce their bound", () => {
    const a = native.createDocument();
    const b = native.createDocument();
    try {
      const aToken = a.createElementToken("div");
      const bToken = b.createElementToken("div");
      expect(aToken).not.toBe(bToken);
      expect(() => b.materializeNodeToken(aToken)).toThrow();
      expect(() => a.materializeNodeToken(bToken)).toThrow();
      expect(() => a.createElementTokenBatch("div", 0)).toThrow();
      expect(() => a.createElementTokenBatch("div", 4097)).toThrow();
      expect(a.createElementTokenBatch("div", 4096)).toHaveLength(4096);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  test("token ranges register every contiguous token without a result array", () => {
    const document = native.createDocument();
    const other = native.createDocument();
    try {
      const start = document.createElementTokenRange("span", 3);
      const tokens = [start, start + 1, start + 2];
      const nodes = tokens.map((token) => document.materializeNodeToken(token));

      expect(nodes.map((node) => node.madDomToken)).toEqual(tokens);
      expect(nodes.map((node) => node.nodeName())).toEqual(["span", "span", "span"]);
      expect(new Set(nodes).size).toBe(3);
      expect(() => other.materializeNodeToken(start)).toThrow();
      expect(() => other.materializeNodeToken(start + 2)).toThrow();

      const maximumStart = document.createElementTokenRange("div", 4096);
      expect(document.materializeNodeToken(maximumStart).nodeName()).toBe("div");
      expect(document.materializeNodeToken(maximumStart + 4095).nodeName()).toBe("div");
      expect(() => document.createElementTokenRange("span", 0)).toThrow();
      expect(() => document.createElementTokenRange("span", 4097)).toThrow();
    } finally {
      document.destroy();
      other.destroy();
    }
  });

  test("compact preorder descriptors stay synchronized with the facade table", () => {
    const document = native.createDocument();
    try {
      const root = document.createElementToken("div");
      const tokens = SNAPSHOT_NAMES.map((name) => document.createElementToken(name));
      for (const token of tokens) document.appendChildToken(root, token);
      const text = document.createTextToken("tail");
      document.appendChildToken(root, text);

      const snapshot = document.preorderTokenSnapshot(root);
      expect(snapshot).toBeInstanceOf(Uint32Array);
      expect(snapshot).toHaveLength(1 + (SNAPSHOT_NAMES.length + 2) * 2);
      expect(snapshot[0]).toBe(0);
      expect(snapshot[1]).toBe(root);
      expect(snapshot[2] >>> 16).toBe(16 + SNAPSHOT_NAMES.indexOf("div"));
      expect(snapshot[2] & 0xffff).toBe(0);
      for (let i = 0; i < SNAPSHOT_NAMES.length; i++) {
        const offset = 1 + (i + 1) * 2;
        expect(snapshot[offset]).toBe(tokens[i]);
        expect(snapshot[offset + 1] >>> 16).toBe(16 + i);
        expect(snapshot[offset + 1] & 0xffff).toBe(1);
      }
      const textPacked = snapshot[snapshot.length - 1];
      expect(textPacked >>> 16).toBe(3);
      expect(textPacked & 0xffff).toBe(1);
    } finally {
      document.destroy();
    }
  });

  test("preorder snapshots flag only tokens assigned by that snapshot", () => {
    const document = native.createDocument();
    try {
      document.parseHtml(
        '<!doctype html><html><head></head><body><div id="seen"><span></span></div><p></p></body></html>',
      );
      const body = document.body();
      const bodyToken = document.nodeToken(body);

      // Enabling tokens through bodyToken means this query stamps and exposes
      // the div token before the snapshot. The span and p remain unexposed.
      const seen = document.querySelector("#seen");
      const seenToken = seen.madDomToken;
      const snapshot = document.preorderTokenSnapshot(bodyToken);
      const pairs = [];
      for (let offset = 1; offset < snapshot.length; offset += 2) {
        const packed = snapshot[offset + 1];
        pairs.push({
          token: snapshot[offset],
          fresh: (packed & SNAPSHOT_FRESH_TOKEN_FLAG) !== 0,
          descriptor: (packed >>> 16) & SNAPSHOT_DESCRIPTOR_MASK,
          depth: packed & 0xffff,
        });
      }

      expect(pairs).toHaveLength(4);
      expect(pairs.map(({ descriptor, depth }) => [descriptor, depth])).toEqual([
        [16 + SNAPSHOT_NAMES.indexOf("body"), 0],
        [16 + SNAPSHOT_NAMES.indexOf("div"), 1],
        [16 + SNAPSHOT_NAMES.indexOf("span"), 2],
        [16 + SNAPSHOT_NAMES.indexOf("p"), 1],
      ]);
      expect(pairs[0]).toMatchObject({ token: bodyToken, fresh: false });
      expect(pairs[1]).toMatchObject({ token: seenToken, fresh: false });
      expect(pairs[2].fresh).toBe(true);
      expect(pairs[3].fresh).toBe(true);
    } finally {
      document.destroy();
    }
  });

  test("structural and attribute epoch views change independently and terminate", () => {
    const document = native.createDocument();
    const structure = new Int32Array(document.epochView());
    const attributes = new Int32Array(document.attributeEpochView());
    const parent = document.createElement("div");
    const child = document.createElement("span");

    const structure0 = structure[0];
    const attributes0 = attributes[0];
    child.setAttribute("class", "a");
    expect(attributes[0]).toBe(attributes0 + 1);
    expect(structure[0]).toBe(structure0);
    const attributes1 = attributes[0];
    child.removeAttribute("missing");
    expect(attributes[0]).toBe(attributes1);
    document.appendChild(parent, child);
    expect(structure[0]).toBe(structure0 + 1);
    expect(attributes[0]).toBe(attributes1);

    document.destroy();
    expect(structure[0]).toBe(DESTROYED_EPOCH);
    expect(attributes[0]).toBe(DESTROYED_EPOCH);
  });

  test("destroyed-document errors precede token batch validation", () => {
    const document = native.createDocument();
    document.epochView();
    document.destroy();
    expect(() => document.createElementTokenBatch("div", 0)).toThrow(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
    expect(() => document.createElementTokenBatch("div", 4097)).toThrow(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
    expect(() => document.createElementTokenRange("div", 0)).toThrow(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
    expect(() => document.createElementTokenRange("div", 4097)).toThrow(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
  });
});

describe.skipIf(!nativeAvailable)("facade lazy-token convergence", () => {
  test("a fully legacy binding ignores inherited optional performance methods", () => {
    expect(runLegacyBindingProbe("fully-legacy")).toEqual({
      scenario: "fully-legacy",
      ok: true,
    });
  });

  test("a partial binding without materialization disables lazy creation and snapshots", () => {
    expect(runLegacyBindingProbe("partial-without-materialization")).toEqual({
      scenario: "partial-without-materialization",
      ok: true,
    });
  });

  test("adaptive pools return every prefetched token before truncating the batch", () => {
    const window = new Window();
    try {
      const elements = [window.document.createElement("div")];
      const originalMin = Math.min;
      let intercepted;
      try {
        Math.min = function patchedMathMin() {
          throw new Error("intercepted Math.min");
        };
        elements.push(window.document.createElement("div"));
      } catch (error) {
        intercepted = error;
      } finally {
        Math.min = originalMin;
      }
      expect(intercepted).toBeUndefined();
      while (elements.length < 12) {
        elements.push(window.document.createElement("div"));
      }
      const tokens = elements.map(nodeTokenOf);
      expect(tokens.every((token) => typeof token === "number")).toBe(true);
      expect(new Set(tokens).size).toBe(elements.length);
      for (let i = 2; i <= 8; i += 1) {
        expect(tokens[i]).toBe(tokens[i - 1] - 1);
      }

      for (let i = 0; i < elements.length; i += 1) {
        elements[i].innerHTML = `<span>${i}</span>`;
        expect(elements[i].textContent).toBe(String(i));
      }
    } finally {
      window.destroy();
    }
  });

  test("an older binding without token ranges falls back to the batch method", () => {
    const prototype = native.DocumentHandle.prototype;
    const rangeDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "createElementTokenRange",
    );
    const batchDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "createElementTokenBatch",
    );
    const inheritedDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "createElementTokenRange",
    );
    let inheritedCalls = 0;
    let batchCalls = 0;
    let window;
    try {
      delete prototype.createElementTokenRange;
      Object.defineProperty(Object.prototype, "createElementTokenRange", {
        configurable: true,
        value() {
          inheritedCalls += 1;
          throw new Error("inherited range method must not be reached");
        },
      });
      Object.defineProperty(prototype, "createElementTokenBatch", {
        ...batchDescriptor,
        value(name, count) {
          batchCalls += 1;
          return Reflect.apply(batchDescriptor.value, this, [name, count]);
        },
      });

      window = new Window();
      const elements = [];
      for (let i = 0; i < 12; i += 1) {
        elements.push(window.document.createElement("div"));
      }
      expect(new Set(elements.map(nodeTokenOf)).size).toBe(12);
      expect(batchCalls).toBeGreaterThan(0);
      expect(inheritedCalls).toBe(0);
    } finally {
      window?.destroy();
      Object.defineProperty(prototype, "createElementTokenRange", rangeDescriptor);
      Object.defineProperty(prototype, "createElementTokenBatch", batchDescriptor);
      if (inheritedDescriptor === undefined) {
        delete Object.prototype.createElementTokenRange;
      } else {
        Object.defineProperty(
          Object.prototype,
          "createElementTokenRange",
          inheritedDescriptor,
        );
      }
    }
  });

  test("raw handles minted before facade setup converge with token snapshots", () => {
    const nativeWindow = native.createWindow();
    const nativeDocument = nativeWindow.document();
    const body = nativeDocument.querySelector("body");
    const firstRaw = nativeDocument.createElement("section");
    const secondRaw = nativeDocument.createElement("aside");
    firstRaw.setAttribute("id", "raw-first");
    secondRaw.setAttribute("id", "raw-second");
    nativeDocument.appendChild(body, firstRaw);
    nativeDocument.appendChild(body, secondRaw);

    const window = new Window(nativeWindow);
    try {
      const queryFirst = window.document.querySelector("#raw-first");
      const traversalFirst = window.document.body.firstChild;
      const traversalSecond = traversalFirst.nextSibling;
      expect(traversalFirst).toBe(queryFirst);
      expect(window.document.querySelector("#raw-second")).toBe(traversalSecond);
    } finally {
      window.destroy();
    }
  });

  test("mixed fresh/existing snapshot wrappers converge with the right prototypes", () => {
    const window = new Window();
    try {
      window.document.write(
        '<div id="seen"><span id="fresh-span"></span><p id="fresh-p"></p><x-snapshot id="fresh-custom"></x-snapshot></div>',
      );
      const seen = window.document.querySelector("#seen");
      const walkedSeen = window.document.body.firstChild;
      const span = walkedSeen.firstChild;
      const paragraph = span.nextSibling;
      const custom = paragraph.nextSibling;

      expect(walkedSeen).toBe(seen);
      expect(Object.getPrototypeOf(walkedSeen)).toBe(window.HTMLDivElement.prototype);
      expect(Object.getPrototypeOf(span)).toBe(window.HTMLSpanElement.prototype);
      expect(Object.getPrototypeOf(paragraph)).toBe(window.HTMLParagraphElement.prototype);
      expect(Object.getPrototypeOf(custom)).toBe(window.HTMLElement.prototype);
      expect(hasMaterializedNodeHandle(span)).toBe(false);
      expect(hasMaterializedNodeHandle(paragraph)).toBe(false);

      expect(window.document.querySelector("#fresh-span")).toBe(span);
      expect(window.document.querySelector("#fresh-p")).toBe(paragraph);
      expect(window.document.querySelector("#fresh-custom")).toBe(custom);
    } finally {
      window.destroy();
    }
  });

  test("snapshot prototype selection ignores post-import prototype poisoning", () => {
    const window = new Window();
    try {
      window.document.write("<q>quoted</q>");
      const body = window.document.body;
      const descriptor = 16 + SNAPSHOT_NAMES.indexOf("q");
      const originalArrayEntry = Object.getOwnPropertyDescriptor(
        Array.prototype,
        descriptor,
      );
      const originalNodeTypeEntry = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "nodeType",
      );
      const originalObjectCreate = Object.create;
      let quote;
      let intercepted;
      try {
        Object.defineProperty(Array.prototype, descriptor, {
          value: window.HTMLDivElement.prototype,
          writable: true,
          configurable: true,
        });
        Object.create = () => {
          throw new Error("intercepted Object.create");
        };
        Object.defineProperty(Object.prototype, "nodeType", {
          set() {
            throw new Error("intercepted Object.prototype.nodeType");
          },
          configurable: true,
        });
        quote = body.firstChild;
      } catch (error) {
        intercepted = error;
      } finally {
        Object.create = originalObjectCreate;
        if (originalArrayEntry === undefined) {
          delete Array.prototype[descriptor];
        } else {
          Object.defineProperty(Array.prototype, descriptor, originalArrayEntry);
        }
        if (originalNodeTypeEntry === undefined) {
          delete Object.prototype.nodeType;
        } else {
          Object.defineProperty(
            Object.prototype,
            "nodeType",
            originalNodeTypeEntry,
          );
        }
      }

      expect(intercepted).toBeUndefined();
      expect(Object.getPrototypeOf(quote)).toBe(window.HTMLQuoteElement.prototype);
      expect(quote.localName).toBe("q");
    } finally {
      window.destroy();
    }
  });

  test("hot writes stay token-only until a handle-producing read converges identity", () => {
    const window = new Window();
    try {
      const element = window.document.createElement("div");
      const text = window.document.createTextNode("hello");
      expect(typeof nodeTokenOf(element)).toBe("number");
      expect(typeof nodeTokenOf(text)).toBe("number");
      expect(hasMaterializedNodeHandle(element)).toBe(false);
      expect(hasMaterializedNodeHandle(text)).toBe(false);

      element.setAttribute("id", "lazy-node");
      element.appendChild(text);
      window.document.body.appendChild(element);
      expect(hasMaterializedNodeHandle(element)).toBe(false);
      expect(hasMaterializedNodeHandle(text)).toBe(false);

      expect(window.document.querySelector("#lazy-node")).toBe(element);
      expect(hasMaterializedNodeHandle(element)).toBe(true);
      expect(element.firstChild).toBe(text);
      expect(text.textContent).toBe("hello");
    } finally {
      window.destroy();
    }
  });

  test("text wrappers keep identity across token chunks and interleaved documents", () => {
    const windows = [new Window(), new Window()];
    try {
      const created = [[], []];
      const bodies = windows.map((window) => window.document.body);
      for (let index = 0; index < 520; index++) {
        for (let documentIndex = 0; documentIndex < windows.length; documentIndex++) {
          const text = windows[documentIndex].document.createTextNode(
            `${documentIndex}:${index}:\0🙂`,
          );
          created[documentIndex].push(text);
          bodies[documentIndex].appendChild(text);
        }
      }
      for (let documentIndex = 0; documentIndex < windows.length; documentIndex++) {
        const nodes = created[documentIndex];
        expect(nodeTokenOf(nodes.at(-1)) - nodeTokenOf(nodes[0])).toBeGreaterThan(256);
        Object.freeze(nodes[257]);
        for (const index of [519, 0, 257, 255, 256, 1, 511, 257]) {
          const text = nodes[index];
          expect(bodies[documentIndex].childNodes[index]).toBe(text);
          expect(text.data).toBe(`${documentIndex}:${index}:\0🙂`);
          expect(text.ownerDocument).toBe(windows[documentIndex].document);
          expect(nodeHandleOf(text).ownerDocument()).toBe(
            nodeHandleOf(nodes[0]).ownerDocument(),
          );
        }
      }
    } finally {
      for (const window of windows) window.destroy();
    }
  });

  test("an unwrapped token cannot inherit a forged wrapper from a numeric property", () => {
    const nativeWindow = native.createWindow();
    const nativeDocument = nativeWindow.document();
    const window = new Window(nativeWindow);
    try {
      const body = window.document.body;
      const bodyToken = nativeDocument.nodeToken(nodeHandleOf(body));
      let token;
      // Use a nontrivial offset so the poisoned property does not affect the
      // test runner's own short arrays while the facade lookup is exercised.
      do {
        window.document.createTextNode("registered");
        token = nativeDocument.createTextToken("unwrapped");
      } while ((token & 255) < 32 || (token & 255) > 200);
      nativeDocument.appendChildToken(bodyToken, token);
      const property = String(token & 255);
      const original = Object.getOwnPropertyDescriptor(Object.prototype, property);
      let found;
      try {
        Object.defineProperty(Object.prototype, property, {
          configurable: true,
          value: { forged: true },
          writable: true,
        });
        found = body.firstChild;
      } finally {
        if (original === undefined) delete Object.prototype[property];
        else Object.defineProperty(Object.prototype, property, original);
      }
      expect(found.nodeType).toBe(3);
      expect(found.data).toBe("unwrapped");
      expect(nodeTokenOf(found)).toBe(token);
      expect(body.firstChild).toBe(found);
    } finally {
      window.destroy();
    }
  });

  test("destroy clears prefetched element tokens before another facade create", () => {
    const window = new Window();
    const document = window.document;
    document.createElement("div");
    document.createElement("div");
    window.destroy();
    expect(() => document.createElement("div")).toThrow(
      /ERR_MAD_DOM_DOCUMENT_DESTROYED/,
    );
  });

  test("fresh-token proof is read only after name coercion re-entry", () => {
    const window = new Window();
    const document = window.document;
    expect(() =>
      document.createElement({
        toString() {
          window.destroy();
          return "div";
        },
      }),
    ).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });

  test("a frozen lazy wrapper can materialize without losing identity", () => {
    const window = new Window();
    try {
      const element = window.document.createElement("div");
      Object.freeze(element);
      element.setAttribute("id", "frozen-lazy");
      element.setAttribute("class", "kept");
      window.document.body.appendChild(element);

      expect(window.document.querySelector("#frozen-lazy")).toBe(element);
      expect(element.nodeName).toBe("DIV");
      expect(element.getAttribute("class")).toBe("kept");
    } finally {
      window.destroy();
    }
  });

  test("selection keeps a lazily materialized wrapper after token-cache teardown", () => {
    const window = new Window();
    const text = window.document.createTextNode("selected");
    window.document.body.appendChild(text);
    expect(hasMaterializedNodeHandle(text)).toBe(false);
    Object.freeze(text);
    const range = window.document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    expect(hasMaterializedNodeHandle(text)).toBe(true);
    const selection = window.document.getSelection();
    selection.addRange(range);

    // The first wrapper-producing read is after destroy; no earlier read
    // through wrap() can incidentally populate the native-handle cache.
    window.destroy();
    expect(selection.anchorNode).toBe(text);
    expect(selection.focusNode).toBe(text);
    expect(() => text.data).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });

  test("a bundled cold read fills both attribute slots and invalidates atomically", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    element.setAttribute("id", "paired");
    element.setAttribute("class", "before");
    expect(element.id).toBe("paired");

    // The first id read cold-filled class in the same native call. Shadowing
    // the optional reader lets this test prove the next class read is a cache
    // hit without exposing the private cache symbol.
    const handle = nodeHandleOf(element);
    const bundledRead = handle.idClassAttributes.bind(handle);
    let bundleReads = 0;
    Object.defineProperty(handle, "idClassAttributes", {
      configurable: true,
      value() {
        bundleReads += 1;
        return bundledRead();
      },
    });
    expect(element.className).toBe("before");
    expect(element.getAttribute("class")).toBe("before");
    expect(bundleReads).toBe(0);

    handle.setAttribute("class", "after");
    expect(element.getAttribute("class")).toBe("after");
    expect(bundleReads).toBe(1);
    expect(element.id).toBe("paired");
    expect(bundleReads).toBe(1);
    expect(element.className).toBe("after");

    window.destroy();
    expect(() => element.className).toThrow();
  });

  test("facade-local token writes still publish ordinary raw epoch views", () => {
    const window = new Window();
    try {
      const element = window.document.createElement("div");
      // A handle-producing read gives the test access to the raw document;
      // the facade wrapper itself retains its token hot path.
      element.getAttribute("id");
      const documentHandle = nodeHandleOf(element).ownerDocument();
      const structure = new Int32Array(documentHandle.epochView());
      const attributes = new Int32Array(documentHandle.attributeEpochView());
      const attributesBefore = attributes[0];

      element.setAttribute("id", "published");
      expect(attributes[0]).toBe(attributesBefore + 1);
      const body = window.document.body;
      const structureBeforeAppend = structure[0];
      body.appendChild(element);
      expect(structure[0]).toBe(structureBeforeAppend + 1);
    } finally {
      window.destroy();
    }
  });

  test("preorder hydration continues beyond the 65,535-node native chunk", () => {
    const window = new Window();
    try {
      const root = window.document.createElement("div");
      const childCount = 65_535;
      root.innerHTML = "<i></i>".repeat(childCount);

      const OriginalWeakSet = globalThis.WeakSet;
      const originalHas = OriginalWeakSet.prototype.has;
      const originalAdd = OriginalWeakSet.prototype.add;
      let first;
      let intercepted;
      try {
        globalThis.WeakSet = class FakeWeakSet {
          constructor() {
            throw new Error("intercepted WeakSet constructor");
          }
        };
        OriginalWeakSet.prototype.has = function patchedWeakSetHas() {
          throw new Error("intercepted WeakSet.has");
        };
        OriginalWeakSet.prototype.add = function patchedWeakSetAdd() {
          throw new Error("intercepted WeakSet.add");
        };
        first = root.firstChild;
      } catch (error) {
        intercepted = error;
      } finally {
        globalThis.WeakSet = OriginalWeakSet;
        OriginalWeakSet.prototype.has = originalHas;
        OriginalWeakSet.prototype.add = originalAdd;
      }

      expect(intercepted).toBeUndefined();

      let count = 0;
      let last = null;
      for (let child = first; child; child = child.nextSibling) {
        count += 1;
        last = child;
      }
      expect(count).toBe(childCount);
      expect(root.lastChild).toBe(last);
    } finally {
      window.destroy();
    }
  });
});
