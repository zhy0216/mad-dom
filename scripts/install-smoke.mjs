#!/usr/bin/env bun
// Real tarball installation, isolated from source overrides and registry
// optional packages. Only npm pack and bun install --frozen-lockfile are used.
// Usage: bun run smoke:install --main-tgz <main.tgz> --platform-tgz <host.tgz>
//        [--version <v>] [--out <dir>] [--expect-ffi available|unavailable|disabled]
// Omitting tarballs builds/packs them; supplied tarballs are never rebuilt.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { platformInfo, platformPackageName } from "../js/native-loader.js";
import { runtimeContract, runtimeObservation, validatePackageMetadata } from "../js/runtime-metadata.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("MAD_DOM_") && !["NODE_PATH", "NODE_OPTIONS", "BUN_OPTIONS"].includes(key)));
const results = [];
const DOM_SMOKE = `
import { Window } from "mad-dom";
import { runtimeObservation } from "./node_modules/mad-dom/js/runtime-metadata.js";
const win = new Window({ url: "https://mad-dom.test/" });
try {
  const { document } = win;
  document.body.innerHTML = '<ul id="list"><li class="a">one</li><li class="b">two</li></ul>';
  const list = document.querySelector("#list");
  if (list?.querySelectorAll("li").length !== 2) throw new Error("query snapshot failed");
  if (document.querySelector(".a")?.textContent !== "one") throw new Error("text mismatch");
  if (list !== document.querySelector("#list")) throw new Error("wrapper identity mismatch");
  if (list.outerHTML !== '<ul id="list"><li class="a">one</li><li class="b">two</li></ul>') throw new Error("serialization mismatch");
} finally { win.destroy(); }
console.log("RESULT " + JSON.stringify({ ok: true, ...runtimeObservation() }));
`;
const ERROR_PROBE = `
import { Window } from "mad-dom";
import { runtimeObservation } from "./node_modules/mad-dom/js/runtime-metadata.js";
let result;
try { const win = new Window(); win.destroy(); result = { ok: true }; }
catch (error) { result = { ok: false, code: error.code, message: error.message }; }
console.log("RESULT " + JSON.stringify({ ...result, ...runtimeObservation() }));
`;

function argsFrom(argv) {
  const args = { out: join(ROOT, "build/smoke"), version: null, platformTgz: null, mainTgz: null, expectFfi: null };
  const flags = { "--out": "out", "--version": "version", "--platform-tgz": "platformTgz", "--main-tgz": "mainTgz", "--expect-ffi": "expectFfi" };
  for (let i = 0; i < argv.length; i++) {
    if (!flags[argv[i]] || !argv[i + 1]) throw new Error(`unknown/incomplete argument: ${argv[i]}`);
    args[flags[argv[i]]] = argv[++i];
  }
  if (args.expectFfi && !["available", "unavailable", "disabled"].includes(args.expectFfi)) throw new Error("invalid --expect-ffi");
  return args;
}
function run(command, args, { cwd = ROOT, env = cleanEnv } = {}) {
  const proc = Bun.spawnSync([command, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout.toString(), stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed (${proc.exitCode}):\n${stdout}\n${stderr}`);
  return stdout;
}
function pack(dir, out) {
  const packed = JSON.parse(run("npm", ["pack", dir, "--pack-destination", out, "--json", "--registry=https://registry.npmjs.org"]));
  return join(out, packed[0].filename);
}
function setupProject(dir, tarballs) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const dependencies = Object.fromEntries(tarballs.map(([name, path]) => [name, `file:${path}`]));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mad-dom-install-smoke", private: true, type: "module", dependencies }));
  // Host platform is a direct local dependency. --no-optional makes missing
  // binary cases deterministic even when the same version is on npm already.
  run(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts", "--no-optional"], { cwd: dir });
}
function probe(dir, label, script, overrides = {}) {
  writeFileSync(join(dir, "probe.mjs"), script);
  const stdout = run(process.execPath, ["probe.mjs"], { cwd: dir, env: { ...cleanEnv, ...overrides } });
  const result = JSON.parse(stdout.match(/^RESULT (\{.*\})$/m)?.[1] ?? "null");
  if (!result) throw new Error(`${label}: missing result: ${stdout}`);
  results.push({ label, ...result });
  return result;
}
function expect(condition, reason, result) {
  if (!condition) throw new Error(`${reason}\n${JSON.stringify(result, null, 2)}`);
}

function main() {
  const args = argsFrom(process.argv.slice(2));
  const repoPkg = JSON.parse(readFileSync(join(ROOT, "package.json")));
  const version = args.version ?? repoPkg.version;
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const info = platformInfo();
  const hostName = platformPackageName(info.platform, info.arch, info.libc);
  let platformTgz = args.platformTgz && resolve(args.platformTgz);
  if (!platformTgz) {
    run(process.execPath, ["scripts/build-platform-package.mjs", "--version", version, "--out", join(out, "platform")]);
    platformTgz = pack(join(out, "platform", hostName), out);
  }
  let mainTgz = args.mainTgz && resolve(args.mainTgz);
  if (!mainTgz) {
    const staging = join(out, "main-staging");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const file of repoPkg.files) cpSync(join(ROOT, file), join(staging, file), { recursive: true });
    const pkg = { ...repoPkg, version, madDomRuntime: runtimeContract(version), optionalDependencies: { [hostName]: version } };
    delete pkg.scripts; delete pkg.devDependencies;
    writeFileSync(join(staging, "package.json"), JSON.stringify(pkg, null, 2));
    mainTgz = pack(staging, out);
  }
  for (const path of [mainTgz, platformTgz]) if (!existsSync(path)) throw new Error(`tarball missing: ${path}`);
  const happyDir = join(out, "proj-happy");
  setupProject(happyDir, [[hostName, platformTgz], ["mad-dom", mainTgz]]);
  const installedMain = JSON.parse(readFileSync(join(happyDir, "node_modules/mad-dom/package.json")));
  const platformDir = join(happyDir, "node_modules", hostName);
  const installedPlatform = JSON.parse(readFileSync(join(platformDir, "package.json")));
  expect(installedMain.version === version, `expected main version ${version}`, installedMain);
  validatePackageMetadata(installedMain, installedPlatform);
  const binary = resolve(platformDir, installedPlatform.main);
  expect(createHash("sha256").update(readFileSync(binary)).digest("hex") === installedPlatform.madDomBuild.binarySha256, "installed binary checksum mismatch", installedPlatform.madDomBuild);
  expect(readdirSync(platformDir).filter(name => /\.(node|so|dylib|dll)$/.test(name)).length === 1, "platform must contain one native image", installedPlatform);
  const automatic = probe(happyDir, "automatic", DOM_SMOKE);
  expect(automatic.ok && resolve(automatic.nodeApi.path) === binary, "smoke must load installed platform image", automatic);
  if (args.expectFfi) expect(automatic.ffi.status === args.expectFfi, `expected automatic FFI ${args.expectFfi}`, automatic);
  if (["available", "partial"].includes(automatic.ffi.status)) {
    expect(automatic.ffi.abiVersion === installedMain.madDomRuntime.ffiAbiVersion && resolve(automatic.ffi.path) === binary, "installed FFI ABI/image mismatch", automatic);
  }
  for (const [label, overrides, expected] of [
    ["ffi-disabled", { MAD_DOM_FFI_DISABLED: "1" }, "disabled"],
    ["ffi-unavailable", { MAD_DOM_FFI_PATH: join(out, "absent-ffi.node") }, "unavailable"],
    ["ffi-abi-mismatch", { MAD_DOM_TEST_FFI_ABI_VERSION: "999" }, "mismatch"],
    ["ffi-partial", { MAD_DOM_TEST_FFI_MISSING_SYMBOLS: "querySnapshot,serialize" }, "partial"],
  ]) {
    if (["ffi-abi-mismatch", "ffi-partial"].includes(label) && !["available", "partial"].includes(automatic.ffi.status)) {
      results.push({ label, skipped: true, reason: "real artifact/runtime has no enabled FFI; unavailable fallback tested" });
      continue;
    }
    const result = probe(happyDir, label, DOM_SMOKE, overrides);
    expect(result.ok && result.ffi.status === expected, `${label} fallback failed`, result);
  }
  const missingDir = join(out, "proj-missing");
  setupProject(missingDir, [["mad-dom", mainTgz]]);
  const fakeAbi = join(out, "fake-abi.cjs");
  writeFileSync(fakeAbi, "module.exports = { abiVersion: () => 999 };\n");
  for (const [label, dir, overrides, code, text] of [
    ["platform-missing", missingDir, {}, "MAD_DOM_UNSUPPORTED_PLATFORM", "Reinstall without --no-optional"],
    ["platform-unsupported", happyDir, { MAD_DOM_TEST_PLATFORM: "freebsd", MAD_DOM_TEST_ARCH: "x64" }, "MAD_DOM_UNSUPPORTED_PLATFORM", "not in the supported matrix"],
    ["native-abi-mismatch", missingDir, { MAD_DOM_NATIVE_PATH: fakeAbi }, "MAD_DOM_ABI_MISMATCH", "mismatched version pair"],
  ]) {
    const result = probe(dir, label, ERROR_PROBE, overrides);
    expect(result.ok === false && result.code === code && result.message.includes(text), `${label} error contract failed`, result);
  }
  // Mutate metadata read from real installed packages: reject a mixed release,
  // conflicting ABIs/bitsets and a second native image before release reuse.
  for (const [label, mutate] of [
    ["version", p => { p.version = "0.0.0-wrong"; }],
    ["native-abi", p => { p.madDomRuntime.nodeApiAbiVersion = 999; }],
    ["ffi-abi", p => { p.madDomRuntime.ffiAbiVersion = 999; }],
    ["capabilities", p => { p.madDomRuntime.ffiCapabilities = 0; }],
    ["capability-level", p => { p.madDomBuild.capabilityLevel = "invented"; }],
    ["second-image", p => { p.madDomFfi = "./copy.so"; }],
  ]) {
    const invalid = structuredClone(installedPlatform); mutate(invalid);
    let code;
    try { validatePackageMetadata(installedMain, invalid); } catch (error) { code = error.code; }
    expect(code === "MAD_DOM_METADATA_MISMATCH", `metadata ${label} was accepted`, invalid);
    results.push({ label: `metadata-${label}`, code });
  }
  writeFileSync(join(out, "runtime-results.json"), JSON.stringify({ bunVersion: Bun.version, platform: info, results }, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
  console.log(`install-smoke: ALL CHECKS PASSED (${hostName}@${version}; Bun ${Bun.version}; automatic FFI ${automatic.ffi.status})`);
}
try { main(); }
catch (error) {
  console.error(`install-smoke: ${error.message}`);
  console.error(JSON.stringify({ runtime: runtimeObservation(), results }, null, 2));
  process.exitCode = 1;
}
