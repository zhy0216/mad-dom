#!/usr/bin/env bun
// Release failure rollback (T49 / ADR-0005 §10).
//
// npm versions are immutable, so a rollback never removes a published version:
// it points the dist-tag back at the last healthy version of every package in
// the release — the main package and every platform package move together
// (no partial rollback, which under exact-pin optionalDependencies would
// fabricate mixed-version installs). `unpublish` is out of scope except for
// malicious-code emergencies and follows npm policy.
//
// Usage:
//   bun scripts/release-rollback.mjs --tag <next|latest> --last-healthy <v>
//     [--version <broken>] [--stage <alpha|beta|stable>] [--no-dry-run]
//
//   --tag          the dist-tag to re-point (alpha/beta use `next`, stable
//                  `latest`).
//   --last-healthy the last version known to work; every package is moved to
//                  it.
//   --version      the broken version this rollback undoes (informational).
//   --stage        which platform set to roll back (default: the full matrix;
//                  alpha rolls the alpha set).
//   --no-dry-run   actually execute `npm dist-tag add`; default prints the
//                  exact commands.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { stagePlatformNames } from "./platform-matrix.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { tag: null, lastHealthy: null, version: null, stage: "beta", dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--tag":
        args.tag = argv[++i];
        break;
      case "--last-healthy":
        args.lastHealthy = argv[++i];
        break;
      case "--version":
        args.version = argv[++i];
        break;
      case "--stage":
        args.stage = argv[++i];
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.tag === null || args.lastHealthy === null) {
    throw new Error("usage: bun scripts/release-rollback.mjs --tag <next|latest> --last-healthy <v> [--version <broken>] [--stage alpha|beta|stable] [--no-dry-run]");
  }

  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const broken = args.version ?? pkg.version;
  const packages = ["mad-dom", ...stagePlatformNames(args.stage)];
  const commands = packages.map((name) => `npm dist-tag add ${name}@${args.lastHealthy} ${args.tag}`);

  console.log(`release-rollback: ${args.dryRun ? "dry-run" : "executing"} for ${broken} → ${args.lastHealthy} (${args.tag})`);
  console.log(`  moving ${packages.length} package(s) together: ${packages.join(", ")}`);

  if (args.dryRun) {
    for (const cmd of commands) console.log(`  ${cmd}`);
    console.log("\n  Main package and platform packages always roll back together (exact-pin optionalDependencies).");
    return;
  }
  if (process.env.MAD_DOM_ALLOW_PUBLISH !== "1") {
    throw new Error("executing a rollback requires MAD_DOM_ALLOW_PUBLISH=1 in addition to --no-dry-run");
  }
  for (const cmd of commands) {
    const [bin, ...rest] = cmd.split(" ");
    const proc = spawnSync(bin, rest, { stdio: "inherit" });
    if (proc.status !== 0) throw new Error(`${cmd} failed (exit ${proc.status})`);
  }
  console.log("release-rollback: complete");
}

try {
  main();
} catch (error) {
  console.error(`release-rollback: ${error.message}`);
  process.exit(1);
}
