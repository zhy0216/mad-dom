#!/usr/bin/env bun
// Bun runtime capability probe for the bun-native-runtime plan (T1).
//
// This file deliberately only observes public Bun APIs. It does not import a
// native DOM binding and it never calls a private JavaScriptCore API. That
// keeps the probe useful on a clean checkout and makes a missing experimental
// capability a data point instead of a process failure.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CAPABILITY_SCHEMA = "mad-dom/bun-capabilities/1";

// This is the contract proposed by T1 for the additive bun:ffi channel. The
// These names are the stable T2 symbols. Keeping them in the probe makes the
// capability report verify the exact library that the Node-API loader uses.
export const FFI_CONTRACT = Object.freeze({
  abiVersion: 1,
  byteOrder: "native",
  capabilityBits: Object.freeze({
    querySnapshot: 1 << 0,
    preorderSnapshot: 1 << 1,
    tokenBatch: 1 << 2,
    serializeIntoBuffer: 1 << 3,
    attributeTextBatch: 1 << 4,
  }),
  ownership: {
    input: "caller-owned; native reads only during the synchronous call",
    output: "caller-owned TypedArray first; external ArrayBuffer only with a deallocator",
    generation: "document-local monotonic generation and owner token",
  },
  symbols: Object.freeze({
    abiVersion: "mad_dom_ffi_abi_version",
    capabilities: "mad_dom_ffi_capabilities",
    querySnapshot: "mad_dom_ffi_query_snapshot",
    preorderSnapshot: "mad_dom_ffi_preorder_snapshot",
    childSnapshot: "mad_dom_ffi_child_tokens",
    serialize: "mad_dom_ffi_serialize",
    createElements: "mad_dom_ffi_create_elements",
    readBatch: "mad_dom_ffi_read_batch",
  }),
});

function status(available, details = {}) {
  return { status: available ? "available" : "unavailable", ...details };
}

function disabledStatus(reason) {
  return { status: "disabled", reason };
}

function safeReadBaseline(root) {
  try {
    return readFileSync(join(root, ".bun-version"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function versionParts(version) {
  return String(version ?? "")
    .split(/[+-]/, 1)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

function callable(value) {
  return typeof value === "function";
}

function probeArrayBuffers(ffi) {
  try {
    const buffer = new ArrayBuffer(16);
    const view = new Uint8Array(buffer);
    view[0] = 0xa5;
    const transfer = callable(ArrayBuffer.prototype.transfer);
    const externalDeallocator = callable(ffi?.toArrayBuffer)
      ? {
          status: "api-present-unverified",
          api: "bun:ffi.toArrayBuffer",
          // Calling this API requires a valid native pointer. T1 records its
          // availability; T4 owns the pointer/deallocator safety test.
          tested: false,
        }
      : {
          status: "unavailable",
          api: "bun:ffi.toArrayBuffer",
          tested: false,
        };
    return {
      ...status(true, { byteLength: buffer.byteLength, typedArray: true, sentinel: view[0] }),
      transfer,
      externalDeallocator,
      ownershipDefault: "caller-owned",
    };
  } catch (error) {
    return status(false, { reason: error?.message ?? String(error) });
  }
}

function probeBunFile() {
  if (!callable(globalThis.Bun?.file)) {
    return status(false, { callable: false, methods: [] });
  }
  try {
    const file = Bun.file(join(ROOT, ".bun-version"));
    const methods = ["text", "arrayBuffer", "stream", "exists", "size", "type"].filter((name) =>
      name === "size" || name === "type" ? name in file : callable(file?.[name]),
    );
    return status(true, { callable: true, methods });
  } catch (error) {
    return status(false, { callable: true, reason: error?.message ?? String(error) });
  }
}

function probeHostApis() {
  const bun = globalThis.Bun;
  return {
    file: probeBunFile(),
    spawn: status(callable(bun?.spawn), { callable: callable(bun?.spawn), sideEffectProbe: "not-run" }),
    spawnSync: status(callable(bun?.spawnSync), {
      callable: callable(bun?.spawnSync),
      sideEffectProbe: "not-run",
    }),
    serve: status(callable(bun?.serve), {
      callable: callable(bun?.serve),
      lifecycleProbe: "not-run; test servers own Bun.serve startup/shutdown",
    }),
    fetch: status(callable(globalThis.fetch), { callable: callable(globalThis.fetch) }),
    webSocket: status(callable(globalThis.WebSocket), { callable: callable(globalThis.WebSocket) }),
  };
}

async function probeFfi(env) {
  const disabled = /^(1|true|yes)$/i.test(String(env.MAD_DOM_FFI_DISABLED ?? ""));
  if (disabled) {
    return {
      ...disabledStatus("MAD_DOM_FFI_DISABLED is set"),
      module: "bun:ffi",
      contract: FFI_CONTRACT,
      candidate: { status: "disabled" },
    };
  }

  let ffi;
  try {
    ffi = await import("bun:ffi");
  } catch (error) {
    return {
      ...status(false, { module: "bun:ffi", reason: error?.message ?? String(error) }),
      contract: FFI_CONTRACT,
      candidate: { status: "unavailable", reason: "bun:ffi module could not be imported" },
    };
  }

  const defaultPath = join(ROOT, "build", `mad-dom-ffi.${ffi.suffix ?? (process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so")}`);
  const candidatePath = env.MAD_DOM_FFI_PATH
    ? resolve(String(env.MAD_DOM_FFI_PATH))
    : existsSync(defaultPath) ? defaultPath : null;
  const candidate = candidatePath
    ? existsSync(candidatePath)
      ? probeFfiLibrary(ffi, candidatePath)
      : { status: "unavailable", path: candidatePath, reason: "configured path does not exist" }
    : {
        status: "unavailable",
          reason: "no FFI artifact; the Node-API binding remains the active path",
      };

  return {
    ...status(true, {
      module: "bun:ffi",
      exports: Object.keys(ffi).sort(),
      dlopen: callable(ffi.dlopen),
      toArrayBuffer: callable(ffi.toArrayBuffer),
      jsCallback: callable(ffi.JSCallback),
    }),
    contract: FFI_CONTRACT,
    candidate,
  };
}

function probeFfiLibrary(ffi, path) {
  if (!callable(ffi?.dlopen)) {
    return { status: "unavailable", path, reason: "bun:ffi.dlopen is unavailable" };
  }
  try {
    const ptr = "ptr";
    const library = ffi.dlopen(path, {
      [FFI_CONTRACT.symbols.abiVersion]: { args: [], returns: "u32" },
      [FFI_CONTRACT.symbols.capabilities]: { args: [], returns: "u32" },
      [FFI_CONTRACT.symbols.querySnapshot]: {
        args: ["u32", "u32", "u32", "buffer", "u32", ptr, "u32", ptr], returns: "i32",
      },
      [FFI_CONTRACT.symbols.preorderSnapshot]: {
        args: ["u32", "u32", "u32", ptr, "u32", ptr], returns: "i32",
      },
      [FFI_CONTRACT.symbols.childSnapshot]: {
        args: ["u32", "u32", "u32", ptr, "u32", ptr], returns: "i32",
      },
      [FFI_CONTRACT.symbols.serialize]: {
        args: ["u32", "u32", "u32", "u32", ptr, "u32", ptr], returns: "i32",
      },
      [FFI_CONTRACT.symbols.createElements]: {
        args: ["u32", "u32", "buffer", "u32", "u32", ptr, "u32", ptr], returns: "i32",
      },
      [FFI_CONTRACT.symbols.readBatch]: {
        args: ["u32", "u32", "buffer", "u32", "u32", ptr, "u32", ptr], returns: "i32",
      },
    });
    const abiVersion = library.symbols[FFI_CONTRACT.symbols.abiVersion]();
    const capabilities = library.symbols[FFI_CONTRACT.symbols.capabilities]();
    return {
      status: abiVersion === FFI_CONTRACT.abiVersion ? "available" : "mismatch",
      path,
      abiVersion,
      expectedAbiVersion: FFI_CONTRACT.abiVersion,
      capabilities,
      expectedCapabilities: Object.values(FFI_CONTRACT.capabilityBits).reduce((all, bit) => all | bit, 0),
      symbols: Object.values(FFI_CONTRACT.symbols).filter((symbol) =>
        Object.prototype.hasOwnProperty.call(library.symbols, symbol)),
    };
  } catch (error) {
    return { status: "unavailable", path, reason: error?.message ?? String(error) };
  }
}

function matrixSemantics(currentVersion, baselineVersion, ffi) {
  const baselineComparison = compareVersions(currentVersion, baselineVersion);
  return {
    latest: {
      meaning: "CI lane using the current Bun release selected by the runner",
      observedVersion: currentVersion,
      compatibleWithBaseline: baselineComparison >= 0,
      selection: "runtime Bun.version; never an ABI pin",
    },
    baseline: {
      meaning: "reproducible regression lane from .bun-version",
      expectedVersion: baselineVersion,
      observedVersion: currentVersion,
      matches: baselineVersion !== null && currentVersion === baselineVersion,
      selection: ".bun-version",
    },
    ffiDisabled: {
      meaning: "explicitly exercise the Node-API fallback",
      selector: "MAD_DOM_FFI_DISABLED=1",
      observed: ffi.status === "disabled",
      expectedPath: "node-api",
    },
    ffiUnavailable: {
      meaning: "bun:ffi or the candidate cdylib is absent",
      observed: ffi.status === "unavailable" || ffi.status === "mismatch" ||
        ffi.candidate?.status === "unavailable" || ffi.candidate?.status === "mismatch",
      expectedPath: "node-api",
    },
  };
}

export async function collectCapabilities({ env = process.env, root = ROOT } = {}) {
  const bunVersion = typeof globalThis.Bun?.version === "string"
    ? globalThis.Bun.version
    : process.versions?.bun ?? null;
  const baselineVersion = safeReadBaseline(root);
  const ffi = await probeFfi(env);
  const gc = callable(globalThis.Bun?.gc)
    ? status(true, { callable: true, forcedCollection: true, probe: "callable-only" })
    : status(false, { callable: false, forcedCollection: false });
  const arrayBuffer = probeArrayBuffers(ffi.status === "available" ? await import("bun:ffi").catch(() => null) : null);

  return {
    schema: CAPABILITY_SCHEMA,
    runtime: {
      name: "bun",
      version: bunVersion,
      baselineVersion,
      versionSource: typeof globalThis.Bun?.version === "string" ? "Bun.version" : "process.versions.bun",
      minimumSupported: ">=1.4.0",
    },
    capabilities: {
      ffi,
      gc,
      arrayBuffer,
      io: probeHostApis(),
      jscPrivateApi: {
        status: "spike-only",
        defaultPath: false,
        probed: false,
        reason: "No stable public Bun contract; keep JavaScriptCore private APIs out of production.",
      },
    },
    matrix: matrixSemantics(bunVersion, baselineVersion, ffi),
    diagnostics: {
      nativeFallback: "Node-API object/lifecycle ABI remains required until an FFI capability probe passes.",
      missingCapabilitiesAreData: true,
    },
  };
}

export function assertCapabilityReport(report) {
  if (report?.schema !== CAPABILITY_SCHEMA) throw new Error("capability probe schema mismatch");
  if (!report.runtime || !report.capabilities || !report.matrix) throw new Error("capability probe is incomplete");
  for (const name of ["ffi", "gc", "arrayBuffer", "jscPrivateApi"]) {
    if (!report.capabilities[name]?.status) throw new Error(`missing capability status: ${name}`);
  }
  for (const name of ["file", "spawn", "spawnSync", "serve"]) {
    if (!report.capabilities.io?.[name]?.status) throw new Error(`missing I/O capability status: ${name}`);
  }
  for (const name of ["latest", "baseline", "ffiDisabled", "ffiUnavailable"]) {
    if (!report.matrix[name]?.meaning) throw new Error(`missing matrix semantic: ${name}`);
  }
  return true;
}

function printHuman(report) {
  console.log(`Bun ${report.runtime.version ?? "unknown"} (baseline ${report.runtime.baselineVersion ?? "unknown"})`);
  for (const [name, value] of Object.entries(report.capabilities)) {
    if (name === "io") {
      console.log(`io: ${Object.entries(value).map(([key, item]) => `${key}=${item.status}`).join(", ")}`);
    } else console.log(`${name}: ${value.status}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  const report = await collectCapabilities();
  assertCapabilityReport(report);
  if (process.argv.includes("--selftest")) {
    console.log("bun capability probe selftest: ok");
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}
