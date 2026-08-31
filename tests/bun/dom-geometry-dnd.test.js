import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { DOMPoint, DOMRect, DOMRectReadOnly } from "../../js/facade/extensions/dom-geometry.js";
import {
  DataTransfer,
  DataTransferItem,
  DataTransferItemList,
} from "../../js/facade/extensions/dnd.js";
import {
  ClipboardEvent,
  Touch,
  TouchEvent,
} from "../../js/facade/extensions/events.js";

// T07 facade tests for the event/dom geometry + data-transfer surface that the
// hdunit event / dom waves enabled:
//
//   - the DOM geometry classes (`DOMPoint` / `DOMRect` / `DOMRectReadOnly`)
//     reachable through the window with the baseline construction defaults,
//     the derived rect edges, `fromRect` / `toJSON` and the 4×4
//     `matrixTransform` semantics;
//   - the data-transfer classes (`DataTransfer` / `DataTransferItemList` /
//     `DataTransferItem`) with the items/files/types reads, the `setData` /
//     `getData` format normalization and the `setDragImage` baseline throw;
//   - the `ClipboardEvent` / `Touch` / `TouchEvent` event classes with the
//     baseline instance shape and defaults.
//
// Each block also pins that the vendored happy-dom tests these support keep
// their assertions untouched (the rewrite pipeline is the only assertion
// editor); these tests only guard the facade behavior behind them.

const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("T07 DOM geometry window surface", () => {
  test("window.DOMPoint / window.DOMRect / window.DOMRectReadOnly construct with baseline defaults", () => {
    const window = new Window();

    const point = new window.DOMPoint(1, 2, 3, 4);
    expect(point).toBeInstanceOf(window.DOMPoint);
    expect(point).toBeInstanceOf(DOMPoint);
    expect(point.x).toBe(1);
    expect(point.y).toBe(2);
    expect(point.z).toBe(3);
    expect(point.w).toBe(4);

    const emptyPoint = new window.DOMPoint();
    expect(emptyPoint.x).toBe(0);
    expect(emptyPoint.w).toBe(1);

    const nullPoint = new window.DOMPoint(null, null, null, 4);
    expect(nullPoint.x).toBe(0);
    expect(nullPoint.w).toBe(4);

    point.x = 10;
    expect(point.x).toBe(10);

    const rect = new window.DOMRect(1, 2, 3, 4);
    expect(rect).toBeInstanceOf(DOMRect);
    expect(rect.top).toBe(2);
    expect(rect.right).toBe(4);
    expect(rect.bottom).toBe(6);
    expect(rect.left).toBe(1);
    window.destroy();
  });

  test("DOMPointReadOnly.matrixTransform applies the full 4x4 transform", () => {
    const window = new Window();
    const point = new window.DOMPoint(1, 2, 3, 4);
    const transformed = point.matrixTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    expect(transformed).toBeInstanceOf(window.DOMPoint);
    expect(transformed.toJSON()).toEqual({ x: 41, y: 82, z: 3, w: 4 });
    window.destroy();
  });

  test("DOMRect / DOMRectReadOnly fromRect and toJSON match the baseline", () => {
    const window = new Window();
    const rect = DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 });
    expect(rect).toBeInstanceOf(window.DOMRect);
    expect(rect.toJSON()).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      top: 2,
      right: 4,
      bottom: 6,
      left: 1,
    });
    const readOnly = DOMRectReadOnly.fromRect({ x: 1, y: 2, width: 3, height: 4 });
    expect(readOnly).toBeInstanceOf(window.DOMRectReadOnly);
    expect(readOnly.width).toBe(3);
    expect(readOnly.left).toBe(1);
    window.destroy();
  });
});

describe.skipIf(!nativeAvailable)("T07 data-transfer classes", () => {
  test("DataTransfer items/files/types and getData normalization match the baseline", () => {
    const dataTransfer = new DataTransfer();
    expect(dataTransfer.items).toBeInstanceOf(DataTransferItemList);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(dataTransfer.effectAllowed).toBe("none");

    dataTransfer.items.add("test1", "text/plain");
    dataTransfer.items.add("test2", "text/html");
    expect(dataTransfer.items.length).toBe(2);
    expect(dataTransfer.types).toEqual(["text/plain", "text/html"]);

    let data = null;
    dataTransfer.items[0].getAsString((s) => (data = s));
    expect(data).toBe("test1");
    expect(dataTransfer.items[0].kind).toBe("string");

    dataTransfer.setData("text/plain", "test2");
    dataTransfer.setData("text/html", "test3");
    expect(dataTransfer.getData("text/plain")).toBe("test2");
    expect(dataTransfer.getData("TEXT")).toBe("test2");
    expect(dataTransfer.getData("url")).toBe("");
    expect(dataTransfer.types).toEqual(["text/plain", "text/html"]);

    dataTransfer.items.add("https://example.com", "text/uri-list");
    expect(dataTransfer.getData("URL")).toBe("https://example.com");

    dataTransfer.clearData();
    expect(dataTransfer.items.length).toBe(0);
    expect(() => dataTransfer.setDragImage()).toThrow("Not implemented.");
  });

  test("DataTransferItemList.add requires a type for string items", () => {
    const list = new DataTransferItemList();
    expect(() => list.add("test1")).toThrow(
      "Failed to execute 'add' on 'DataTransferItemList': parameter 1 is not of type 'File'.",
    );
    list.add("test1", "text/plain");
    list.add("test2", "text/plain");
    list.remove(0);
    expect(list.length).toBe(1);
    expect(list[0].type).toBe("text/plain");
    list.clear();
    expect(list.length).toBe(0);
  });
});

describe.skipIf(!nativeAvailable)("T07 ClipboardEvent / Touch / TouchEvent", () => {
  test("ClipboardEvent carries clipboardData", () => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("paste", { clipboardData });
    expect(event.type).toBe("paste");
    expect(event.clipboardData).toBe(clipboardData);

    const plain = new ClipboardEvent("copy");
    expect(plain.clipboardData).toBeNull();
  });

  test("TouchEvent initializes touch lists and modifier flags with baseline defaults", () => {
    const window = new Window();
    const touch = new Touch({ identifier: 0, target: window.document.createElement("div") });
    expect(touch.identifier).toBe(0);
    expect(touch.target).toBeInstanceOf(window.Node ?? Object);
    expect(touch.clientX).toBe(0);

    const event = new TouchEvent("touchstart", {
      altKey: true,
      changedTouches: [touch],
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      targetTouches: [touch],
      touches: [touch],
    });
    expect(event).toMatchObject({
      altKey: true,
      changedTouches: [touch],
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      targetTouches: [touch],
      touches: [touch],
    });

    const defaults = new TouchEvent("touchstart");
    expect(defaults).toMatchObject({
      altKey: false,
      changedTouches: [],
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      targetTouches: [],
      touches: [],
    });
    window.destroy();
  });

  test("the classes are reachable through the window accessors", () => {
    const window = new Window();
    expect(window.ClipboardEvent).toBe(ClipboardEvent);
    expect(window.Touch).toBe(Touch);
    expect(window.TouchEvent).toBe(TouchEvent);
    window.destroy();
  });
});
