// Published runtime contract. The loader remains the authority for capability
// selection; build observations describe a verified artifact, not a Bun pin.
import {
  EXPECTED_ABI_VERSION, EXPECTED_FFI_ABI_VERSION, FFI_CAPABILITIES,
  ffiCapabilityReport, loadNative, nativeLoadPath, platformInfo, platformPackageName,
} from "./native-loader.js";

export function runtimeContract(packageVersion) {
  return {
    schema: 1, packageVersion,
    nodeApiAbiVersion: EXPECTED_ABI_VERSION,
    ffiAbiVersion: EXPECTED_FFI_ABI_VERSION,
    ffiCapabilities: Object.values(FFI_CAPABILITIES).reduce((all, bit) => all | bit, 0),
    ffiRequired: false,
  };
}

export function runtimeObservation() {
  let nodeApi;
  try {
    nodeApi = { status: "available", abiVersion: loadNative().abiVersion(), path: nativeLoadPath() };
  } catch (error) {
    nodeApi = { status: "unavailable", code: error.code, reason: error.message };
  }
  return {
    bunVersion: globalThis.Bun?.version ?? null,
    bunRevision: globalThis.Bun?.revision ?? null,
    platform: platformInfo(),
    expectedAbis: { nodeApi: EXPECTED_ABI_VERSION, ffi: EXPECTED_FFI_ABI_VERSION },
    nodeApi,
    ffi: ffiCapabilityReport(),
  };
}

export function validatePackageMetadata(main, platform) {
  const fail = (reason) => {
    const error = new Error(`MAD_DOM_METADATA_MISMATCH: ${reason}`);
    error.code = "MAD_DOM_METADATA_MISMATCH";
    throw error;
  };
  for (const pkg of [main, ...(platform ? [platform] : [])]) {
    const expected = runtimeContract(main.version);
    for (const [key, value] of Object.entries(expected)) {
      if (pkg.madDomRuntime?.[key] !== value) {
        fail(`${pkg.name} ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(pkg.madDomRuntime?.[key])}`);
      }
    }
    if (pkg.version !== main.version) fail(`${pkg.name} version ${pkg.version} != main ${main.version}`);
  }
  for (const [name, version] of Object.entries(main.optionalDependencies ?? {})) {
    if (name.startsWith("@mad-dom/platform-") && version !== main.version) fail(`${name} optional pin ${version} != ${main.version}`);
  }
  if (!platform) return;
  if (main.optionalDependencies?.[platform.name] !== main.version) fail(`main does not pin ${platform.name}@${main.version}`);
  if (!/^\.\/[^/\\]+\.node$/.test(platform.main ?? "")) fail(`${platform.name} has an invalid native image path`);
  if (platform.madDomFfi !== undefined && platform.madDomFfi !== platform.main) fail(`${platform.name} FFI must use the same image as main`);
  const build = platform.madDomBuild;
  if (!build?.bunVersion || build.nodeApi?.status !== "available" || build.nodeApi.abiVersion !== main.madDomRuntime.nodeApiAbiVersion) fail(`${platform.name} missing/mismatched measured Node-API ABI`);
  if (!/^[a-f0-9]{64}$/.test(build.binarySha256 ?? "")) fail(`${platform.name} missing binary checksum`);
  if (!build.platform || platform.os?.length !== 1 || platform.cpu?.length !== 1 ||
      (platform.os[0] === "linux" && (platform.libc?.length !== 1 || !["glibc", "musl"].includes(platform.libc[0])))) fail(`${platform.name} missing platform/libc metadata`);
  if (build.platform?.platform !== platform.os?.[0] || build.platform?.arch !== platform.cpu?.[0] ||
      (build.platform.platform === "linux" && build.platform.libc !== (platform.libc?.[0] === "glibc" ? "gnu" : "musl"))) fail(`${platform.name} measured platform/libc does not match package target`);
  if (platformPackageName(build.platform.platform, build.platform.arch, build.platform.libc) !== platform.name) fail(`${platform.name} name does not match measured platform/libc`);
  const ffi = build.ffi;
  if (!["available", "partial", "unavailable", "disabled", "mismatch"].includes(ffi?.status)) fail(`${platform.name} missing FFI observation`);
  // Validate the numeric domain before any bitwise operation: JavaScript
  // truncates to 32 bits, so 2 ** 32 + 31 would otherwise look like bitset 31.
  if ((["available", "partial"].includes(ffi.status) || ffi.capabilities !== undefined) &&
      (!Number.isInteger(ffi.capabilities) || ffi.capabilities < 0 || ffi.capabilities > 0xffff_ffff)) fail(`${platform.name} measured FFI capabilities must be a u32`);
  const enabled = ["available", "partial"].includes(ffi.status) && ffi.capabilities > 0;
  if (ffi.status === "available" && !enabled) fail(`${platform.name} FFI available without any capabilities`);
  if (enabled && (ffi.abiVersion !== main.madDomRuntime.ffiAbiVersion || !Number.isInteger(ffi.capabilities) ||
      ffi.capabilities <= 0 || (ffi.capabilities & ~main.madDomRuntime.ffiCapabilities) !== 0 || platform.madDomFfi !== platform.main)) fail(`${platform.name} FFI ABI/capabilities/image mismatch`);
  const level = enabled ? (ffi.capabilities === main.madDomRuntime.ffiCapabilities && ffi.status === "available" ? "ffi" : "ffi-partial") : "node-api-only";
  if (build.capabilityLevel !== level) fail(`${platform.name} capability level ${build.capabilityLevel} != ${level}`);
  if (!enabled && platform.madDomFfi !== undefined) fail(`${platform.name} advertises an unverified FFI image`);
}
