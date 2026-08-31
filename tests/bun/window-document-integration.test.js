import { describe, expect, test } from "bun:test";
import {
  Window,
  createDocument,
  Document,
  isNativeAvailable,
  liveDocumentCount,
  project,
} from "../../index.js";

// T22 cross-layer integration smoke tests.
//
// They drive the Window/Document facade through the official package entry
// (index.js → js/entry.js) and pin the acceptance criteria of the gate:
//
//   - new Window() no longer throws the pre-alpha placeholder;
//   - Window and Document are constructible, prototype-chained and
//     descriptor-shaped per the frozen facade baseline
//     (tests/bun/fixtures/facade-window-document.contract.json, T22B);
//   - the root entry is the single source of the runtime surface and stays in
//     lockstep with index.d.ts (the single source for types);
//   - lifecycle forwards to the native binding: destroy is idempotent, the
//     live-document counter tracks ownership, and a destroyed document fails
//     with the frozen T21 error (ERR_MAD_DOM_DOCUMENT_DESTROYED).
//
// The structural block needs no native artifact; the lifecycle block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the T22A/T22B suites.

const nativeAvailable = isNativeAvailable();

describe("root entry surface (T22)", () => {
  test("the package entry exports exactly the public surface", async () => {
    const mod = await import("../../index.js");
    expect(Object.keys(mod).sort()).toEqual([
      "Browser",
      "BrowserContext",
      "BrowserErrorCaptureEnum",
      "BrowserFrame",
      "BrowserPage",
      "CSSConditionRule",
      "CSSContainerRule",
      "CSSFontFaceRule",
      "CSSGroupingRule",
      "CSSKeyframeRule",
      "CSSKeyframesRule",
      "CSSKeywordValue",
      "CSSMediaRule",
      "CSSRule",
      "CSSScopeRule",
      "CSSStyleDeclaration",
      "CSSStyleRule",
      "CSSStyleSheet",
      "CSSStyleValue",
      "CSSSupportsRule",
      "CustomEvent",
      "Document",
      "Event",
      "EventPhaseEnum",
      "FocusEvent",
      "InputEvent",
      "KeyboardEvent",
      "MediaList",
      "MediaQueryListEvent",
      "MouseEvent",
      "UIEvent",
      "VirtualConsoleLogLevelEnum",
      "VirtualConsolePrinter",
      "WheelEvent",
      "Window",
      "createDocument",
      "isNativeAvailable",
      "liveDocumentCount",
      "nativeAbiVersion",
      "project",
    ]);
  });

  test("project metadata is the frozen single source", () => {
    expect(project).toEqual(
      Object.freeze({
        name: "mad-dom",
        version: "0.0.1-alpha.0",
        status: "pre-alpha",
        runtime: "bun",
        architecture: "native-memory-arena",
      }),
    );
  });

  test("Window and Document sit one level under Object.prototype", () => {
    expect(Object.getPrototypeOf(Window.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(Document.prototype)).toBe(Object.prototype);
    expect(Object.keys(Window.prototype)).toEqual([]);
    expect(Object.keys(Document.prototype)).toEqual([]);
  });

  test("Window.document is a non-enumerable, non-configurable accessor without a setter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Window.prototype, "document");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(descriptor.set).toBeUndefined();
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });

  test("Window.destroy and Document.destroy are fixed method descriptors", () => {
    for (const target of [Window.prototype, Document.prototype]) {
      const descriptor = Object.getOwnPropertyDescriptor(target, "destroy");
      expect(descriptor).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });
});

describe.skipIf(!nativeAvailable)("root entry Window/Document lifecycle (T22)", () => {
  test("new Window() returns a Window facade strongly owning a fresh Document", () => {
    const before = liveDocumentCount();
    const win = new Window();
    expect(win).toBeInstanceOf(Window);
    expect(Object.getPrototypeOf(win)).toBe(Window.prototype);
    expect(win.constructor).toBe(Window);
    expect(liveDocumentCount()).toBe(before + 1);

    const doc = win.document;
    expect(doc).toBeInstanceOf(Document);
    expect(Object.getPrototypeOf(doc)).toBe(Document.prototype);
    expect(doc.constructor).toBe(Document);
    expect(win.document).toBe(doc);

    win.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("window.document hands back one and the same object on every read (T20 identity)", () => {
    const win = new Window();
    expect(win.document).toBe(win.document);
    win.destroy();
  });

  test("destroy is idempotent through the root entry and forward to the native handle", () => {
    const before = liveDocumentCount();
    const win = new Window();
    const doc = win.document;
    win.destroy();
    expect(() => win.destroy()).not.toThrow();
    expect(() => doc.destroy()).not.toThrow();
    expect(win.document).toBe(doc);
    expect(liveDocumentCount()).toBe(before);
  });

  test("the T21 destroyed-document error protocol is reachable through the root entry", () => {
    const rawDocument = createDocument();
    rawDocument.destroy();
    const err = (() => {
      try {
        rawDocument.createElement("div");
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    expect(err.message).toBe("[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed");
  });
});
