import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const project = Object.freeze({
  name: "mad-dom",
  version: "0.0.1-alpha.0",
  status: "pre-alpha",
  runtime: "bun",
  architecture: "native-memory-arena"
});

// Native binding loader (dev form, T19 / ADR-0005 §3).
//
// Resolution order:
//   1. `MAD_DOM_NATIVE_PATH` — explicit override (absolute, or relative to
//      the current working directory), for CI install smoke and local
//      debugging;
//   2. the repository-local dev artifact `build/mad-dom.node` (produced by
//      `npm run dev:build`; git-ignored, never packed into the npm tarball).
//
// The npm platform-package path and the full `MAD_DOM_ABI_MISMATCH` load-time
// probe are wired by T49. Until then loading is lazy: `createDocument()` and
// friends fail fast with `MAD_DOM_NATIVE_NOT_FOUND` when no artifact exists.
let native = null;
let nativeLoadError = null;

function resolveNativePath() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  return fileURLToPath(new URL("./build/mad-dom.node", import.meta.url));
}

function loadNative() {
  if (native !== null) return native;
  if (nativeLoadError !== null) throw nativeLoadError;
  const path = resolveNativePath();
  const require = createRequire(import.meta.url);
  try {
    native = require(path);
    return native;
  } catch (error) {
    nativeLoadError = new Error(
      `mad-dom native binding could not be loaded from ${path}. ` +
        "Build it with `npm run dev:build` in a source checkout, or point " +
        "MAD_DOM_NATIVE_PATH at a built artifact. " +
        `Original error: ${error?.message ?? error}`,
      { cause: error },
    );
    nativeLoadError.code = "MAD_DOM_NATIVE_NOT_FOUND";
    throw nativeLoadError;
  }
}

// Native-backed minimal Core API (T19). Not the DOM facade — Window/Document
// land with T22; wrapper identity and the full error table land with T20/T21.
export function isNativeAvailable() {
  try {
    loadNative();
    return true;
  } catch {
    return false;
  }
}

export function createDocument() {
  return loadNative().createDocument();
}

export function liveDocumentCount() {
  return loadNative().liveDocumentCount();
}

export function nativeAbiVersion() {
  return loadNative().abiVersion();
}

export function createWindow() {
  throw new Error("mad-dom is in pre-alpha development and does not implement Window yet.");
}
