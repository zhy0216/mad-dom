import { describe, expect, test } from "bun:test";
import {
  createWindow,
  Document,
  isNativeAvailable,
  liveDocumentCount,
  project,
  Window,
} from "../../index.js";

test("package entry exposes frozen pre-alpha project metadata", () => {
  expect(project.name).toBe("mad-dom");
  expect(project.version).toBe("0.0.1-alpha.0");
  expect(project.status).toBe("pre-alpha");
  expect(project.runtime).toBe("bun");
  expect(project.architecture).toBe("native-memory-arena");
  expect(Object.isFrozen(project)).toBe(true);
});

describe("package entry Window/Document surface (T22)", () => {
  test("createWindow, Window and Document are exported as the facade surface", () => {
    expect(typeof createWindow).toBe("function");
    expect(typeof Window).toBe("function");
    expect(typeof Document).toBe("function");
  });

  test("createWindow no longer throws the pre-alpha placeholder", () => {
    const available = isNativeAvailable();
    let error;
    let win;
    try {
      win = createWindow();
    } catch (caught) {
      error = caught;
    }
    if (!available) {
      // No dev artifact: loading is lazy and fails fast per T19.
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("MAD_DOM_NATIVE_NOT_FOUND");
      return;
    }
    expect(error).toBeUndefined();
    expect(win).toBeInstanceOf(Window);
    expect(win.document).toBeInstanceOf(Document);
    expect(liveDocumentCount()).toBeGreaterThan(0);
    win.destroy();
  });
});
