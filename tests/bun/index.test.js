import { describe, expect, test } from "bun:test";
import {
  Window,
  Document,
  isNativeAvailable,
  liveDocumentCount,
  project,
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
  test("Window and Document are exported, createWindow is not (happy-dom entry shape)", async () => {
    const mod = await import("../../index.js");
    expect(typeof mod.Window).toBe("function");
    expect(typeof mod.Document).toBe("function");
    expect(typeof mod.createWindow).toBe("undefined");
  });

  test("new Window() no longer throws the pre-alpha placeholder", () => {
    const available = isNativeAvailable();
    let error;
    let win;
    try {
      win = new Window();
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
