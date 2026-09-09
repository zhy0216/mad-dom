import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FFI_CAPABILITIES } from "../../js/native-loader.js";

// Todo 03 facade hot-path contract: when the shared image exposes FFI, the
// first-stage facade operations actually cross into bun:ffi, and every other
// state (disabled, missing, ABI mismatch, partial capability, second image)
// produces a byte-identical public digest. Each scenario runs in its own child
// process because the loader caches its resolution per process.
//
// Children run through `process.execPath` so a baseline-Bun parent launches a
// baseline-Bun child (not a newer `bun` on PATH); each fixture echoes its own
// `Bun.version`, and `digest()` asserts it equals the parent's before any
// comparison.
//
// Every child gets an explicit FFI mode instead of the parent's ambient one.
// The default is MAD_DOM_FFI_DISABLED="0" because a scenario that names no
// mode measures the enabled hot path: the trace proves the FFI methods are
// really called, and the digest comparison must pit a real FFI run against a
// Node-API run. A scenario that wants a different state names it in
// `extraEnv`, which is spread last and therefore always wins. Inheriting the
// parent env instead would let a global MAD_DOM_FFI_DISABLED=1 run compare
// Node-API digests with Node-API digests and report that as FFI parity.

const WORKLOAD = join(import.meta.dir, "fixtures", "ffi-facade-workload.mjs");
const TRACE = join(import.meta.dir, "fixtures", "ffi-call-trace.mjs");
const ARTIFACT = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");
const hasArtifact = existsSync(ARTIFACT);

function runFixture(fixture, extraEnv = {}) {
  const proc = Bun.spawnSync([process.execPath, fixture], {
    env: {
      ...process.env,
      MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node"),
      MAD_DOM_FFI_DISABLED: "0",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${proc.stdout}\n${proc.stderr}`);
  return proc.stdout.toString().match(/^(?:WORKLOAD|TRACE) (\{.*\})$/m)?.[1];
}

function digest(extraEnv) {
  const json = runFixture(WORKLOAD, extraEnv);
  if (json === undefined) throw new Error("workload produced no digest");
  const parsed = JSON.parse(json);
  expect(parsed.bunVersion).toBe(Bun.version);
  return parsed;
}

// Runtime identity (`bunVersion`) and the FFI path-hit proof (`ffiMethods`)
// are scenario metadata, not public DOM results; strip them before comparing
// the public digest across capability states.
function digestWithoutScenarioMeta(extraEnv) {
  const { ffiMethods: _ffiMethods, bunVersion: _bunVersion, ...rest } = digest(extraEnv);
  return rest;
}

describe("Bun FFI facade hot path", () => {
  test("FFI-enabled workload actually calls the FFI methods", () => {
    if (!hasArtifact) return;
    const json = runFixture(TRACE);
    const trace = JSON.parse(json);
    expect(trace.bunVersion).toBe(Bun.version);
    expect(trace.bound).toBe(true);
    expect(trace.calls).toContain("querySnapshot");
    expect(trace.calls).toContain("childSnapshot");
    expect(trace.calls).toContain("serialize");
    expect(trace.calls).toContain("createElements");
  });

  test("facade digest is identical across every FFI capability state", () => {
    if (!hasArtifact) return;
    const nodeApiOnly = digestWithoutScenarioMeta({ MAD_DOM_FFI_DISABLED: "1" });
    const enabled = digestWithoutScenarioMeta({});
    expect(enabled).toEqual(nodeApiOnly);

    const missing = digestWithoutScenarioMeta({ MAD_DOM_FFI_PATH: resolve("build/does-not-exist-ffi") });
    expect(missing).toEqual(nodeApiOnly);

    const mismatch = digestWithoutScenarioMeta({ MAD_DOM_TEST_FFI_ABI_VERSION: "999" });
    expect(mismatch).toEqual(nodeApiOnly);

    // Only query snapshot is advertised: every other operation must fall back
    // to Node-API while the query fast path stays FFI-backed.
    const partial = digestWithoutScenarioMeta({
      MAD_DOM_TEST_FFI_CAPABILITIES: String(FFI_CAPABILITIES.querySnapshot),
    });
    expect(partial).toEqual(nodeApiOnly);

    // A genuinely missing advertised symbol (preorder exported but its sibling
    // child missing) must also keep the public digest identical via per-method
    // Node-API fallback.
    const missingSymbol = digestWithoutScenarioMeta({ MAD_DOM_TEST_FFI_MISSING_SYMBOLS: "preorderSnapshot" });
    expect(missingSymbol).toEqual(nodeApiOnly);
  });

  test("a second same-ABI image is refused for documents and falls back to Node-API", () => {
    if (!hasArtifact) return;
    const copyDir = mkdtempSync(join(tmpdir(), "mad-dom-ffi-copy-"));
    try {
      const copy = join(copyDir, "mad-dom.node");
      copyFileSync(ARTIFACT, copy);
      const secondImage = digestWithoutScenarioMeta({ MAD_DOM_FFI_PATH: copy });
      const nodeApiOnly = digestWithoutScenarioMeta({ MAD_DOM_FFI_DISABLED: "1" });
      expect(secondImage).toEqual(nodeApiOnly);
    } finally {
      // A split-registry digest equal to Node-API proves the facade never
      // surfaced INVALID_DOCUMENT; remove only the temp copy we created.
      rmSync(copyDir, { recursive: true, force: true });
    }
  });

  test("FFI-disabled and missing scenarios report the mounted-method gap", () => {
    if (!hasArtifact) return;
    const disabled = digest({ MAD_DOM_FFI_DISABLED: "1" });
    const missing = digest({ MAD_DOM_FFI_PATH: resolve("build/does-not-exist-ffi") });
    const mismatch = digest({ MAD_DOM_TEST_FFI_ABI_VERSION: "999" });
    expect(disabled.ffiMethods).toEqual([]);
    expect(missing.ffiMethods).toEqual([]);
    expect(mismatch.ffiMethods).toEqual([]);
    // The FFI-enabled run mounts the whole first-stage adapter.
    const enabled = digest({});
    expect(enabled.ffiMethods.sort()).toEqual(
      ["querySnapshot", "preorderSnapshot", "childSnapshot", "serialize", "createElements", "readBatch"].sort(),
    );
  });
});
