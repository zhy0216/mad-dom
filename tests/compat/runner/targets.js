// Target adapter registry for the black-box differential runner (T10).
//
// A target adapter turns a target id into the implementation entry object
// (api.dom) inside the probe process. The parent runner never loads any
// adapter — isolation requires that only probe processes touch the
// implementations (ADR-0002 section 5.2).
//
// Registry:
//   happy-dom  — the locked baseline package (compat/happy-dom-baseline.json):
//                the full happy-dom module namespace.
//   mad-dom    — the repository entry (index.js at the repo root).
//   mock-pass  — controlled mini-DOM, reference variant (see mocks.js).
//   mock-fail  — same surface with five seeded divergences (see mocks.js);
//                used only by the self-test suite.
//
// Target pairs:
//   "real" → ["happy-dom", "mad-dom"] — the actual compatibility question;
//   "mock" → ["mock-pass", "mock-fail"] — runner self-test.

import { createMockDom } from "./mocks.js";

const MAD_DOM_ENTRY_URL = new URL("../../../index.js", import.meta.url);

export const TARGET_PAIRS = {
  real: ["happy-dom", "mad-dom"],
  mock: ["mock-pass", "mock-fail"],
};

export const TARGETS = {
  "happy-dom": {
    id: "happy-dom",
    async load() {
      return await import("happy-dom");
    },
  },
  "mad-dom": {
    id: "mad-dom",
    async load() {
      return await import(MAD_DOM_ENTRY_URL.href);
    },
  },
  "mock-pass": {
    id: "mock-pass",
    async load() {
      return createMockDom("pass");
    },
  },
  "mock-fail": {
    id: "mock-fail",
    async load() {
      return createMockDom("fail");
    },
  },
};

export function getTarget(targetId) {
  const target = TARGETS[targetId];
  if (target === undefined) {
    throw new Error(`unknown target adapter ${JSON.stringify(targetId)}; known: ${Object.keys(TARGETS).join(", ")}`);
  }
  return target;
}

export function resolveTargetPair(targets) {
  if (targets === undefined || targets === "real") return TARGET_PAIRS.real;
  if (targets === "mock") return TARGET_PAIRS.mock;
  if (Array.isArray(targets) && targets.length === 2) return [...targets];
  throw new Error(`invalid scenario targets: ${JSON.stringify(targets)}`);
}
