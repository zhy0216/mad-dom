// Native binding loader (T49 / ADR-0005 §3, §6, §8, §9).
//
// Single source of the require-time native resolution chain, shared by the
// package entry (js/entry.js) and every facade module that reaches the
// binding (window.js, custom-elements.js, mutation-observer.js). The chain is
// identical for source checkouts and installed npm packages (ADR-0005 §3):
//
//   1. `MAD_DOM_NATIVE_PATH` — explicit override (absolute, or relative to the
//      current working directory), for CI install smoke and local debugging;
//   2. the npm platform package `@mad-dom/platform-<os>-<arch>[-<libc>]`
//      (ADR-0005 §5). On linux the detected-libc variant is tried first and the
//      other variant once as a fallback (ADR-0005 §6), so installers that do
//      not trim optional dependencies by `libc` (older npm / Bun behavior) and
//      installers that do both end up with the right binary;
//   3. the repository-local dev artifact `build/mad-dom.node` (source
//      checkouts only; produced by `npm run dev:build`; git-ignored). An
//      installed npm tarball never ships this path, so no dev/release branch
//      is needed in the loader itself.
//
// Loading is lazy (importing this module is side-effect free) but fail-fast on
// first use: the first native-backed call resolves the chain and, once a
// module loads, runs the ABI probe (ADR-0005 §8) before handing it out. Every
// failure throws an `Error` with a stable `code` (ADR-0005 §9):
//
//   * `MAD_DOM_UNSUPPORTED_PLATFORM` — the platform is not in the supported
//     matrix, the platform package is missing / not installed, or its binary
//     failed to load (details in the message; classifications are
//     distinguishable by the stable phrases the install smoke asserts);
//   * `MAD_DOM_ABI_MISMATCH` — the loaded binding's `abiVersion()` disagrees
//     with this package's expected ABI constant (mixed-version install);
//   * `MAD_DOM_NATIVE_NOT_FOUND` — source checkout with neither a dev artifact
//     nor an installed platform package (points at `npm run dev:build`).
//
// There is deliberately no pure-JS fallback DOM and no silent no-op: any load
// failure surfaces on the first native-backed call, never as a fake Window or
// a deferred error (ADR-0005 §8, §9).

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/// ABI version of the native binding. Must match `ABI_VERSION` in
/// crates/mad-dom-bun/src/api.rs (ADR-0005 §8). Bump both in lockstep when the
/// native surface changes in a way a stale package + native pair could
/// misdetect.
export const EXPECTED_ABI_VERSION = 1;

// Stable anchor text pointing at the README support-matrix section. The
// install smoke asserts that every load error carries it (ADR-0005 §9: the
// message must reference the support matrix so versions cannot drift).
export const SUPPORT_MATRIX_REFERENCE = 'see the "Support matrix" section in the README';

// npm `cpu` value → the arch name used in the musl dynamic-loader path on
// linux (e.g. /lib/ld-musl-x86_64.so.1), which differs from process.arch.
const MUSL_LOADER_ARCH = { x64: "x86_64", arm64: "aarch64" };

// The supported platform matrix, keyed by npm `os` (process.platform) and
// `cpu` (process.arch) values (ADR-0005 §2). libc only exists on linux; both
// gnu and musl variants are explicit platform packages.
const MATRIX = {
  darwin: { x64: true, arm64: true },
  linux: { x64: true, arm64: true },
  win32: { x64: true },
};

let native = null;
let nativeLoadError = null;

/// Test-only reset so a single test process can exercise multiple failure
/// paths. Not part of the package contract.
export function resetNativeLoaderForTests() {
  native = null;
  nativeLoadError = null;
}

export function isSupportedPlatform(platform, arch) {
  return Boolean(MATRIX[platform]?.[arch]);
}

/// Detects the linux libc flavor by probing for the musl dynamic loader
/// (ADR-0005 §6): the presence of a musl loader path means musl, otherwise
/// glibc is assumed.
export function detectLinuxLibc(arch) {
  const loaderArch = MUSL_LOADER_ARCH[arch] ?? arch;
  const probes = [`/lib/ld-musl-${loaderArch}.so.1`, `/usr/lib/ld-musl-${loaderArch}.so.1`];
  if (probes.some((path) => existsSync(path))) return "musl";
  return "gnu";
}

export function platformPackageName(platform, arch, libc) {
  if (!isSupportedPlatform(platform, arch)) return null;
  const libcSegment = platform === "linux" ? `-${libc ?? detectLinuxLibc(arch)}` : "";
  return `@mad-dom/platform-${platform}-${arch}${libcSegment}`;
}

export function platformInfo() {
  // Test / dry-run overrides so the install smoke and loader tests can assert
  // the unsupported-platform path on any host. Documented as such; they are
  // not part of the resolution contract. `MAD_DOM_TEST_DISABLE_DEV_ARTIFACT`
  // makes the loader behave like an installed package (no repository-local
  // dev artifact, no source-checkout dev error).
  const platform = process.env.MAD_DOM_TEST_PLATFORM ?? process.platform;
  const arch = process.env.MAD_DOM_TEST_ARCH ?? process.arch;
  const libc = platform === "linux" ? detectLinuxLibc(arch) : null;
  return { platform, arch, libc };
}

// `crates/` ships only in source checkouts; an installed npm tarball never
// contains it (package.json `files`), so this distinguishes the dev form from
// the published form (dev: `MAD_DOM_NATIVE_NOT_FOUND`, published:
// `MAD_DOM_UNSUPPORTED_PLATFORM`).
function sourceCheckoutMarker() {
  return fileURLToPath(new URL("../crates", import.meta.url));
}

function isSourceCheckout() {
  if (process.env.MAD_DOM_TEST_DISABLE_DEV_ARTIFACT === "1") return false;
  return existsSync(sourceCheckoutMarker());
}

function repoLocalArtifactPath() {
  return fileURLToPath(new URL("../build/mad-dom.node", import.meta.url));
}

function tryRequire(path, onFailure) {
  try {
    return require(path);
  } catch (error) {
    onFailure({
      message: error?.message ?? String(error),
      // `require()` throws MODULE_NOT_FOUND when the module (or its .node
      // entry) is simply absent; anything else means it was found but failed
      // to load (dlopen, corruption, architecture mismatch).
      notFound: error?.code === "MODULE_NOT_FOUND",
    });
    return null;
  }
}

function tryPlatformPackages(info, attempts) {
  const { platform, arch, libc } = info;
  if (!isSupportedPlatform(platform, arch)) return null;

  const names = [];
  if (platform === "linux") {
    const variants = libc === "musl" ? ["musl", "gnu"] : ["gnu", "musl"];
    for (const variant of variants) {
      names.push(`@mad-dom/platform-${platform}-${arch}-${variant}`);
    }
  } else {
    names.push(`@mad-dom/platform-${platform}-${arch}`);
  }

  for (const name of names) {
    const loaded = tryRequire(name, (failure) =>
      attempts.push({ label: name, message: failure.message, notFound: failure.notFound }),
    );
    if (loaded !== null) return loaded;
  }
  return null;
}

function probeAbi(module) {
  const actual = typeof module?.abiVersion === "function" ? module.abiVersion() : undefined;
  if (actual === EXPECTED_ABI_VERSION) return null;
  const error = new Error(
    `mad-dom native binding ABI mismatch: this package expects ABI ${EXPECTED_ABI_VERSION} but the loaded binding reports ` +
      `${actual === undefined ? "no ABI probe" : actual}. The main package and the platform package are ` +
      `a mismatched version pair (mixed-version install); reinstall matching versions. ${SUPPORT_MATRIX_REFERENCE}`,
  );
  error.code = "MAD_DOM_ABI_MISMATCH";
  return error;
}

function buildLoadError(info, attempts) {
  const { platform, arch, libc } = info;
  const platformLabel = libc ? `${platform}/${arch}/${libc}` : `${platform}/${arch}`;

  if (!isSupportedPlatform(platform, arch)) {
    const error = new Error(
      `mad-dom cannot load its native binding: platform ${platform}/${arch}${libc ? `/${libc}` : ""} ` +
        `is not in the supported matrix. ${SUPPORT_MATRIX_REFERENCE}`,
    );
    error.code = "MAD_DOM_UNSUPPORTED_PLATFORM";
    return error;
  }

  const tried =
    attempts.length === 0
      ? "no candidate module was attempted"
      : attempts.map((a) => `"${a.label}" failed: ${a.message}`).join("; ");

  const presentButFailed = attempts.some((a) => !a.notFound);

  if (!presentButFailed && isSourceCheckout()) {
    // Dev form: no dev artifact and no installed platform package. Keep the
    // pre-T49 code for the source-checkout case so `npm run dev:build` stays
    // the documented local entry point (ADR-0005 §3).
    const error = new Error(
      `mad-dom native binding could not be loaded from ${repoLocalArtifactPath()}. ` +
        "Build it with `npm run dev:build` in a source checkout, or point MAD_DOM_NATIVE_PATH at a " +
        `built artifact. Tried: ${tried}.`,
    );
    error.code = "MAD_DOM_NATIVE_NOT_FOUND";
    return error;
  }

  let guidance;
  if (presentButFailed) {
    guidance =
      "The platform package is present but could not be loaded (corrupt artifact, architecture, or " +
      "dlopen failure).";
  } else {
    guidance =
      "Reinstall without --no-optional (the matching platform package is missing; if this version does " +
      "not bundle your platform, it is declared but not included).";
  }

  const error = new Error(
    `mad-dom cannot load its native binding for ${platformLabel}. Tried: ${tried}. ${guidance} ${SUPPORT_MATRIX_REFERENCE}`,
  );
  error.code = "MAD_DOM_UNSUPPORTED_PLATFORM";
  return error;
}

export function loadNative() {
  if (native !== null) return native;
  if (nativeLoadError !== null) throw nativeLoadError;

  const info = platformInfo();
  const attempts = [];
  let loaded = null;

  // 1. Explicit override.
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
    loaded = tryRequire(path, (failure) =>
      attempts.push({ label: `MAD_DOM_NATIVE_PATH ${path}`, message: failure.message, notFound: failure.notFound }),
    );
  }

  // 2. npm platform package (linux: dual-libc fallback).
  if (loaded === null) {
    loaded = tryPlatformPackages(info, attempts);
  }

  // 3. Repository-local dev artifact (source checkouts only).
  if (loaded === null && isSourceCheckout()) {
    const path = repoLocalArtifactPath();
    loaded = tryRequire(path, (failure) =>
      attempts.push({ label: path, message: failure.message, notFound: failure.notFound }),
    );
  }

  if (loaded === null) {
    nativeLoadError = buildLoadError(info, attempts);
    throw nativeLoadError;
  }

  // ABI probe before the binding is considered usable (ADR-0005 §8).
  const abiError = probeAbi(loaded);
  if (abiError !== null) {
    nativeLoadError = abiError;
    throw nativeLoadError;
  }

  native = loaded;
  return native;
}

export function isNativeAvailable() {
  try {
    loadNative();
    return true;
  } catch {
    return false;
  }
}

export function nativeAbiVersion() {
  return loadNative().abiVersion();
}
