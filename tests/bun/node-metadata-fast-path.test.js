import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import {
  DOC_STATE_SLOT,
  VALID_EPOCH_SLOT,
  nodeHandleOf,
} from "../../js/facade/extensions/classes.js";

const nativeAvailable = isNativeAvailable();

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

  test("a structural epoch miss validates once and refreshes the live proof", () => {
    const window = new Window();
    try {
      const { document } = window;
      const element = document.createElement("div");
      const state = element[DOC_STATE_SLOT];
      expect(element[VALID_EPOCH_SLOT]).toBe(state.epoch[0]);

      document.body.appendChild(element);
      expect(element[VALID_EPOCH_SLOT]).not.toBe(state.epoch[0]);
      expect(element.nodeName).toBe("DIV");
      expect(element[VALID_EPOCH_SLOT]).toBe(state.epoch[0]);
    } finally {
      window.destroy();
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
      expect(live[DOC_STATE_SLOT].epoch[0]).toBe(-2147483648);
      expect(() => live.nodeName).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    } finally {
      source.destroy();
      target.destroy();
    }
  });

  test("the terminal epoch never collides with a cached validity proof", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    const text = window.document.createTextNode("x");
    const sibling = window.document.createElement("span");
    element.appendChild(text);
    element.appendChild(sibling);
    const state = element[DOC_STATE_SLOT];

    // Model the Int32 structural counter naturally wrapping onto the native
    // destroy sentinel, then warm every cacheable read at that bit pattern.
    state.epoch[0] = -2147483648;
    element[VALID_EPOCH_SLOT] = -2147483648;
    text[VALID_EPOCH_SLOT] = -2147483648;
    expect(element.nodeType).toBe(1);
    expect(text.firstChild).toBeNull();
    expect(text.nextSibling).toBe(sibling);

    window.destroy();
    expect(() => element.nodeType).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    expect(() => text.firstChild).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    expect(() => text.nextSibling).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });
});
