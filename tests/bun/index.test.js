import { expect, test } from "bun:test";
import { createWindow, project } from "../../index.js";

test("package entry exposes frozen pre-alpha project metadata", () => {
  expect(project.name).toBe("mad-dom");
  expect(project.version).toBe("0.0.1-alpha.0");
  expect(project.status).toBe("pre-alpha");
  expect(project.runtime).toBe("bun");
  expect(project.architecture).toBe("native-memory-arena");
  expect(Object.isFrozen(project)).toBe(true);
});

test("createWindow reports pre-alpha development status", () => {
  expect(() => createWindow()).toThrow(
    "mad-dom is in pre-alpha development and does not implement Window yet.",
  );
});
