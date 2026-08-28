// Scenario protocol for the black-box differential runner (T10).
//
// Contract: ADR-0002 sections 5 (黑盒差分 runner 协议) and 6 (结果规范化格式).
//
// ═══════════════════════════════════════════════════════════════════════════
// Scenario module contract
// ═══════════════════════════════════════════════════════════════════════════
//
// A scenario is one self-describing module that is executed unchanged, once
// per target, in its own fresh Bun subprocess ("probe process"). Named
// exports:
//
//   export const id          — stable kebab-case identifier, unique across all
//                              scenarios (e.g. "selftest-error-shape"). IDs are
//                              permanent; they will be referenced by the T11
//                              compatibility ledger (hc-diff-* IDs map onto
//                              them).
//   export const description — one-line human description.
//   export const targets     — optional. "real" (default) → the pair
//                              ["happy-dom", "mad-dom"]; "mock" → the pair
//                              ["mock-pass", "mock-fail"]; or an explicit
//                              two-element array of target ids.
//   export async function run(api) — the scenario body.
//
// Scenario rules (ADR-0002 section 5.1 / 5.4):
//   - use ONLY the public entry surface handed over via api.dom; never read
//     implementation internals, deep module paths or symbol-keyed slots;
//   - be deterministic: fixed inputs, no wall-clock reads, no Math.random
//     without a recorded fixed seed, no network;
//   - do NOT branch on api.target. The only permitted exception is the
//     self-test tamper harness (tests/compat/runner.test.js), which proves
//     the comparator fires by manufacturing a one-sided difference;
//   - record every observation through the api below; never print to stdout.
//
// ═══════════════════════════════════════════════════════════════════════════
// api surface (injected by the runner through the target adapter)
// ═══════════════════════════════════════════════════════════════════════════
//
//   api.target            — id of the target adapter running this probe
//                           (metadata only; see the no-branching rule above).
//   api.dom               — the implementation entry object produced by the
//                           target adapter (e.g. the happy-dom module
//                           namespace, the mad-dom package namespace, or a
//                           mock DOM for the self-test targets).
//   api.record.value(key, value)                  — named raw observation;
//                           normalized after the scenario completes.
//   api.record.event(name, detail = null)         — ordered event; order is
//                           the observation. detail goes through normalizeValue.
//   api.record.error(error, phase)                — exception observation with
//                           the scenario-declared throw phase. Recommended
//                           phase vocabulary: "setup" | "sync-throw" |
//                           "promise-rejection" | "callback" | "teardown"
//                           (any non-empty string is accepted). name and
//                           message are compared verbatim.
//   api.record.snapshot(key, node)                — DOM observation: the live
//                           node is deep-captured EAGERLY at call time
//                           (structured tree + outerHTML at the root).
//   api.record.descriptor(key, object, propertyKey) — property descriptor
//                           shape observation (missing own property →
//                           { present: false }).
//   api.record.identity(label, a, b)              — boolean identity relation
//                           "a and b are the same object" (Object.is), keyed
//                           by label; rendered as the sorted boolean relation
//                           table of ADR-0002 section 6.6.
//
// Keys/labels must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/ so difference paths
// stay readable. Contract violations throw inside the scenario — the probe
// process then reports an infrastructure error for that side (visible, exit 2).
//
// ═══════════════════════════════════════════════════════════════════════════
// Isolation contract (ADR-0002 section 5.2)
// ═══════════════════════════════════════════════════════════════════════════
//
//   - the parent runner process NEVER imports any target adapter or
//     implementation; it only spawns probes;
//   - one probe process per (scenario, target) pair: a fresh `bun child.js
//     <scenario> <target> <out.json>` with an environment variable whitelist
//     (PATH, HOME, TMPDIR, LANG, LC_ALL, BUN_INSTALL), cwd pinned to the repo
//     root, and a hard timeout (10s by default);
//   - the probe writes a structured JSON envelope to the output file; every
//     crash/timeout/non-zero exit is captured as a structured infrastructure
//     error for that side only and never leaks into other scenarios;
//   - the probe's pid is carried in the envelope for the self-test's
//     isolation assertions ONLY — the normalizer strips it (pids are host
//     noise and never enter a normalized record).
// ═══════════════════════════════════════════════════════════════════════════

import { captureSnapshot } from "./normalize.js";

export const SCENARIO_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RECORD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const RECOMMENDED_ERROR_PHASES = [
  "setup",
  "sync-throw",
  "promise-rejection",
  "callback",
  "teardown",
];

export function createRecorder() {
  return {
    values: {},
    snapshots: {},
    errors: [],
    descriptors: {},
    identity: {},
    events: [],
  };
}

function assertRecordKey(key, segment) {
  if (typeof key !== "string" || !RECORD_KEY_PATTERN.test(key)) {
    throw new TypeError(
      `api.record.${segment}: key must match ${RECORD_KEY_PATTERN}, got ${JSON.stringify(key)}`,
    );
  }
}

// Builds the api object handed to a scenario run. The recorder buffers raw
// observations; normalization happens in the probe process after the scenario
// completes (see normalize.js).
export function createScenarioApi(targetId, dom, recorder) {
  return {
    target: targetId,
    dom,
    record: {
      value(key, value) {
        assertRecordKey(key, "value");
        recorder.values[key] = value;
      },
      event(name, detail = null) {
        if (typeof name !== "string" || name.length === 0) {
          throw new TypeError("api.record.event: name must be a non-empty string");
        }
        recorder.events.push({ name, detail });
      },
      error(error, phase) {
        if (typeof phase !== "string" || phase.length === 0) {
          throw new TypeError(
            "api.record.error: phase must be a non-empty string describing the throw phase",
          );
        }
        recorder.errors.push({ error, phase });
      },
      snapshot(key, node) {
        assertRecordKey(key, "snapshot");
        // Eager capture: later mutations must not change what was recorded.
        recorder.snapshots[key] = captureSnapshot(node);
      },
      descriptor(key, object, propertyKey) {
        assertRecordKey(key, "descriptor");
        recorder.descriptors[key] = Object.getOwnPropertyDescriptor(object, propertyKey) ?? null;
      },
      identity(label, a, b) {
        assertRecordKey(label, "identity");
        recorder.identity[label] = Object.is(a, b);
      },
    },
  };
}

// Validates a scenario module namespace; returns a list of problems
// (empty = valid).
export function describeScenarioProblems(moduleNamespace, sourcePath) {
  const problems = [];
  const at = sourcePath ?? "(unknown source)";
  if (typeof moduleNamespace?.id !== "string" || !SCENARIO_ID_PATTERN.test(moduleNamespace.id)) {
    problems.push(`${at}: export "id" must be a kebab-case string, got ${JSON.stringify(moduleNamespace?.id)}`);
  }
  if (typeof moduleNamespace?.description !== "string" || moduleNamespace.description.trim() === "") {
    problems.push(`${at}: export "description" must be a non-empty string`);
  }
  if (typeof moduleNamespace?.run !== "function") {
    problems.push(`${at}: export "run" must be a function`);
  }
  const targets = moduleNamespace?.targets;
  if (targets !== undefined && targets !== "real" && targets !== "mock" && !isTargetPair(targets)) {
    problems.push(
      `${at}: export "targets" must be "real", "mock", or a two-element array of target ids, ` +
        `got ${JSON.stringify(targets)}`,
    );
  }
  return problems;
}

function isTargetPair(targets) {
  return (
    Array.isArray(targets) &&
    targets.length === 2 &&
    targets.every((target) => typeof target === "string" && target.length > 0)
  );
}
