import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// T20A structural / ownership test. It needs no native artifact: it pins the
// frozen cross-layer extension seam — the js/facade contract and placeholder
// ownership — so downstream tasks and the coordinator rely on stable files
// instead of guessing. The Rust half of the seam is pinned by the registry
// tests in crates/mad-dom-bun/src/extensions/mod.rs.

const FACADE = fileURLToPath(new URL("../../js/facade", import.meta.url));

const OWNED_FACADE_FILES = [
  { path: "CONTRACT.md", owner: "T20A" },
  { path: "window.js", owner: "T22B" },
  { path: "document.js", owner: "T22B" },
  { path: "extensions/index.js", owner: "T22B" },
  { path: "extensions/node.js", owner: "T23B" },
  { path: "extensions/mutation.js", owner: "T24C" },
  { path: "extensions/attributes.js", owner: "T25E" },
  { path: "extensions/text-content.js", owner: "T25E" },
  { path: "extensions/child-nodelist.js", owner: "T25D" },
];

describe("cross-layer extension seam (T20A)", () => {
  test("js/facade contract and placeholder files exist", () => {
    for (const file of OWNED_FACADE_FILES) {
      expect(existsSync(`${FACADE}/${file.path}`), `${file.path} must exist`).toBe(true);
    }
  });

  test("CONTRACT.md records every owned path with its owner", () => {
    const contract = readFileSync(`${FACADE}/CONTRACT.md`, "utf8");
    for (const file of OWNED_FACADE_FILES) {
      expect(contract, `CONTRACT.md must mention ${file.path}`).toContain(file.path);
      expect(contract, `CONTRACT.md must assign ${file.path} to ${file.owner}`).toContain(file.owner);
    }
  });

  test("every facade placeholder is a valid ESM module with frozen seam metadata", async () => {
    for (const file of OWNED_FACADE_FILES) {
      if (!file.path.endsWith(".js")) continue;
      const mod = await import(`${FACADE}/${file.path}`);
      expect(mod.seam, `${file.path} must export frozen seam metadata`).toBeDefined();
      expect(mod.seam.owner, `${file.path} owner`).toBe(file.owner);
      expect(mod.seam.gate, `${file.path} gate`).toBeDefined();
      expect(mod.seam.status, `${file.path} status`).toBe("placeholder");
      expect(Object.isFrozen(mod.seam), `${file.path} seam must be frozen`).toBe(true);
    }
  });
});
