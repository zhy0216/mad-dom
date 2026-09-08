#!/usr/bin/env bun
// Build a single native platform package (T49 / ADR-0005 §3, §5).
//
// Compiles the production binding (`mad-dom-bun`) in release profile for one
// triple and assembles the `@mad-dom/platform-<os>-<arch>[-<libc>]` npm
// package layout under `<out>/<pkg-name>/`: the binary renamed to
// `mad-dom.<os>-<arch>[-<libc>].node`, plus package.json / LICENSE / README.md
// (ADR-0005 §5: nothing else in the package).
//
// Usage:
//   bun scripts/build-platform-package.mjs [--triple <triple>] [--version <v>]
//                                          [--out <dir>] [--no-build]
//                                          [--artifact <native-image>]
//
//   --triple    Rust target triple (default: the host triple, from `rustc -vV`).
//               Cross triples require the target installed; a missing target
//               fails with the cargo error (the CI release workflow supplies
//               native runners per platform and the musl cross toolchain).
//   --version   npm version for the package.json (default: the repo
//               package.json version, i.e. the main-package version it must
//               track exactly, ADR-0005 §5).
//   --out       output root (default: <repo>/build/platform).
//   --no-build  reuse an existing cargo artifact instead of recompiling.
//   --artifact  package an existing image for local rehearsal, without a
//               Cargo build. The payload must load on this runner for probing.
//
// Prints the assembled package path on success.

import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runtimeContract, runtimeObservation, validatePackageMetadata } from "../js/runtime-metadata.js";

import {
  TRIPLE_MATRIX,
  cdylibOutputName,
  platformBinaryName,
  platformPackageName,
  platformSegment,
} from "./platform-matrix.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { triple: null, version: null, out: null, noBuild: false, artifact: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--triple":
        args.triple = argv[++i];
        break;
      case "--version":
        args.version = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--no-build":
        args.noBuild = true;
        break;
      case "--artifact":
        args.artifact = resolve(argv[++i]);
        args.noBuild = true;
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function hostTriple() {
  const proc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`could not query rustc host tuple: ${proc.stderr}`);
  }
  const host = proc.stdout.match(/^host:\s*(\S+)/m)?.[1];
  if (!host) throw new Error(`could not parse rustc -vV output: ${proc.stdout}`);
  return host;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const triple = args.triple ?? hostTriple();
  const meta = TRIPLE_MATRIX[triple];
  if (meta === undefined) {
    throw new Error(
      `triple "${triple}" is not in the supported matrix (ADR-0005 §2). ` +
        `Supported: ${Object.keys(TRIPLE_MATRIX).join(", ")}`,
    );
  }
  const version = args.version ?? JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  const outRoot = resolve(args.out ?? join(REPO_ROOT, "build", "platform"));

  if (!args.noBuild) {
    const build = spawnSync(
      "cargo",
      ["build", "--release", "-p", "mad-dom-bun", "--target", triple],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    if (build.status !== 0) {
      throw new Error(
        `cargo build --target ${triple} failed (is the target installed? for a cross triple run ` +
          "`rustup target add <triple>` and provide the cross linker / toolchain)",
      );
    }
  }

  const artifact = args.artifact ?? join(REPO_ROOT, "target", triple, "release", cdylibOutputName(triple));
  if (!existsSync(artifact)) {
    throw new Error(`expected cdylib at ${artifact} but it was not produced`);
  }

  const pkgName = platformPackageName(meta);
  const binaryName = platformBinaryName(meta);
  const pkgDir = join(outRoot, pkgName);
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(pkgDir, { recursive: true });

  copyFileSync(artifact, join(pkgDir, binaryName));

  // Probe the actual payload in its own process. A cross-built artifact must
  // be runnable on this host; never invent measured ABI/capability metadata.
  const probeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("MAD_DOM_TEST_") && !["MAD_DOM_NATIVE_PATH", "MAD_DOM_FFI_PATH"].includes(key)));
  const binaryPath = join(pkgDir, binaryName);
  const probe = spawnSync(process.execPath, ["scripts/runtime-metadata.mjs", "--require-native"], {
    cwd: REPO_ROOT, encoding: "utf8",
    env: { ...probeEnv, MAD_DOM_NATIVE_PATH: binaryPath, MAD_DOM_FFI_PATH: binaryPath },
  });
  if (probe.status !== 0) throw new Error(`payload probe failed; use a runner that can load ${triple}:\n${probe.stdout}\n${probe.stderr}`);
  const observed = JSON.parse(probe.stdout);
  if (resolve(observed.nodeApi.path) !== resolve(binaryPath)) throw new Error("payload probe loaded another native image");
  const { path: _nodePath, ...nodeApi } = observed.nodeApi;
  const { path: _ffiPath, ...ffi } = observed.ffi;
  const ffiEnabled = ["available", "partial"].includes(ffi.status) && ffi.capabilities > 0;
  const contract = runtimeContract(version);
  const madDomBuild = {
    bunVersion: observed.bunVersion, bunRevision: observed.bunRevision,
    platform: observed.platform, nodeApi, ffi,
    capabilityLevel: ffiEnabled ? (ffi.status === "available" && ffi.capabilities === contract.ffiCapabilities ? "ffi" : "ffi-partial") : "node-api-only",
    binarySha256: createHash("sha256").update(readFileSync(binaryPath)).digest("hex"),
  };

  const libcField = meta.libc === null ? {} : { libc: [meta.libc === "gnu" ? "glibc" : "musl"] };
  const packageJson = {
    name: pkgName,
    version,
    description: `MAD DOM native binding for ${platformSegment(meta)} (Bun, Node-API).`,
    main: `./${binaryName}`,
    // The FFI channel deliberately points at the same image as Node-API.
    // Duplicating a cdylib would create a second thread-local document
    // registry, so the package carries one binary and records its dual use.
    ...(ffiEnabled ? { madDomFfi: `./${binaryName}` } : {}),
    madDomRuntime: contract,
    madDomBuild,
    os: [meta.os],
    cpu: [meta.arch],
    ...libcField,
    files: [binaryName, "README.md", "LICENSE"],
    license: "MIT",
    publishConfig: { access: "public" },
  };
  validatePackageMetadata({ name: "mad-dom", version, madDomRuntime: contract, optionalDependencies: { [pkgName]: version } }, packageJson);
  writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  copyFileSync(join(REPO_ROOT, "LICENSE"), join(pkgDir, "LICENSE"));
  writeFileSync(
    join(pkgDir, "README.md"),
    `# ${pkgName}\n\nNative binding for MAD DOM on ${meta.os}-${meta.arch}${
      meta.libc ? ` (${meta.libc})` : ""
    }. This package is a platform binary payload of \`mad-dom\` (ADR-0005 §5): it is installed ` +
      "automatically as an optional dependency of the matching \`mad-dom\` version and is not meant to " +
      "be depended on directly. The same binary is also the optional Bun FFI image; the main loader " +
      "opens it once so document-local FFI ownership remains connected to Node-API.\n",
  );

  console.log(pkgDir);
}

try {
  main();
} catch (error) {
  console.error(`build-platform-package: ${error.message}`);
  console.error(JSON.stringify(runtimeObservation(), null, 2));
  process.exit(1);
}
