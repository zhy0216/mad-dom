#!/usr/bin/env bun
// Release orchestration for MAD DOM native platform packages (T49 / ADR-0005
// §10, §7).
//
// Subcommands:
//   draft   — build/pack everything for a stage and print the ordered publish
//             plan without touching the registry (the alpha/beta/stable
//             rehearsal).
//   publish — same preparation, then actually publish. Hard-ordered: every
//             platform package first, a registry integrity check over all of
//             them, then the main package last. Refuses to publish unless both
//             `--no-dry-run` and `MAD_DOM_ALLOW_PUBLISH=1` are present; with
//             anything else it prints the exact plan it would execute.
//
// Common flags:
//   --stage <alpha|beta|stable>   release stage (default alpha). alpha omits
//                                 win32-x64 from the shipped set (ADR-0005 §2).
//   --version <v>                 version for every package (default: repo
//                                 package.json version; main and platform
//                                 packages always share it, ADR-0005 §5).
//   --out <dir>                   artifact root (default <repo>/build/release).
//   --no-build                    reuse existing platform packages in
//                                 <out>/platform instead of compiling.
//
// The publish plan is printed in the fixed order the ADR mandates: platforms
// (sorted by matrix order) → registry verification → main package. dist-tag:
// alpha/beta publish to `next`; stable to `latest` (the stable gate, T50, owns
// the final `latest` migration per ADR-0005 §10).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { TRIPLE_MATRIX, platformPackageName, stagePlatformNames } from "./platform-matrix.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(REPO_ROOT, "build", "release");

const STAGES = ["alpha", "beta", "stable"];
const SHIPPED_FILES = ["index.js", "index.d.ts", "js", "README.md", "LICENSE"];

function parseArgs(argv) {
  const args = { command: argv[0], stage: "alpha", version: null, out: DEFAULT_OUT, noBuild: false, dryRun: true };
  for (let i = 1; i < argv.length; i++) {
    switch (argv[i]) {
      case "--stage":
        args.stage = argv[++i];
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
      case "--no-dry-run":
        args.dryRun = false;
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function run(cmd, args, opts = {}) {
  const proc = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${proc.status})${proc.stderr ? `: ${proc.stderr}` : ""}`);
  }
  return proc;
}

function sha512Base64(filePath) {
  return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

function tarballName(pkgName, version) {
  return `${pkgName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

function packPackage(pkgDir, version, outDir, pkgName) {
  mkdirSync(outDir, { recursive: true });
  run("npm", ["pack", pkgDir, "--pack-destination", outDir, "--json"], { silent: true });
  return join(outDir, tarballName(pkgName, version));
}

function hostTriple() {
  const proc = run("rustc", ["-vV"], { silent: true });
  return proc.stdout.match(/^host:\s*(\S+)/m)?.[1] ?? null;
}

function installedTargets() {
  const proc = run("rustup", ["target", "list", "--installed"], { silent: true });
  return new Set(proc.stdout.split(/\s+/).filter(Boolean));
}

function buildPlatforms(stage, version, outDir, noBuild) {
  const platformDir = join(outDir, "platform");
  const platformTarballs = [];
  const host = hostTriple();
  const installed = installedTargets();
  for (const triple of Object.keys(TRIPLE_MATRIX)) {
    const meta = TRIPLE_MATRIX[triple];
    if (stage === "alpha" && (meta.phase === 2 || meta.os === "win32")) continue;
    const pkgName = platformPackageName(meta);
    const pkgDir = join(platformDir, pkgName);
    if (!existsSync(join(pkgDir, "package.json")) && !noBuild) {
      if (!installed.has(triple) && triple !== host) {
        console.warn(
          `release: skipping ${triple} (target not installed on this host; the CI matrix builds it on a native runner)`,
        );
        continue;
      }
      try {
        run("bun", ["scripts/build-platform-package.mjs", "--triple", triple, "--version", version, "--out", platformDir]);
      } catch (error) {
        if (triple === host) throw error;
        console.warn(`release: could not build ${triple} on this host (${host}): ${error.message}`);
        continue;
      }
    }
    if (!existsSync(join(pkgDir, "package.json"))) {
      console.warn(`release: skipping ${pkgName} (not built on this host; CI builds it per platform)`);
      continue;
    }
    const tgz = packPackage(pkgDir, version, join(outDir, "tgz"), pkgName);
    platformTarballs.push({ pkgName, tgz, triple });
  }
  return platformTarballs;
}

function stageMainPackage(stage, version, outDir, shippedPlatformNames) {
  const staging = join(outDir, "main-staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  for (const file of SHIPPED_FILES) {
    const src = join(REPO_ROOT, file);
    if (!existsSync(src)) throw new Error(`main package staging: missing ${src}`);
    cpSync(src, join(staging, file), { recursive: true });
  }

  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const optionalDependencies = {};
  for (const name of shippedPlatformNames) optionalDependencies[name] = version;
  const stagedPkg = {
    ...pkg,
    version,
    sideEffects: true,
    optionalDependencies,
    scripts: undefined,
    devDependencies: undefined,
    publishConfig: { ...(pkg.publishConfig ?? {}), tag: stage === "stable" ? "latest" : "next" },
  };
  delete stagedPkg.scripts;
  delete stagedPkg.devDependencies;
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(stagedPkg, null, 2)}\n`);

  const tgz = packPackage(staging, version, join(outDir, "tgz"), "mad-dom");
  return { name: "mad-dom", tgz };
}

function stageLabel(stage, shipped) {
  return `${stage} (ships ${shipped.length} platform package(s): ${shipped.join(", ") || "none"})`;
}

function printPlan(args, platformTarballs, shipped, tgzDir) {
  const tag = args.stage === "stable" ? "latest" : "next";
  const tgzCount = existsSync(tgzDir) ? readdirSync(tgzDir).filter((name) => name.endsWith(".tgz")).length : 0;
  const plan = [
    `=== MAD DOM release rehearsal: ${stageLabel(args.stage, shipped)} ===`,
    `version: ${args.version} · dist-tag: ${tag} · provenance: npm publish --provenance`,
    "",
    `Publish order (HARD — platform packages first, registry verification, main package last):`,
  ];
  for (const { pkgName } of platformTarballs) {
    plan.push(`  1. npm publish --provenance --tag ${tag} ${pkgName}@${args.version}   (from ${pkgName} tarball)`);
  }
  plan.push(`  2. verify every platform package above exists on the registry with the expected integrity:`);
  for (const { pkgName } of platformTarballs) {
    plan.push(`     npm view ${pkgName}@${args.version} dist.integrity  (must equal the local sha512 base64)`);
  }
  plan.push(
    `  3. npm publish --provenance --tag ${tag} mad-dom@${args.version}   (main package LAST; refuses to run if step 2 fails)`,
  );
  plan.push("");
  plan.push(`Checksums: build/SHASUMS256.txt over ${tgzCount} tarball(s).`);
  plan.push(`Rollback: bun scripts/release-rollback.mjs --tag ${tag} --version ${args.version} --last-healthy <v>`);
  console.log(plan.join("\n"));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function verifyRegistry(platformTarballs, version, dryRun) {
  if (dryRun) {
    console.log(`release: [dry-run] registry integrity verification for ${platformTarballs.length} platform package(s) skipped`);
    return;
  }
  for (const { pkgName, tgz } of platformTarballs) {
    const local = `sha512-${sha512Base64(tgz)}`;
    let remote = "";
    // npmjs.org metadata can lag a fresh publish by minutes; retry before
    // declaring a mismatch (a mismatch aborts before the main package ships).
    for (let attempt = 0; attempt < 10 && remote !== local; attempt++) {
      if (attempt > 0) sleepSync(20_000);
      const proc = run("npm", ["view", `${pkgName}@${version}`, "dist.integrity"], { silent: true });
      remote = proc.stdout.trim();
    }
    if (remote !== local) {
      throw new Error(
        `registry integrity mismatch for ${pkgName}@${version}: local ${local}, registry ${remote || "(missing)"}. ` +
          "Aborting before the main package is published.",
      );
    }
  }
  console.log(`release: registry integrity OK for all ${platformTarballs.length} platform package(s)`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!["draft", "publish"].includes(args.command)) {
    throw new Error("usage: bun scripts/release.mjs <draft|publish> [--stage alpha|beta|stable] [--version <v>] [--out <dir>] [--no-build] [--no-dry-run]");
  }
  if (!STAGES.includes(args.stage)) throw new Error(`unknown stage: ${args.stage} (expected ${STAGES.join("|")})`);
  if (args.command === "publish" && !args.dryRun && process.env.MAD_DOM_ALLOW_PUBLISH !== "1") {
    throw new Error(
      "real publish requires MAD_DOM_ALLOW_PUBLISH=1 in addition to --no-dry-run. " +
        "This guard is deliberate: publishing is never done from a development task (T49 boundary).",
    );
  }

  const outDir = resolve(args.out);
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  args.version = args.version ?? pkg.version;

  const shipped = stagePlatformNames(args.stage);
  const platformTarballs = buildPlatforms(args.stage, args.version, outDir, args.noBuild);
  const { tgz: mainTgz } = stageMainPackage(args.stage, args.version, outDir, shipped);

  const tgzDir = join(outDir, "tgz");
  run("bun", ["scripts/checksums.mjs", "generate", tgzDir, "--out", join(outDir, "SHASUMS256.txt")]);
  run("bun", ["scripts/checksums.mjs", "verify", tgzDir, "--manifest", join(outDir, "SHASUMS256.txt")]);

  printPlan(args, platformTarballs, shipped, tgzDir);

  if (args.command === "publish" && !args.dryRun) {
    console.log("\nrelease: EXECUTING publish plan");
    for (const { pkgName, tgz } of platformTarballs) {
      run("npm", ["publish", tgz, "--provenance", `--tag`, args.stage === "stable" ? "latest" : "next"]);
    }
    verifyRegistry(platformTarballs, args.version, args.dryRun);
    run("npm", ["publish", mainTgz, "--provenance", "--tag", args.stage === "stable" ? "latest" : "next"]);
    console.log("release: publish complete");
  } else {
    console.log(`\nrelease: dry-run complete (nothing was published; ${platformTarballs.length} platform tarball(s) + main tarball packed under ${tgzDir})`);
  }
}

try {
  main();
} catch (error) {
  console.error(`release: ${error.message}`);
  process.exit(1);
}
