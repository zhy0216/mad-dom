#!/usr/bin/env bun
// Post-package install smoke test (T49 / ADR-0005 §8, §9).
//
// Installs the packed main package + the host platform package into a clean
// temp project with `bun add` (no Cargo toolchain involved anywhere in this
// flow — the tarballs are already built) and runs the minimal DOM smoke the
// ADR prescribes: construct a window, parse fixed HTML, run a selector query.
// It also asserts the ADR-0005 §9 error contract on every failure path:
//
//   1. happy path            — supported platform: DOM smoke succeeds;
//   2. missing platform      — main package installed without its platform
//                              package: `MAD_DOM_UNSUPPORTED_PLATFORM` with
//                              "Reinstall without --no-optional" + the support
//                              matrix anchor;
//   3. unsupported platform  — `MAD_DOM_TEST_PLATFORM=freebsd`:
//                              `MAD_DOM_UNSUPPORTED_PLATFORM` with "not in the
//                              supported matrix" + the anchor;
//   4. ABI mismatch          — `MAD_DOM_NATIVE_PATH` → a fake module whose
//                              `abiVersion()` disagrees: `MAD_DOM_ABI_MISMATCH`.
//
// Usage:
//   bun scripts/install-smoke.mjs [--out <dir>] [--version <v>]
//                                 [--platform-tgz <path>] [--main-tgz <path>]
//
// `--platform-tgz` / `--main-tgz` reuse already-packed tarballs (CI calls this
// after the release step); otherwise the script builds + packs them itself.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { platformInfo, platformPackageName } from "../js/native-loader.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(REPO_ROOT, "build", "smoke");
const SHIPPED_FILES = ["index.js", "index.d.ts", "js", "README.md", "LICENSE"];

const DOM_SMOKE = `
import { Window } from "mad-dom";
const win = new Window({ url: "https://mad-dom.test/" });
const { document } = win;
document.body.innerHTML = '<ul id="list"><li class="a">one</li><li class="b">two</li></ul>';
const items = document.querySelectorAll("li");
if (items.length !== 2) throw new Error("expected 2 <li> elements, got " + items.length);
const list = document.querySelector("#list");
if (list === null || list.id !== "list") throw new Error("querySelector('#list') failed");
if (document.querySelector(".a")?.textContent !== "one") throw new Error("querySelector('.a').textContent mismatch");
win.destroy();
console.log("MAD_DOM_INSTALL_SMOKE_OK");
`;

const PROBE = `
import { Window } from "mad-dom";
let result;
try {
  new Window();
  result = { ok: true };
} catch (error) {
  result = { ok: false, code: error?.code, message: error?.message };
}
console.log("RESULT " + JSON.stringify(result));
`;

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, version: null, platformTgz: null, mainTgz: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--out":
        args.out = argv[++i];
        break;
      case "--version":
        args.version = argv[++i];
        break;
      case "--platform-tgz":
        args.platformTgz = argv[++i];
        break;
      case "--main-tgz":
        args.mainTgz = argv[++i];
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function run(cmd, args, opts = {}) {
  const proc = spawnSync(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, env: opts.env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (proc.error) throw new Error(`${cmd} ${args.join(" ")}: ${proc.error.message}`);
  return proc;
}

function hostPlatformPackageName() {
  // Importing the runtime loader is side-effect free; reuse its exact mapping
  // so the smoke cross-checks build-time and runtime naming agree.
  const info = platformInfo();
  return platformPackageName(info.platform, info.arch, info.libc);
}

function packMainStaging(version, outDir, hostPkgName) {
  const staging = join(outDir, "main-staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const file of SHIPPED_FILES) {
    const src = join(REPO_ROOT, file);
    if (!existsSync(src)) throw new Error(`install-smoke: missing ${src}`);
    cpSync(src, join(staging, file), { recursive: true });
  }
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const stagedPkg = {
    ...pkg,
    version,
    sideEffects: true,
    optionalDependencies: { [hostPkgName]: version },
    scripts: undefined,
    devDependencies: undefined,
  };
  delete stagedPkg.scripts;
  delete stagedPkg.devDependencies;
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(stagedPkg, null, 2)}\n`);

  const proc = run("npm", ["pack", staging, "--pack-destination", outDir, "--json"]);
  const filename = `mad-dom-${version}.tgz`;
  const tgz = join(outDir, filename);
  if (!existsSync(tgz)) throw new Error(`install-smoke: main tarball not produced at ${tgz}`);
  return tgz;
}

function setupProject(dir, tarballs, env) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const init = run("bun", ["init", "-y"], { cwd: dir });
  if (init.status !== 0) throw new Error(`bun init failed: ${init.stderr}`);
  for (const tgz of tarballs) {
    const add = run("bun", ["add", tgz], { cwd: dir, env });
    if (add.status !== 0) throw new Error(`bun add ${tgz} failed: ${add.stderr}`);
  }
}

function runScript(dir, scriptName, env) {
  const proc = run("bun", [scriptName], { cwd: dir, env });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

function assertContains(haystack, needle, context) {
  if (!haystack.includes(needle)) {
    throw new Error(`install-smoke: ${context}: expected message to contain ${JSON.stringify(needle)} but got:\n${haystack}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  // --- build / pack the host platform package and a staged main package ----
  const hostPkgName = hostPlatformPackageName();
  const platformTgz = args.platformTgz ?? (() => {
    const proc = run("bun", ["scripts/build-platform-package.mjs", "--version", version, "--out", join(outDir, "platform")]);
    if (proc.status !== 0) throw new Error(`build-platform-package failed: ${proc.stderr}`);
    const platformDir = join(outDir, "platform", hostPkgName);
    const pack = run("npm", ["pack", platformDir, "--pack-destination", outDir, "--json"]);
    if (pack.status !== 0) throw new Error(`npm pack ${hostPkgName} failed: ${pack.stderr}`);
    return join(outDir, `${hostPkgName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`);
  })();
  const mainTgz = args.mainTgz ?? packMainStaging(version, outDir, hostPkgName);

  if (!existsSync(platformTgz)) throw new Error(`install-smoke: platform tarball missing: ${platformTgz}`);
  if (!existsSync(mainTgz)) throw new Error(`install-smoke: main tarball missing: ${mainTgz}`);

  // --- 1. happy path: main + host platform package -------------------------
  const happyDir = join(outDir, "proj-happy");
  setupProject(happyDir, [platformTgz, mainTgz]);
  writeFileSync(join(happyDir, "smoke-dom.mjs"), DOM_SMOKE);
  const happy = runScript(happyDir, "smoke-dom.mjs");
  if (happy.status !== 0 || !happy.stdout.includes("MAD_DOM_INSTALL_SMOKE_OK")) {
    throw new Error(`install-smoke: happy path failed (exit ${happy.status}):\n${happy.stdout}\n${happy.stderr}`);
  }
  console.log(`install-smoke: happy path OK (${hostPkgName}@${version})`);

  // --- 2. missing platform: main installed alone ----------------------------
  const missingDir = join(outDir, "proj-missing");
  setupProject(missingDir, [mainTgz]);
  writeFileSync(join(missingDir, "probe.mjs"), PROBE);
  const missing = runScript(missingDir, "probe.mjs");
  const missingResult = JSON.parse(missing.stdout.match(/^RESULT (\{.*\})$/m)?.[1] ?? "{}");
  if (missingResult.ok !== false || missingResult.code !== "MAD_DOM_UNSUPPORTED_PLATFORM") {
    throw new Error(`install-smoke: missing-platform case expected MAD_DOM_UNSUPPORTED_PLATFORM, got ${missing.stdout}`);
  }
  assertContains(missingResult.message, "Reinstall without --no-optional", "missing-platform");
  assertContains(missingResult.message, "mad-dom cannot load its native binding", "missing-platform");
  console.log("install-smoke: missing-platform error OK");

  // --- 3. unsupported platform ----------------------------------------------
  const unsupportedDir = join(outDir, "proj-unsupported");
  setupProject(unsupportedDir, [platformTgz, mainTgz]);
  writeFileSync(join(unsupportedDir, "probe.mjs"), PROBE);
  const unsupported = runScript(unsupportedDir, "probe.mjs", { ...process.env, MAD_DOM_TEST_PLATFORM: "freebsd", MAD_DOM_TEST_ARCH: "x64" });
  const unsupportedResult = JSON.parse(unsupported.stdout.match(/^RESULT (\{.*\})$/m)?.[1] ?? "{}");
  if (unsupportedResult.ok !== false || unsupportedResult.code !== "MAD_DOM_UNSUPPORTED_PLATFORM") {
    throw new Error(`install-smoke: unsupported-platform case expected MAD_DOM_UNSUPPORTED_PLATFORM, got ${unsupported.stdout}`);
  }
  assertContains(unsupportedResult.message, "not in the supported matrix", "unsupported-platform");
  assertContains(unsupportedResult.message, "freebsd/x64", "unsupported-platform");
  console.log("install-smoke: unsupported-platform error OK");

  // --- 4. ABI mismatch via MAD_DOM_NATIVE_PATH ------------------------------
  const fakeAbi = join(outDir, "fake-abi.cjs");
  writeFileSync(fakeAbi, "module.exports = { abiVersion: () => 999 };\n");
  const abiDir = join(outDir, "proj-abi");
  setupProject(abiDir, [mainTgz]);
  writeFileSync(join(abiDir, "probe.mjs"), PROBE);
  const abi = runScript(abiDir, "probe.mjs", { ...process.env, MAD_DOM_NATIVE_PATH: fakeAbi });
  const abiResult = JSON.parse(abi.stdout.match(/^RESULT (\{.*\})$/m)?.[1] ?? "{}");
  if (abiResult.ok !== false || abiResult.code !== "MAD_DOM_ABI_MISMATCH") {
    throw new Error(`install-smoke: ABI-mismatch case expected MAD_DOM_ABI_MISMATCH, got ${abi.stdout}`);
  }
  assertContains(abiResult.message, "ABI 1", "abi-mismatch");
  assertContains(abiResult.message, "mismatched version pair", "abi-mismatch");
  console.log("install-smoke: ABI-mismatch error OK");

  console.log("install-smoke: ALL CHECKS PASSED (no Cargo environment needed)");
}

try {
  main();
} catch (error) {
  console.error(`install-smoke: ${error.message}`);
  process.exit(1);
}
