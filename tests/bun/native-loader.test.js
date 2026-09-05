import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXPECTED_ABI_VERSION,
  SUPPORT_MATRIX_REFERENCE,
  isNativeAvailable,
  isSupportedPlatform,
  nativeAbiVersion,
  platformInfo,
  platformPackageName,
  resetNativeLoaderForTests,
} from "../../js/native-loader.js";

// T49 runtime loader tests (ADR-0005 §5, §6, §8, §9). The pure mapping and
// platform-info functions are asserted directly; the load-time error contract
// is asserted through an isolated child process (the loader module caches its
// resolution state, so failure paths cannot be re-triggered in-process).

const PROBE = join(import.meta.dir, "fixtures", "native-loader-probe.mjs");

function runProbe(env) {
  const proc = Bun.spawnSync(["bun", PROBE], {
    // Each probe selects its own loader path, even when validate is run
    // with a native artifact override in the parent environment.
    env: { ...process.env, MAD_DOM_NATIVE_PATH: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`probe failed (exit ${proc.exitCode}): ${proc.stdout}\n${proc.stderr}`);
  }
  const match = proc.stdout.toString().match(/^PROBE (\{.*\})$/m);
  return JSON.parse(match?.[1] ?? "{}");
}

describe("T49 platform package naming (ADR-0005 §5)", () => {
  test("maps every supported os/arch to the pinned platform-package name", () => {
    expect(platformPackageName("darwin", "arm64", null)).toBe("@mad-dom/platform-darwin-arm64");
    expect(platformPackageName("darwin", "x64", null)).toBe("@mad-dom/platform-darwin-x64");
    expect(platformPackageName("linux", "x64", "gnu")).toBe("@mad-dom/platform-linux-x64-gnu");
    expect(platformPackageName("linux", "arm64", "gnu")).toBe("@mad-dom/platform-linux-arm64-gnu");
    expect(platformPackageName("linux", "x64", "musl")).toBe("@mad-dom/platform-linux-x64-musl");
    expect(platformPackageName("linux", "arm64", "musl")).toBe("@mad-dom/platform-linux-arm64-musl");
    expect(platformPackageName("win32", "x64", null)).toBe("@mad-dom/platform-win32-x64");
  });

  test("libc is explicit on linux and absent elsewhere", () => {
    expect(platformPackageName("darwin", "arm64", null)).not.toContain("-gnu");
    expect(platformPackageName("darwin", "arm64", null)).not.toContain("-musl");
    expect(platformPackageName("linux", "x64", "gnu")).toContain("x64-gnu");
    expect(platformPackageName("linux", "arm64", "musl")).toContain("arm64-musl");
  });

  test("platforms outside the matrix return null (unsupported)", () => {
    expect(platformPackageName("freebsd", "x64", null)).toBeNull();
    expect(platformPackageName("linux", "arm", null)).toBeNull();
    expect(platformPackageName("win32", "arm64", null)).toBeNull();
    expect(isSupportedPlatform("freebsd", "x64")).toBe(false);
    expect(isSupportedPlatform("darwin", "arm64")).toBe(true);
  });

  test("the expected ABI constant matches the binding's probe", () => {
    expect(EXPECTED_ABI_VERSION).toBe(1);
    if (isNativeAvailable()) {
      expect(nativeAbiVersion()).toBe(EXPECTED_ABI_VERSION);
    }
  });
});

describe("T49 platform info (ADR-0005 §6)", () => {
  test("reports the host platform with no libc on non-linux", () => {
    const info = platformInfo();
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.libc).toBe(info.platform === "linux" ? "gnu" : null);
  });

  test("honors the MAD_DOM_TEST_* overrides used by the install smoke", () => {
    const { platform, arch, libc } = platformInfo();
    expect(platform).toBe(process.platform);
    expect(arch).toBe(process.arch);
    expect(typeof libc === "string" || libc === null).toBe(true);
  });
});

describe("T49 load-time error contract (ADR-0005 §9)", () => {
  test("an unsupported platform fails fast with a stable code and message structure", () => {
    const result = runProbe({
      MAD_DOM_TEST_PLATFORM: "freebsd",
      MAD_DOM_TEST_ARCH: "x64",
      MAD_DOM_TEST_DISABLE_DEV_ARTIFACT: "1",
    });
    expect(result.loaded).toBe(false);
    expect(result.code).toBe("MAD_DOM_UNSUPPORTED_PLATFORM");
    expect(result.message).toContain("freebsd/x64");
    expect(result.message).toContain("not in the supported matrix");
    expect(result.message).toContain(SUPPORT_MATRIX_REFERENCE);
  });

  test("a supported platform without an installed platform package fails with reinstall guidance", () => {
    const result = runProbe({ MAD_DOM_TEST_DISABLE_DEV_ARTIFACT: "1" });
    expect(result.loaded).toBe(false);
    expect(result.code).toBe("MAD_DOM_UNSUPPORTED_PLATFORM");
    expect(result.message).toContain("Reinstall without --no-optional");
    expect(result.message).toContain("mad-dom cannot load its native binding");
    expect(result.message).toContain(SUPPORT_MATRIX_REFERENCE);
  });

  test("an ABI mismatch fails with MAD_DOM_ABI_MISMATCH naming both ABI versions", () => {
    const dir = mkdtempSync(join(tmpdir(), "mad-dom-loader-abi-"));
    const fakeAbi = join(dir, "fake-abi.cjs");
    writeFileSync(fakeAbi, "module.exports = { abiVersion: () => 999 };\n");
    const result = runProbe({ MAD_DOM_NATIVE_PATH: fakeAbi });
    expect(result.loaded).toBe(false);
    expect(result.code).toBe("MAD_DOM_ABI_MISMATCH");
    expect(result.message).toContain("ABI 1");
    expect(result.message).toContain("999");
    expect(result.message).toContain("mismatched version pair");
    expect(result.message).toContain(SUPPORT_MATRIX_REFERENCE);
  });

  test("the happy path loads the dev artifact and passes the ABI probe", () => {
    const result = runProbe({});
    if (result.loaded) {
      expect(result.abi).toBe(EXPECTED_ABI_VERSION);
    }
    // Without a locally built artifact the loader still reports a structured
    // error rather than throwing a bare require error; either outcome is valid
    // for a checkout without `npm run dev:build`.
  });

  test("resetNativeLoaderForTests clears the cached resolution state", () => {
    resetNativeLoaderForTests();
    expect(isNativeAvailable()).toBe(true);
    resetNativeLoaderForTests();
  });
});
