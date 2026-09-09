import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  EXPECTED_FFI_ABI_VERSION,
  FFI_CAPABILITIES,
  ffiCapabilityReport,
  loadNativeFfi,
  resetNativeLoaderForTests,
} from "../../js/native-loader.js";

const PROBE = join(import.meta.dir, "fixtures", "ffi-loader-probe.mjs");
const BIND_PROBE = join(import.meta.dir, "fixtures", "ffi-binding-probe.mjs");
const ARTIFACT = process.env.MAD_DOM_FFI_PATH ?? process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node");

// The scenarios are independent child processes (the loader caches its state
// per process). `process.execPath` re-runs the exact test binary — including
// when this suite runs under the pinned baseline Bun — so a child cannot
// silently fall back to a newer Bun on PATH. Each fixture echoes its own
// `Bun.version`; asserting it equals the parent's is belt-and-braces against
// an exec-path mismatch.
//
// Every scenario states the FFI mode it measures. The capability matrix probes
// what the loader does when FFI resolution is *attempted*, so the default child
// env passes MAD_DOM_FFI_DISABLED="0" instead of inheriting the parent's value:
// a global off lane (validate under MAD_DOM_FFI_DISABLED=1) must not silently
// turn "enabled probe", "missing artifact", "ABI mismatch", "partial", "missing
// symbol" and the binding probes into observations of the env short-circuit.
// The one test that measures that short-circuit names MAD_DOM_FFI_DISABLED in
// `extra`, which is spread last and therefore still wins.
function runProbe(extra = {}) {
  return runProbeFile("ffi-loader-probe.mjs", extra, /^PROBE (\{.*\})$/m);
}

function runProbeFile(name, extra = {}, pattern = /^BIND (\{.*\})$/m) {
  const fixture = name === "ffi-loader-probe.mjs" ? PROBE : BIND_PROBE;
  const proc = Bun.spawnSync([process.execPath, fixture], {
    env: {
      ...process.env,
      MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH ?? resolve("build/mad-dom.node"),
      MAD_DOM_FFI_PATH: ARTIFACT,
      MAD_DOM_FFI_DISABLED: "0",
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${proc.stdout}\n${proc.stderr}`);
  const result = JSON.parse(proc.stdout.toString().match(pattern)?.[1] ?? "{}");
  expect(result.bunVersion).toBe(Bun.version);
  return result;
}

describe("Bun FFI loader capability matrix", () => {
  test("enabled probe is additive and records the independent ABI", () => {
    if (!existsSync(ARTIFACT)) return;
    const result = runProbe();
    expect(["available", "partial"]).toContain(result.status);
    expect(result.abiVersion).toBe(EXPECTED_FFI_ABI_VERSION);
    expect(result.publicStatus).toBe(result.status);
    expect(result.capabilities & FFI_CAPABILITIES.querySnapshot).toBeTruthy();
  });

  test("disabled FFI keeps the process on Node-API", () => {
    const result = runProbe({ MAD_DOM_FFI_DISABLED: "1" });
    expect(result.status).toBe("disabled");
    expect(result.reason).toContain("MAD_DOM_FFI_DISABLED");
  });

  test("missing FFI artifact is a data report, not a load failure", () => {
    const result = runProbe({ MAD_DOM_FFI_PATH: resolve("build/does-not-exist-ffi") });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("does not exist");
  });

  test("ABI mismatch falls back without throwing from the loader", () => {
    if (!existsSync(ARTIFACT)) return;
    const result = runProbe({ MAD_DOM_TEST_FFI_ABI_VERSION: "999" });
    expect(result.status).toBe("mismatch");
    expect(result.code).toBe("MAD_DOM_FFI_ABI_MISMATCH");
    expect(result.expectedAbiVersion).toBe(EXPECTED_FFI_ABI_VERSION);
  });

  test("partial capabilities retain the supported operation and report the gap", () => {
    if (!existsSync(ARTIFACT)) return;
    const result = runProbe({ MAD_DOM_TEST_FFI_CAPABILITIES: String(FFI_CAPABILITIES.querySnapshot) });
    expect(result.status).toBe("partial");
    expect(result.advertisedCapabilities).toBe(FFI_CAPABILITIES.querySnapshot);
    expect(result.capabilities & FFI_CAPABILITIES.querySnapshot).toBeTruthy();
    expect(result.capabilities & FFI_CAPABILITIES.serializeIntoBuffer).toBe(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  test("a genuinely missing advertised symbol is a per-symbol partial, not available", () => {
    if (!existsSync(ARTIFACT)) return;
    // childSnapshot and preorderSnapshot advertise the same bit. Forcing only
    // preorderSnapshot to fail dlopen must NOT leave a preorderSnapshot method
    // pointing at undefined, and must NOT report available just because the
    // sibling child symbol kept the shared bit set.
    const result = runProbe({ MAD_DOM_TEST_FFI_MISSING_SYMBOLS: "preorderSnapshot" });
    expect(result.status).toBe("partial");
    expect(result.symbols).not.toContain("mad_dom_ffi_preorder_snapshot");
    expect(result.symbols).toContain("mad_dom_ffi_child_tokens");
    expect(result.missing.some((entry) => entry.name === "mad_dom_ffi_preorder_snapshot")).toBe(true);
  });

  test("a second same-ABI image cannot bind documents and records the image reason", () => {
    if (!existsSync(ARTIFACT)) return;
    const copyDir = mkdtempSync(join(tmpdir(), "mad-dom-ffi-second-image-"));
    try {
      const copy = join(copyDir, "mad-dom.node");
      copyFileSync(ARTIFACT, copy);
      const result = runProbeFile("ffi-binding-probe.mjs", { MAD_DOM_FFI_PATH: copy });
      expect(result.bound).toBe(false);
      expect(result.imageReason).toContain("different file");
      expect(result.status).toBe("available");
    } finally {
      rmSync(copyDir, { recursive: true, force: true });
    }
  });

  test("the exact Node-API image binds documents", () => {
    if (!existsSync(ARTIFACT)) return;
    const result = runProbeFile("ffi-binding-probe.mjs", { MAD_DOM_FFI_PATH: ARTIFACT });
    expect(result.bound).toBe(true);
    expect(result.imageReason).toBeNull();
  });
});

test("in-process report remains resettable for fallback tests", () => {
  const report = ffiCapabilityReport();
  expect(report).toHaveProperty("status");
  resetNativeLoaderForTests();
  expect(loadNativeFfi()).toHaveProperty("status");
});
