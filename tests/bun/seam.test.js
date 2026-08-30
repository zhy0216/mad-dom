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
  { path: "extensions/html.js", owner: "T29" },
  { path: "extensions/query.js", owner: "T31" },
  { path: "extensions/live-collections.js", owner: "T32" },
  { path: "extensions/extended-nodes.js", owner: "T33" },
  { path: "extensions/events.js", owner: "T37" },
  { path: "extensions/attribute-nodes.js", owner: "T34" },
  { path: "extensions/html-element.js", owner: "T39" },
  { path: "extensions/window-platform.js", owner: "T45" },
  { path: "extensions/tree-traversal.js", owner: "T35" },
  { path: "extensions/mutation-observer.js", owner: "T41" },
  { path: "extensions/template.js", owner: "T40" },
  { path: "extensions/forms.js", owner: "T40" },
  { path: "extensions/fetch.js", owner: "T46" },
  { path: "extensions/range-selection.js", owner: "T36" },
  { path: "extensions/shadow-dom.js", owner: "T43" },
];

// The T22B-owned files and the node (T23B), mutation (T24C), T25E/T25D, T29,
// T31, T32, T33, T37, T34, T39, T45, T35, T41, T40, T46 and T43 capability
// extensions are implemented and their seam status is flipped to "implemented";
// no capability extension stays a placeholder.
const IMPLEMENTED_FACADE_FILES = [
  { path: "window.js", owner: "T22B" },
  { path: "document.js", owner: "T22B" },
  { path: "extensions/index.js", owner: "T22B" },
  { path: "extensions/node.js", owner: "T23B" },
  { path: "extensions/mutation.js", owner: "T24C" },
  { path: "extensions/attributes.js", owner: "T25E" },
  { path: "extensions/text-content.js", owner: "T25E" },
  { path: "extensions/child-nodelist.js", owner: "T25D" },
  { path: "extensions/html.js", owner: "T29" },
  { path: "extensions/query.js", owner: "T31" },
  { path: "extensions/live-collections.js", owner: "T32" },
  { path: "extensions/extended-nodes.js", owner: "T33" },
  { path: "extensions/events.js", owner: "T37" },
  { path: "extensions/attribute-nodes.js", owner: "T34" },
  { path: "extensions/html-element.js", owner: "T39" },
  { path: "extensions/window-platform.js", owner: "T45" },
  { path: "extensions/tree-traversal.js", owner: "T35" },
  { path: "extensions/mutation-observer.js", owner: "T41" },
  { path: "extensions/template.js", owner: "T40" },
  { path: "extensions/forms.js", owner: "T40" },
  { path: "extensions/fetch.js", owner: "T46" },
  { path: "extensions/range-selection.js", owner: "T36" },
  { path: "extensions/shadow-dom.js", owner: "T43" },
];
const PLACEHOLDER_FACADE_FILES = [];

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

  test("every facade module is a valid ESM module with frozen seam metadata", async () => {
    for (const file of OWNED_FACADE_FILES) {
      if (!file.path.endsWith(".js")) continue;
      const mod = await import(`${FACADE}/${file.path}`);
      expect(mod.seam, `${file.path} must export frozen seam metadata`).toBeDefined();
      expect(mod.seam.owner, `${file.path} owner`).toBe(file.owner);
      expect(mod.seam.gate, `${file.path} gate`).toBeDefined();
      expect(Object.isFrozen(mod.seam), `${file.path} seam must be frozen`).toBe(true);
    }
  });

  test("implemented facade files are flipped by their gates", async () => {
    for (const file of IMPLEMENTED_FACADE_FILES) {
      const mod = await import(`${FACADE}/${file.path}`);
      expect(mod.seam.status, `${file.path} status`).toBe("implemented");
    }
  });

  test("the M4 extension set leaves no facade seam as a placeholder", async () => {
    for (const file of PLACEHOLDER_FACADE_FILES) {
      const mod = await import(`${FACADE}/${file.path}`);
      expect(mod.seam.status, `${file.path} status`).toBe("placeholder");
    }
    // Every owned capability extension (M4 through M6) is implemented, so the
    // placeholder set is empty — the facade seam is complete.
    expect(PLACEHOLDER_FACADE_FILES).toEqual([]);
  });
});
