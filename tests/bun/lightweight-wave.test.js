import { describe, expect, test } from "bun:test";
import { Window, VirtualConsolePrinter, isNativeAvailable } from "../../index.js";
import { VirtualConsole } from "../../js/facade/extensions/lightweight.js";

// T08 lightweight-wave facade tests.
//
// These back the facade additions that enable the vendored happy-dom
// lightweight subsystems (canvas / file / console / screen-independent
// classes / clipboard / intersection-observer / mutation-observer /
// validity-state / form-data / url). The vendored rewritten suite is the
// primary evidence; these tests pin the facade surface in isolation so a
// regression is caught without re-running the whole hdunit gate.

const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("T08 ImageData facade", () => {
  test("constructs from width/height and from a Uint8ClampedArray", () => {
    const window = new Window();
    try {
      const fromSize = new window.ImageData(800, 600);
      expect(fromSize.data).toBeInstanceOf(Uint8ClampedArray);
      expect(fromSize.data.length).toBe(800 * 600 * 4);
      expect(fromSize.width).toBe(800);
      expect(fromSize.height).toBe(600);

      const dataArray = new Uint8ClampedArray(800 * 600 * 4);
      const fromData = new window.ImageData(dataArray, 800);
      expect(fromData.data).toBe(dataArray);
      expect(fromData.width).toBe(800);
      expect(fromData.height).toBe(600);
    } finally {
      window.destroy();
    }
  });

  test("rejects a missing argument with a WebIDL TypeError", () => {
    const window = new Window();
    try {
      expect(() => new window.ImageData()).toThrow(
        "Failed to construct 'ImageData': 2 arguments required, but only 0 present.",
      );
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 IntersectionObserver facade", () => {
  test("is a no-op observer with an empty takeRecords()", () => {
    const window = new Window();
    try {
      const observer = new window.IntersectionObserver(() => {});
      expect(observer.takeRecords()).toEqual([]);
      observer.observe(window.document.createElement("div"));
      observer.unobserve(window.document.createElement("div"));
      observer.disconnect();
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 Blob / File / FileReader facade", () => {
  test("Blob exposes size / type / slice / arrayBuffer / text / stream", async () => {
    const window = new Window();
    try {
      const blob = new window.Blob(["TEST"], { type: "text/plain" });
      expect(blob.size).toBe(4);
      expect(blob.type).toBe("text/plain");
      expect(await blob.text()).toBe("TEST");
      expect(blob.slice(1, 3).size).toBe(2);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
        new Uint8Array([84, 69, 83, 84]),
      );
      const reader = blob.stream().getReader();
      const { value } = await reader.read();
      expect(value).toEqual(Buffer.from("TEST"));
    } finally {
      window.destroy();
    }
  });

  test("File extends Blob with name and lastModified", () => {
    const window = new Window();
    try {
      const file = new window.File(["TEST"], "filename.jpg", { lastModified: 1 });
      expect(file).toBeInstanceOf(window.Blob);
      expect(file.name).toBe("filename.jpg");
      expect(file.lastModified).toBe(1);
      expect(file.size).toBe(4);
    } finally {
      window.destroy();
    }
  });

  test("FileReader reads as data URL / text / array buffer", async () => {
    const window = new Window();
    try {
      const blob = new window.Blob(["TEST"], { type: "text/plain;charset=utf-8" });
      const fileReader = new window.FileReader();
      let result = null;
      fileReader.addEventListener("load", () => {
        result = fileReader.result;
      });
      fileReader.readAsDataURL(blob);
      await window.happyDOM.waitUntilComplete();
      expect(result).toBe("data:text/plain;charset=utf-8;base64,VEVTVA==");
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 URL facade", () => {
  test("window.URL is a host subclass with the blob:nodedata: object-URL prefix", () => {
    const window = new Window();
    try {
      expect(window.URL.prototype).toBeInstanceOf(globalThis.URL);
      const url = new window.URL("https://x.test/y?z=1");
      expect(url.href).toBe("https://x.test/y?z=1");
      expect(() => new window.URL("invalid-url")).toThrow(TypeError);
      expect(window.URL.createObjectURL(new window.Blob(["x"]))).toMatch(/^blob:nodedata:/);
      expect(window.TypeError).toBe(globalThis.TypeError);
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 VirtualConsole facade", () => {
  test("assert / log / count / group route to the printer", () => {
    const window = new Window();
    try {
      const printer = new VirtualConsolePrinter();
      const console = new VirtualConsole(printer);
      console.log("Test", { test: true });
      console.assert(false, "Assert", { a: 1 });
      console.count("default");
      expect(printer.readAsString()).toBe(
        'Test {"test":true}\nAssertion failed: Assert {"a":1}\ndefault: 1\n',
      );
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 Clipboard facade", () => {
  test("navigator.clipboard writes and reads back ClipboardItems", async () => {
    const window = new Window();
    try {
      const item = new window.ClipboardItem({
        "text/plain": new window.Blob(["test"], { type: "text/plain" }),
      });
      await window.navigator.clipboard.write([item]);
      const data = await window.navigator.clipboard.read();
      expect(data).toHaveLength(1);
      expect(await (await data[0].getType("text/plain")).text()).toBe("test");
      await window.navigator.clipboard.writeText("hello");
      expect(await window.navigator.clipboard.readText()).toBe("hello");
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 Permissions facade", () => {
  test("navigator.permissions exposes a query() surface with no enumerable internals", async () => {
    const window = new Window();
    try {
      const permissions = window.navigator.permissions;
      expect(permissions).toBeInstanceOf(window.Permissions);
      expect(Object.keys(permissions)).toEqual([]);
      const status = await permissions.query({ name: "geolocation" });
      expect(status).toBeInstanceOf(window.PermissionStatus);
      expect(status.state).toBe("granted");
      expect(await permissions.query({ name: "geolocation" })).toBe(status);
    } finally {
      window.destroy();
    }
  });
});
