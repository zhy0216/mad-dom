import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import {
  createNodeWrapper,
  nodeHandleOf,
  Text,
} from "../../js/facade/extensions/classes.js";

const nativeAvailable = isNativeAvailable();

describe("native metadata stamp provenance", () => {
  test("wrapper classification ignores inherited stamp lookalikes", () => {
    const names = ["madDomType", "madDomName", "madDomNamespace"];
    const descriptors = new Map(
      names.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(Object.prototype, name),
      ]),
    );
    let inheritedReads = 0;
    try {
      Object.defineProperties(Object.prototype, {
        madDomType: {
          configurable: true,
          get() {
            inheritedReads += 1;
            return 1;
          },
        },
        madDomName: {
          configurable: true,
          get() {
            inheritedReads += 1;
            return "poisoned";
          },
        },
        madDomNamespace: {
          configurable: true,
          get() {
            inheritedReads += 1;
            return "http://www.w3.org/1999/xhtml";
          },
        },
      });
      const legacyHandle = {
        nodeType() {
          return 3;
        },
        nodeName() {
          return "#text";
        },
        childNodes() {
          return [];
        },
        wrapperKind() {
          return [3, "", null];
        },
      };
      expect(createNodeWrapper(legacyHandle)).toBeInstanceOf(Text);
      expect(inheritedReads).toBe(0);
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor === undefined) delete Object.prototype[name];
        else Object.defineProperty(Object.prototype, name, descriptor);
      }
    }
  });
});

describe.skipIf(!nativeAvailable)("node metadata validity fast path", () => {
  test("HTML, SVG and text metadata keep their observable casing and types", () => {
    const window = new Window();
    try {
      const { document } = window;
      const html = document.createElement("section");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "feBlend");
      const text = document.createTextNode("x");

      expect([html.nodeType, html.nodeName, html.localName, html.tagName]).toEqual([
        1,
        "SECTION",
        "section",
        "SECTION",
      ]);
      expect([svg.nodeType, svg.nodeName, svg.localName, svg.tagName]).toEqual([
        1,
        "feBlend",
        "feBlend",
        "feBlend",
      ]);
      expect([text.nodeType, text.nodeName, text.localName, text.tagName]).toEqual([
        3,
        "#text",
        undefined,
        undefined,
      ]);

      const nativeHandle = nodeHandleOf(html);
      for (const name of ["madDomType", "madDomName", "madDomNamespace"]) {
        expect(Object.getOwnPropertyDescriptor(nativeHandle, name)).toMatchObject({
          writable: false,
          enumerable: false,
          configurable: false,
        });
      }
      expect(Reflect.set(nativeHandle, "madDomName", "tampered")).toBe(false);
      expect(html.nodeName).toBe("SECTION");
    } finally {
      window.destroy();
    }
  });

  test("internal epoch views are not reflectable from facade wrappers", () => {
    const window = new Window();
    try {
      const { document } = window;
      const element = document.createElement("div");
      document.body.appendChild(element);
      expect(element.nodeName).toBe("DIV");
      const reflectedValues = Object.getOwnPropertySymbols(element)
        .map((symbol) => element[symbol]);
      expect(reflectedValues.some(
        (value) => value?.epoch instanceof Int32Array ||
          value?.attributeEpoch instanceof Int32Array,
      )).toBe(false);
    } finally {
      window.destroy();
    }
  });

  test("metadata and derived caches are not reflectable or copy-forgeable", () => {
    const window = new Window();
    try {
      const { document } = window;
      const lazy = document.createElement("div");
      const child = document.createElement("span");
      lazy.setAttribute("id", "private-cache");
      lazy.setAttribute("class", "kept");
      lazy.appendChild(child);
      document.body.appendChild(lazy);

      // Prime immutable metadata, reflected attributes and navigation before
      // examining the wrapper. None of their backing records may become an
      // own Symbol that user code can discover and mutate.
      expect([lazy.nodeName, lazy.id, lazy.className, lazy.firstChild]).toEqual([
        "DIV",
        "private-cache",
        "kept",
        child,
      ]);
      expect(Object.getOwnPropertySymbols(lazy)).toEqual([]);

      const copied = Object.create(Object.getPrototypeOf(lazy));
      Object.defineProperties(copied, Object.getOwnPropertyDescriptors(lazy));
      expect(() => copied.nodeName).toThrow(TypeError);
      expect(() => copied.firstChild).toThrow(TypeError);
      expect(() => copied.id).toThrow(TypeError);
      expect(() => copied.getAttribute("class")).toThrow(TypeError);

      // A wrapper minted from an eager native query has the same private
      // boundary as a token-first wrapper.
      document.body.innerHTML = '<section id="parsed"><i></i></section>';
      const parsed = document.querySelector("#parsed");
      expect([parsed.nodeName, parsed.id, parsed.firstChild.nodeName]).toEqual([
        "SECTION",
        "parsed",
        "I",
      ]);
      expect(Object.getOwnPropertySymbols(parsed)).toEqual([]);
    } finally {
      window.destroy();
    }
  });

  test("private hot-path records use captured WeakMap intrinsics", () => {
    const window = new Window();
    try {
      const { document } = window;
      const parent = document.createElement("div");
      const child = document.createElement("span");
      parent.id = "private";
      parent.className = "cache";
      parent.appendChild(child);
      document.body.appendChild(parent);
      const collection = parent.getElementsByTagName("span");

      // Prime every path before patching so this exercises private state
      // reads, not unrelated lazy setup. Assertions run only after restoration
      // because the test runner itself is allowed to use WeakMap.
      void parent.nodeName;
      void parent.id;
      void parent.className;
      void parent.firstChild;
      void collection.length;

      const originalGet = WeakMap.prototype.get;
      const originalSet = WeakMap.prototype.set;
      let observed;
      let intercepted;
      try {
        WeakMap.prototype.get = function patchedWeakMapGet() {
          throw new Error("intercepted WeakMap.get");
        };
        WeakMap.prototype.set = function patchedWeakMapSet() {
          throw new Error("intercepted WeakMap.set");
        };
        observed = [
          parent.nodeName,
          parent.id,
          parent.className,
          parent.firstChild,
          collection.length,
          window.document,
        ];
      } catch (error) {
        intercepted = error;
      } finally {
        WeakMap.prototype.get = originalGet;
        WeakMap.prototype.set = originalSet;
      }

      expect(intercepted).toBeUndefined();
      expect(observed).toEqual([
        "DIV",
        "private",
        "cache",
        child,
        1,
        document,
      ]);
    } finally {
      window.destroy();
    }
  });

  test("lazy document state captures typed-array and collection primordials", () => {
    const OriginalInt32Array = globalThis.Int32Array;
    const OriginalMap = globalThis.Map;
    const OriginalSet = globalThis.Set;
    const originalMapGet = OriginalMap.prototype.get;
    const originalMapSet = OriginalMap.prototype.set;
    let window;
    let document;
    let setupError;

    try {
      // window.js has already been imported. A document's cache island is
      // initialized lazily on the first `window.document` read, so mutations
      // made now must not become its constructors or bound operations.
      globalThis.Int32Array = class FakeInt32Array {
        constructor(buffer) {
          return { 0: 0, buffer };
        }
      };
      globalThis.Map = class FakeMap {
        constructor() {
          throw new Error("intercepted Map constructor");
        }
      };
      globalThis.Set = class FakeSet {
        constructor() {
          throw new Error("intercepted Set constructor");
        }
      };
      OriginalMap.prototype.get = function patchedMapGet() {
        throw new Error("intercepted Map.get");
      };
      OriginalMap.prototype.set = function patchedMapSet() {
        throw new Error("intercepted Map.set");
      };

      window = new Window();
      document = window.document;
    } catch (error) {
      setupError = error;
    } finally {
      globalThis.Int32Array = OriginalInt32Array;
      globalThis.Map = OriginalMap;
      globalThis.Set = OriginalSet;
      OriginalMap.prototype.get = originalMapGet;
      OriginalMap.prototype.set = originalMapSet;
    }

    try {
      expect(setupError).toBeUndefined();
      const parent = document.createElement("div");
      const child = document.createElement("span");
      parent.appendChild(child);
      expect(parent.firstChild).toBe(child);

      // removeChild publishes through the native ArrayBuffer subscription.
      // A fake typed-array view would retain the old epoch and serve `child`.
      parent.removeChild(child);
      expect(parent.firstChild).toBeNull();

      // The second same-tag create consumes the private adaptive pool, proving
      // its get/set operations were not captured from the patched prototype.
      const first = document.createElement("section");
      const second = document.createElement("section");
      first.id = "one";
      second.id = "two";
      expect([first.id, second.id]).toEqual(["one", "two"]);
    } finally {
      window?.destroy();
    }
  });

  test("adoption and destruction cannot serve stale immutable stamps", () => {
    const source = new Window();
    const target = new Window();
    try {
      const old = source.document.createElement("article");
      expect(old.nodeName).toBe("ARTICLE");

      target.document.adoptNode(old);
      expect(() => old.nodeName).toThrow(/ERR_MAD_DOM_STALE_HANDLE/);

      const live = target.document.createElement("aside");
      target.destroy();
      expect(() => live.nodeName).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    } finally {
      source.destroy();
      target.destroy();
    }
  });

  test("adoption and destruction cannot serve stale reflected attributes", () => {
    const source = new Window();
    const target = new Window();
    try {
      const old = source.document.createElement("article");
      old.setAttribute("id", "before-adopt");
      old.setAttribute("class", "cached");
      expect([old.id, old.className]).toEqual(["before-adopt", "cached"]);

      target.document.adoptNode(old);
      expect(() => old.id).toThrow(/ERR_MAD_DOM_STALE_HANDLE/);
      expect(() => old.className).toThrow(/ERR_MAD_DOM_STALE_HANDLE/);

      const live = target.document.createElement("aside");
      live.setAttribute("id", "before-destroy");
      expect(live.id).toBe("before-destroy");
      target.destroy();
      expect(() => live.id).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    } finally {
      source.destroy();
      target.destroy();
    }
  });

  test("transferred epoch buffers become detached stale snapshots", () => {
    const window = new Window();
    try {
      const handle = nodeHandleOf(window.document.createElement("div"));
      const documentHandle = handle.ownerDocument();
      const structuralBuffer = documentHandle.epochView();
      const structuralBefore = new Int32Array(structuralBuffer)[0];
      const structuralClone = structuredClone(structuralBuffer, {
        transfer: [structuralBuffer],
      });
      expect(structuralBuffer.byteLength).toBe(0);

      const parent = documentHandle.createElement("section");
      const child = documentHandle.createElement("span");
      documentHandle.appendChild(parent, child);
      expect(new Int32Array(structuralClone)[0]).toBe(structuralBefore);

      const attributeBuffer = documentHandle.attributeEpochView();
      const attributeBefore = new Int32Array(attributeBuffer)[0];
      const attributeClone = structuredClone(attributeBuffer, {
        transfer: [attributeBuffer],
      });
      expect(attributeBuffer.byteLength).toBe(0);
      parent.setAttribute("data-transfer", "safe");
      expect(new Int32Array(attributeClone)[0]).toBe(attributeBefore);
    } finally {
      window.destroy();
    }
  });
});
