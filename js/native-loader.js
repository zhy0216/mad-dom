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

import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/// ABI version of the native binding. Must match `ABI_VERSION` in
/// crates/mad-dom-bun/src/api.rs (ADR-0005 §8). Bump both in lockstep when the
/// native surface changes in a way a stale package + native pair could
/// misdetect.
export const EXPECTED_ABI_VERSION = 1;

// The Bun channel has an ABI independent from the Node-API object ABI. Keep
// this contract in the loader so an installed package can disable only the
// data fast path while retaining the object/lifecycle binding.
export const EXPECTED_FFI_ABI_VERSION = 1;
export const FFI_CAPABILITIES = Object.freeze({
  querySnapshot: 1 << 0,
  preorderSnapshot: 1 << 1,
  tokenBatch: 1 << 2,
  serializeIntoBuffer: 1 << 3,
  attributeTextBatch: 1 << 4,
});
export const FFI_SYMBOLS = Object.freeze({
  abiVersion: "mad_dom_ffi_abi_version",
  capabilities: "mad_dom_ffi_capabilities",
  querySnapshot: "mad_dom_ffi_query_snapshot",
  preorderSnapshot: "mad_dom_ffi_preorder_snapshot",
  childSnapshot: "mad_dom_ffi_child_tokens",
  serialize: "mad_dom_ffi_serialize",
  createElements: "mad_dom_ffi_create_elements",
  readBatch: "mad_dom_ffi_read_batch",
});
const FFI_EXPECTED_CAPABILITIES = Object.values(FFI_CAPABILITIES).reduce(
  (value, bit) => value | bit,
  0,
);
const FFI_SYMBOL_DECLARATIONS = Object.freeze({
  [FFI_SYMBOLS.abiVersion]: { args: [], returns: "u32" },
  [FFI_SYMBOLS.capabilities]: { args: [], returns: "u32" },
  [FFI_SYMBOLS.querySnapshot]: {
    args: ["u32", "u32", "u32", "buffer", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  [FFI_SYMBOLS.preorderSnapshot]: {
    args: ["u32", "u32", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  [FFI_SYMBOLS.childSnapshot]: {
    args: ["u32", "u32", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  [FFI_SYMBOLS.serialize]: {
    args: ["u32", "u32", "u32", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  [FFI_SYMBOLS.createElements]: {
    args: ["u32", "u32", "buffer", "u32", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  [FFI_SYMBOLS.readBatch]: {
    args: ["u32", "u32", "buffer", "u32", "u32", "ptr", "u32", "ptr"],
    returns: "i32",
  },
});
const FFI_SYMBOL_BITS = Object.freeze({
  [FFI_SYMBOLS.querySnapshot]: FFI_CAPABILITIES.querySnapshot,
  [FFI_SYMBOLS.preorderSnapshot]: FFI_CAPABILITIES.preorderSnapshot,
  [FFI_SYMBOLS.childSnapshot]: FFI_CAPABILITIES.preorderSnapshot,
  [FFI_SYMBOLS.serialize]: FFI_CAPABILITIES.serializeIntoBuffer,
  [FFI_SYMBOLS.createElements]: FFI_CAPABILITIES.tokenBatch,
  [FFI_SYMBOLS.readBatch]: FFI_CAPABILITIES.attributeTextBatch,
});

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
let nativePath = null;
let ffiState = null;
let ffiImageState = null;

/// Test-only reset so a single test process can exercise multiple failure
/// paths. Not part of the package contract.
export function resetNativeLoaderForTests() {
  native = null;
  nativeLoadError = null;
  nativePath = null;
  ffiState = null;
  ffiImageState = null;
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
    if (loaded !== null) {
      try {
        nativePath = require.resolve(name);
      } catch {
        nativePath = null;
      }
      return loaded;
    }
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
    if (loaded !== null) nativePath = path;
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
    if (loaded !== null) nativePath = path;
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

const FFI_SUFFIX = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
const FFI_DISABLED = /^(1|true|yes)$/i;
const FFI_STATUS = Object.freeze({
  OK: 0,
  BUFFER_TOO_SMALL: 2,
});

function bunRuntime() {
  return typeof globalThis.Bun !== "undefined" || typeof process.versions?.bun === "string";
}

function ffiPathCandidate() {
  const configured = process.env.MAD_DOM_FFI_PATH;
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  if (nativePath !== null) return nativePath;
  const devFfi = fileURLToPath(new URL(`../build/mad-dom-ffi.${FFI_SUFFIX}`, import.meta.url));
  if (existsSync(devFfi)) return devFfi;
  const devNode = repoLocalArtifactPath();
  return existsSync(devNode) ? devNode : null;
}

// Test-only knob: `MAD_DOM_TEST_FFI_MISSING_SYMBOLS=querySnapshot,serialize`
// forces dlopen for those symbols to fail as if the image did not export them,
// so child-process tests can exercise a genuinely partial symbol set without
// compiling a second cdylib. Ignored in normal installations.
function forcedMissingSymbols() {
  const raw = process.env.MAD_DOM_TEST_FFI_MISSING_SYMBOLS;
  if (raw === undefined || raw === "") return undefined;
  const forced = new Set();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (token === "") continue;
    // Accept either the logical short name ("querySnapshot") or the exported
    // C symbol ("mad_dom_ffi_query_snapshot"); both resolve to the same key.
    const resolved = Object.prototype.hasOwnProperty.call(FFI_SYMBOLS, token)
      ? FFI_SYMBOLS[token]
      : token;
    if (FFI_SYMBOL_BITS[resolved] !== undefined) forced.add(resolved);
  }
  return forced.size === 0 ? undefined : forced;
}

function ffiUnavailable(status, reason, extra = {}) {
  return {
    status,
    reason,
    expectedAbiVersion: EXPECTED_FFI_ABI_VERSION,
    expectedCapabilities: FFI_EXPECTED_CAPABILITIES,
    symbols: [],
    ...extra,
  };
}

function ffiError(status, operation) {
  const details = {
    1: ["ERR_MAD_DOM_INVALID_ARGUMENT", "invalid FFI argument"],
    3: ["ERR_MAD_DOM_DOCUMENT_INVALID", "invalid FFI document"],
    4: ["ERR_MAD_DOM_FFI_STALE_GENERATION", "stale FFI document generation"],
    5: ["ERR_MAD_DOM_DOCUMENT_DESTROYED", "the document has been destroyed"],
    6: ["ERR_MAD_DOM_INVALID_HANDLE", "invalid FFI token"],
    7: ["ERR_MAD_DOM_STALE_HANDLE", "stale FFI token"],
    8: ["ERR_MAD_DOM_WRONG_DOCUMENT", "the token belongs to a different document"],
    9: ["ERR_MAD_DOM_INVALID_CHARACTER", "invalid UTF-8 input"],
    10: ["ERR_MAD_DOM_SYNTAX", "syntax error"],
    11: ["ERR_MAD_DOM_HIERARCHY", "the operation would yield an incorrect document tree"],
    12: ["ERR_MAD_DOM_INVALID_CHARACTER", "invalid character"],
    13: ["ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS", "index out of bounds"],
    14: ["ERR_MAD_DOM_NATIVE_PANIC", "native FFI panic"],
  }[status] ?? ["ERR_MAD_DOM_FFI", `FFI operation failed with status ${status}`];
  const error = new Error(`[${details[0]}] ${details[1]}${operation ? ` (${operation})` : ""}`);
  error.code = details[0];
  error.ffiStatus = status;
  return error;
}

function ffiContextValues(context) {
  if (context === null || context === undefined || context.length < 3) {
    throw ffiError(1, "ffiContext");
  }
  return [context[0] >>> 0, context[1] >>> 0, context[2] >>> 0];
}

// Sanity ceiling for a single caller-owned output buffer. Exceeding it is not
// an FFI failure: the operation simply goes back to Node-API, which can grow
// without the loader's fixed working budget. Tuning the budget itself (external
// buffers, deallocators, streaming) is the memory-protocol task; this loader
// only guarantees that an oversized-but-legal result never surfaces as a DOM
// error just because the additive channel declined to buffer it.
const FFI_MAX_OUTPUT_WORDS = 4_000_000;
const FFI_MAX_OUTPUT_BYTES = 64_000_000;

// Returns the caller-owned output slice, or `undefined` when the FFI channel
// cannot serve this operation at its fixed working budget (oversized result or
// a protocol anomaly such as success claiming more words than were supplied).
// `undefined` is the per-operation Node-API fallback signal used by every
// facade caller. Genuine native error statuses (destroyed document, stale or
// foreign token, syntax, …) still throw so the taxonomy stays identical to the
// Node-API path the workload digest compares against.
//
// Length protocol: native always writes the *exact* required element count to
// `written` before returning — BUFFER_TOO_SMALL carries the required size (the
// next capacity) and OK carries the produced size. This loader never trusts a
// reported length beyond `capacity`, and never grows past
// FFI_MAX_OUTPUT_WORDS / FFI_MAX_OUTPUT_BYTES; both violations fall back to
// Node-API instead of allocating from an untrusted count.
function outputWords(call, operation) {
  let capacity = 256;
  for (let attempt = 0; attempt !== 8; attempt += 1) {
    const output = new Uint32Array(capacity);
    const written = new Uint32Array(1);
    const status = call(output, capacity, written);
    if (status === FFI_STATUS.BUFFER_TOO_SMALL) {
      if (written[0] <= capacity) return undefined;
      if (written[0] > FFI_MAX_OUTPUT_WORDS) return undefined;
      capacity = written[0];
      continue;
    }
    if (status !== FFI_STATUS.OK) throw ffiError(status, operation);
    if (written[0] > capacity) return undefined;
    return output.slice(0, written[0]);
  }
  return undefined;
}

function outputBytes(call, operation) {
  let capacity = 1024;
  for (let attempt = 0; attempt !== 8; attempt += 1) {
    const output = new Uint8Array(capacity);
    const written = new Uint32Array(1);
    const status = call(output, capacity, written);
    if (status === FFI_STATUS.BUFFER_TOO_SMALL) {
      if (written[0] <= capacity) return undefined;
      if (written[0] > FFI_MAX_OUTPUT_BYTES) return undefined;
      capacity = written[0];
      continue;
    }
    if (status !== FFI_STATUS.OK) throw ffiError(status, operation);
    if (written[0] > capacity) return undefined;
    return output.slice(0, written[0]);
  }
  return undefined;
}

// Single-shot variant for *mutating* FFI entries (createElements). Native
// guarantees a capacity failure is side-effect free (the element batch is only
// created after the required size is proven to fit), but this loader must
// still never re-invoke a mutating call in a retry loop: a second successful
// invocation would mint a second batch of detached nodes and leak them. The
// caller knows the exact output size up front (one word per token), so one
// correctly-sized attempt either succeeds and returns the batch or falls back
// to Node-API without a repeated mutation.
function outputWordsExact(call, operation, requiredWords) {
  const required = requiredWords >>> 0;
  if (required > FFI_MAX_OUTPUT_WORDS) return undefined;
  const output = new Uint32Array(required);
  const written = new Uint32Array(1);
  const status = call(output, required, written);
  if (status === FFI_STATUS.OK) {
    if (written[0] > required) return undefined;
    return output.slice(0, written[0]);
  }
  // BUFFER_TOO_SMALL on a correctly sized buffer is a protocol anomaly: report
  // the Node-API fallback signal rather than calling the mutating entry again.
  if (status === FFI_STATUS.BUFFER_TOO_SMALL) return undefined;
  throw ffiError(status, operation);
}

function openFfiSymbols(ffi, path, names, declarations = FFI_SYMBOL_DECLARATIONS) {
  const definitions = {};
  for (const name of names) definitions[name] = declarations[name];
  return ffi.dlopen(path, definitions);
}

function buildFfiAdapter(ffi, path, baseLibrary, abiVersion, advertisedCapabilities, forcedMissing) {  const symbols = {};
  const missing = [];
  // Every dlopen handle backing a resolved symbol must stay referenced for as
  // long as the adapter is alive. The raw C function pointers on
  // `library.symbols` are only valid while their shared object stays mapped;
  // Bun's Library is a GC object, so dropping every per-symbol handle would
  // make symbol validity depend on Bun's (unspecified) unload timing. Keeping
  // the handles on the adapter — which the loader report pins for the process
  // lifetime — removes that dependency. `.close()` is never called: the image
  // is the same `.node` the Node-API loader keeps loaded anyway, so the OS
  // reclaims it at process exit.
  const libraries = [];
  const candidates = Object.entries(FFI_SYMBOL_BITS);
  for (const [name, bit] of candidates) {
    if ((advertisedCapabilities & bit) === 0) {
      missing.push({ name, reason: "capability is not advertised" });
      continue;
    }
    // `mad_dom_ffi_child_tokens` and `mad_dom_ffi_preorder_snapshot` both
    // advertise the same capability bit, so availability must be tracked per
    // symbol, not per bit: a partial image may export one and not the other.
    // Test-only knob: request a symbol name the image does not export so the
    // dlopen path fails exactly like a genuinely partial image.
    const forced = forcedMissing?.has(name);
    const openName = forced ? `${name}__missing` : name;
    try {
      const library = openFfiSymbols(ffi, path, [openName], forced
        ? { [openName]: FFI_SYMBOL_DECLARATIONS[name] }
        : FFI_SYMBOL_DECLARATIONS);
      const symbol = library.symbols[openName];
      if (typeof symbol !== "function") throw new Error(`symbol ${openName} is not callable`);
      symbols[name] = symbol;
      libraries.push(library);
    } catch (error) {
      missing.push({ name, reason: error?.message ?? String(error) });
    }
  }
  let capabilities = 0;
  for (const [name, bit] of candidates) if (symbols[name] !== undefined) capabilities |= bit;
  // "available" requires the full advertised surface to be backed by callable
  // symbols. Because child/preorder share a capability bit, a symbol-shaped
  // gap (present bit, missing symbol) must still report partial.
  const reportStatus =
    missing.length === 0 && advertisedCapabilities === FFI_EXPECTED_CAPABILITIES
      ? "available"
      : "partial";
  // A method is attached only when the exact symbol backing it was resolved,
  // so "the method exists" is the same statement as "the operation is
  // FFI-backed". Facade branches (including the createElement token pool,
  // which captures the method itself) rely on that equivalence to fall back to
  // Node-API per operation.
  const adapter = {
    abiVersion,
    capabilities,
    advertisedCapabilities,
    symbols: Object.freeze(symbols),
  };
  // Non-enumerable pin so the live handles never serialize (the public
  // capability report strips `adapter` anyway) and never become GC-able while
  // any resolved symbol could still be called.
  Object.defineProperty(adapter, "libraries", { value: libraries, enumerable: false });
  if (symbols[FFI_SYMBOLS.querySnapshot] !== undefined) {
    adapter.querySnapshot = function querySnapshot(context, scopeToken, selector) {
      const [owner, generation, scope] = ffiContextValues(context);
      const bytes = typeof selector === "string" ? new TextEncoder().encode(selector) : selector;
      const symbol = symbols[FFI_SYMBOLS.querySnapshot];
      return outputWords((out, capacity, written) => symbol(owner, generation, scopeToken ?? scope, bytes, bytes.length, out, capacity, written), "query snapshot");
    };
  }
  if (symbols[FFI_SYMBOLS.preorderSnapshot] !== undefined) {
    adapter.preorderSnapshot = function preorderSnapshot(context, rootToken) {
      const [owner, generation] = ffiContextValues(context);
      const symbol = symbols[FFI_SYMBOLS.preorderSnapshot];
      return outputWords((out, capacity, written) => symbol(owner, generation, rootToken, out, capacity, written), "preorder snapshot");
    };
  }
  if (symbols[FFI_SYMBOLS.childSnapshot] !== undefined) {
    adapter.childSnapshot = function childSnapshot(context, rootToken) {
      const [owner, generation] = ffiContextValues(context);
      const symbol = symbols[FFI_SYMBOLS.childSnapshot];
      return outputWords((out, capacity, written) => symbol(owner, generation, rootToken, out, capacity, written), "child snapshot");
    };
  }
  if (symbols[FFI_SYMBOLS.serialize] !== undefined) {
    adapter.serialize = function serialize(context, rootToken, mode = 0) {
      const [owner, generation] = ffiContextValues(context);
      const symbol = symbols[FFI_SYMBOLS.serialize];
      return outputBytes((out, capacity, written) => symbol(owner, generation, rootToken, mode, out, capacity, written), "serialize");
    };
  }
  if (symbols[FFI_SYMBOLS.createElements] !== undefined) {
    adapter.createElements = function createElements(context, name, count) {
      const [owner, generation] = ffiContextValues(context);
      const bytes = typeof name === "string" ? new TextEncoder().encode(name) : name;
      const symbol = symbols[FFI_SYMBOLS.createElements];
      // createElements mints `count` detached elements: it must never be
      // repeated by a retry loop (each successful call allocates a fresh
      // batch), so it uses the single-shot exact-capacity helper instead of the
      // growing outputWords retry. One token word per created element.
      return outputWordsExact(
        (out, capacity, written) => symbol(owner, generation, bytes, bytes.length, count, out, capacity, written),
        "create elements",
        count,
      );
    };
  }
  if (symbols[FFI_SYMBOLS.readBatch] !== undefined) {
    adapter.readBatch = function readBatch(context, tokens, field) {
      const [owner, generation] = ffiContextValues(context);
      const input = tokens instanceof Uint32Array ? tokens : Uint32Array.from(tokens ?? []);
      const symbol = symbols[FFI_SYMBOLS.readBatch];
      return outputBytes((out, capacity, written) => symbol(owner, generation, input, input.length, field, out, capacity, written), "read batch");
    };
  }
  return { reportStatus, adapter, symbols: Object.keys(symbols), missing, baseLibrary };
}

function initializeFfi() {
  if (!bunRuntime()) return ffiUnavailable("unavailable", "bun:ffi is only available in Bun");
  if (FFI_DISABLED.test(String(process.env.MAD_DOM_FFI_DISABLED ?? ""))) {
    return ffiUnavailable("disabled", "MAD_DOM_FFI_DISABLED is set");
  }
  let ffi;
  try {
    // createRequire keeps this import lazy and lets Node-API-only runtimes
    // import the package without resolving Bun's experimental module.
    ffi = require("bun:ffi");
  } catch (error) {
    return ffiUnavailable("unavailable", `bun:ffi could not be imported: ${error?.message ?? String(error)}`);
  }
  // `loadNativeFfi()` is a public probe as well as the document-local path
  // used by the facade. Resolve the Node-API candidate first when no explicit
  // FFI path was supplied, so installed platform packages and custom
  // MAD_DOM_NATIVE_PATH artifacts use the exact same image.
  if (process.env.MAD_DOM_FFI_PATH === undefined && nativePath === null) {
    try {
      loadNative();
    } catch {
      // Keep this a capability report. The native loader's error is surfaced
      // by the normal Node-API entry point; FFI remains an additive channel.
    }
  }
  const path = ffiPathCandidate();
  if (path === null || !existsSync(path)) {
    return ffiUnavailable("unavailable", path === null ? "no FFI artifact was found" : `FFI artifact does not exist: ${path}`, { path });
  }
  let baseLibrary;
  try {
    baseLibrary = openFfiSymbols(ffi, path, [FFI_SYMBOLS.abiVersion, FFI_SYMBOLS.capabilities]);
  } catch (error) {
    return ffiUnavailable("unavailable", `FFI library could not be opened: ${error?.message ?? String(error)}`, { path });
  }
  let abiVersion;
  let advertisedCapabilities;
  try {
    abiVersion = baseLibrary.symbols[FFI_SYMBOLS.abiVersion]();
    advertisedCapabilities = baseLibrary.symbols[FFI_SYMBOLS.capabilities]();
  } catch (error) {
    return ffiUnavailable("unavailable", `FFI capability probe failed: ${error?.message ?? String(error)}`, { path });
  }
  // Child-process tests can exercise mismatch/partial fallback without
  // compiling a second platform binary. These knobs are deliberately scoped
  // to the test namespace and are ignored in normal installations.
  if (process.env.MAD_DOM_TEST_FFI_ABI_VERSION !== undefined) {
    const forced = Number(process.env.MAD_DOM_TEST_FFI_ABI_VERSION);
    if (Number.isInteger(forced) && forced >= 0) abiVersion = forced;
  }
  if (process.env.MAD_DOM_TEST_FFI_CAPABILITIES !== undefined) {
    const forced = Number(process.env.MAD_DOM_TEST_FFI_CAPABILITIES);
    if (Number.isInteger(forced) && forced >= 0) advertisedCapabilities = forced;
  }
  if (abiVersion !== EXPECTED_FFI_ABI_VERSION) {
    return ffiUnavailable("mismatch", `FFI ABI mismatch: expected ${EXPECTED_FFI_ABI_VERSION}, got ${abiVersion}`, {
      path,
      abiVersion,
      advertisedCapabilities,
      code: "MAD_DOM_FFI_ABI_MISMATCH",
    });
  }
  const built = buildFfiAdapter(ffi, path, baseLibrary, abiVersion, advertisedCapabilities, forcedMissingSymbols());
  return {
    status: built.reportStatus,
    ...(built.reportStatus === "partial"
      ? { reason: "one or more advertised FFI capabilities or symbols are unavailable" }
      : {}),
    path,
    abiVersion,
    advertisedCapabilities,
    capabilities: built.adapter.capabilities,
    expectedAbiVersion: EXPECTED_FFI_ABI_VERSION,
    expectedCapabilities: FFI_EXPECTED_CAPABILITIES,
    symbols: built.symbols,
    missing: built.missing,
    adapter: built.adapter,
    library: baseLibrary,
  };
}

/**
 * Probe and lazily load the additive Bun FFI channel. The return value is a
 * report in every case; callers must treat `unavailable`, `disabled`,
 * `mismatch` and `partial` as valid Node-API fallback states.
 */
export function loadNativeFfi() {
  if (ffiState === null) ffiState = initializeFfi();
  return ffiState;
}

export const loadFfi = loadNativeFfi;

export function ffiCapabilityReport() {
  const report = loadNativeFfi();
  const { adapter: _adapter, library: _library, ...publicReport } = report;
  return publicReport;
}

export function nativeLoadPath() {
  if (native === null) {
    try {
      loadNative();
    } catch {
      // The caller may still have supplied MAD_DOM_FFI_PATH; preserve it.
    }
  }
  return nativePath;
}

// The FFI document registry is owned by the loaded Node-API image
// (ffi/ABI.md: "loading a second copy creates a separate thread-local
// registry"). A behavior handshake alone cannot distinguish that split from a
// genuinely stale handle, so the loader compares file identity between the FFI
// artifact and the Node-API image before binding documents. Identical files
// (same inode) resolve to one loaded image on the same Bun process; a
// byte-identical second copy has its own registry and is refused with a reason.
function sameFileIdentity(a, b) {
  if (a === b) return true;
  try {
    const left = statSync(a);
    const right = statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    try {
      return realpathSync(a) === realpathSync(b);
    } catch {
      return false;
    }
  }
}

function resolveFfiImage(ffiPath) {
  if (ffiImageState !== null) return ffiImageState;
  const nodePath = nativeLoadPath();
  if (nodePath === null) {
    // No Node-API image is loaded, so no document can reach this channel yet;
    // defer until a document binding asks.
    return null;
  }
  if (sameFileIdentity(ffiPath, nodePath)) {
    ffiImageState = { compatible: true };
    return ffiImageState;
  }
  ffiImageState = {
    compatible: false,
    reason:
      `FFI artifact ${ffiPath} is a different file from the Node-API binding ${nodePath}. ` +
      "The FFI document registry belongs to the Node-API image, so a second copy of the " +
      "library cannot see its documents; pointing MAD_DOM_FFI_PATH at the exact file the " +
      "Node-API loader used restores the FFI channel.",
  };
  return ffiImageState;
}

/** Return an FFI adapter bound to one Node-API document, or null on fallback. */
export function ffiForDocument(documentHandle) {
  const report = loadNativeFfi();
  if (report.adapter === undefined || typeof documentHandle?.ffiContext !== "function") return null;
  const image = resolveFfiImage(report.path);
  if (image !== null && !image.compatible) {
    // Same-ABI second image: record the reason on the report and refuse the
    // document binding so the facade keeps its Node-API behavior instead of
    // surfacing INVALID_DOCUMENT from a foreign registry.
    if (report.imageReason === undefined) report.imageReason = image.reason;
    return null;
  }
  try {
    const context = Uint32Array.from(ffiContextValues(documentHandle.ffiContext()));
    return { adapter: report.adapter, context };
  } catch {
    return null;
  }
}
