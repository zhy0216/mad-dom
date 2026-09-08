import { describe, expect, test } from "bun:test";
import { runtimeContract, validatePackageMetadata } from "../../js/runtime-metadata.js";
import pkg from "../../package.json";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function pair(status = "available") {
  const contract = runtimeContract(pkg.version);
  const name = "@mad-dom/platform-linux-x64-gnu";
  const main = { ...pkg, optionalDependencies: { [name]: pkg.version } };
  const enabled = ["available", "partial"].includes(status);
  const platform = {
    name, version: pkg.version, main: "./mad-dom.linux-x64-gnu.node",
    ...(enabled ? { madDomFfi: "./mad-dom.linux-x64-gnu.node" } : {}),
    os: ["linux"], cpu: ["x64"], libc: ["glibc"], madDomRuntime: contract,
    madDomBuild: {
      bunVersion: Bun.version, binarySha256: "a".repeat(64),
      platform: { platform: "linux", arch: "x64", libc: "gnu" },
      nodeApi: { status: "available", abiVersion: contract.nodeApiAbiVersion },
      ffi: { status, ...(enabled ? { abiVersion: contract.ffiAbiVersion, capabilities: status === "partial" ? 1 : contract.ffiCapabilities } : {}) },
      capabilityLevel: enabled ? (status === "partial" ? "ffi-partial" : "ffi") : "node-api-only",
    },
  };
  return [main, platform];
}

describe("release metadata contract", () => {
  test("the published root manifest agrees with the current loader contract", () => {
    expect(() => validatePackageMetadata(pkg)).not.toThrow();
  });
  test.each(["available", "partial", "disabled", "unavailable", "mismatch"])("permits %s with required Node-API intact", (status) => {
    expect(() => validatePackageMetadata(...pair(status))).not.toThrow();
  });
  test("never treats optional FFI as a replacement for required Node-API", () => {
    const [main, platform] = pair("unavailable");
    platform.madDomBuild.nodeApi.abiVersion = 999;
    expect(() => validatePackageMetadata(main, platform)).toThrow("measured Node-API ABI");
  });
  test("zero usable optional symbols is a valid Node-API-only observation", () => {
    const [main, platform] = pair("partial");
    platform.madDomBuild.ffi.capabilities = 0;
    platform.madDomBuild.capabilityLevel = "node-api-only";
    delete platform.madDomFfi;
    expect(() => validatePackageMetadata(main, platform)).not.toThrow();
  });
  test("rejects mixed optional pins even if both binary ABIs are compatible", () => {
    const [main, platform] = pair();
    main.optionalDependencies[platform.name] = "0.0.0";
    expect(() => validatePackageMetadata(main, platform)).toThrow("optional pin");
  });
  test("rejects unknown enabled capability bits and false FFI ABI claims", () => {
    for (const field of ["capabilities", "abiVersion"]) {
      const [main, platform] = pair();
      platform.madDomBuild.ffi[field] = 1 << 20;
      expect(() => validatePackageMetadata(main, platform)).toThrow("FFI ABI/capabilities/image");
    }
  });
  test.each(["available", "partial", "disabled", "unavailable", "mismatch"])("rejects out-of-u32 capabilities in %s observations", (status) => {
    for (const capabilities of [2 ** 32 + 31, 2 ** 32, -1, 1.5, NaN, Infinity]) {
      const [main, platform] = pair(status);
      platform.madDomBuild.ffi.capabilities = capabilities;
      if (["available", "partial"].includes(status)) platform.madDomBuild.capabilityLevel = "ffi-partial";
      let error;
      try { validatePackageMetadata(main, platform); } catch (caught) { error = caught; }
      expect(error?.code).toBe("MAD_DOM_METADATA_MISMATCH");
      expect(error?.message).toContain("must be a u32");
    }
  });
  test("rejects u32 overflow even when partial metadata claims Node-API-only", () => {
    const [main, platform] = pair("partial");
    platform.madDomBuild.ffi.capabilities = 2 ** 32;
    platform.madDomBuild.capabilityLevel = "node-api-only";
    delete platform.madDomFfi;
    let error;
    try { validatePackageMetadata(main, platform); } catch (caught) { error = caught; }
    expect(error?.code).toBe("MAD_DOM_METADATA_MISMATCH");
    expect(error?.message).toContain("must be a u32");
  });
  test("cannot claim a musl payload was verified in a glibc runtime", () => {
    const [main, platform] = pair();
    platform.libc = ["musl"];
    expect(() => validatePackageMetadata(main, platform)).toThrow("platform/libc");
  });
  test("cannot advertise a second FFI image or unverified fast path", () => {
    for (const status of ["available", "unavailable"]) {
      const [main, platform] = pair(status);
      platform.madDomFfi = status === "available" ? "./second.so" : platform.main;
      expect(() => validatePackageMetadata(main, platform)).toThrow("MAD_DOM_METADATA_MISMATCH");
    }
  });
});

// Linux-only negative payload fixture: mask C export names in a copy of the
// current image. Node-API code and its registry are unchanged; only this one
// image is shipped in the test tarball. Never use this fixture for publishing.
const root = fileURLToPath(new URL("../..", import.meta.url));
test.skipIf(process.platform !== "linux" || !existsSync(join(root, "build/mad-dom.node")))(
  "a real payload with unavailable FFI exports can be drafted and installed",
  () => {
    const dir = mkdtempSync(join(root, "build/release-negative-"));
    const run = (args) => {
      const proc = Bun.spawnSync([process.execPath, ...args], { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" });
      if (proc.exitCode !== 0) throw new Error(`${args.join(" ")}\n${proc.stdout}\n${proc.stderr}`);
    };
    try {
      const bytes = Buffer.from(readFileSync(join(root, "build/mad-dom.node")));
      const from = Buffer.from("mad_dom_ffi_"), to = Buffer.from("mad_dom_off_");
      let changed = 0;
      for (let offset = bytes.indexOf(from); offset !== -1; offset = bytes.indexOf(from, offset + to.length)) {
        to.copy(bytes, offset); changed++;
      }
      expect(changed).toBeGreaterThan(0);
      const artifact = join(dir, "fixture.node");
      writeFileSync(artifact, bytes);
      run(["scripts/build-platform-package.mjs", "--artifact", artifact, "--out", join(dir, "platform")]);
      run(["scripts/release.mjs", "draft", "--no-build", "--out", dir]);
      const manifest = JSON.parse(readFileSync(join(dir, "runtime-metadata.json")));
      const platform = manifest.platforms[0];
      expect(platform.build.capabilityLevel).toBe("node-api-only");
      expect(platform.build.ffi.status).toBe("unavailable");
      const platformTgz = `${platform.pkgName.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
      run(["scripts/install-smoke.mjs", "--out", join(dir, "smoke"), "--main-tgz", join(dir, "tgz", `mad-dom-${pkg.version}.tgz`),
        "--platform-tgz", join(dir, "tgz", platformTgz), "--expect-ffi", "unavailable"]);
      const result = JSON.parse(readFileSync(join(dir, "smoke/runtime-results.json")));
      expect(result.results.find(row => row.label === "automatic").ffi.status).toBe("unavailable");
      // Reused artifacts must fail closed after either manifest or binary
      // tampering; no registry access and no publish subcommand are involved.
      const packageDir = join(dir, "platform", platform.pkgName);
      const packagePath = join(packageDir, "package.json");
      const original = readFileSync(packagePath, "utf8");
      const invalid = JSON.parse(original); invalid.version = "0.0.0-wrong";
      writeFileSync(packagePath, JSON.stringify(invalid));
      expect(() => run(["scripts/release.mjs", "draft", "--no-build", "--out", dir])).toThrow("MAD_DOM_METADATA_MISMATCH");
      writeFileSync(packagePath, original);
      writeFileSync(join(packageDir, invalid.main), "corrupted fixture");
      expect(() => run(["scripts/release.mjs", "draft", "--no-build", "--out", dir])).toThrow("binary checksum changed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000,
);
