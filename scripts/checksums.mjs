#!/usr/bin/env bun
// sha256 checksum manifest for release artifacts (T49 / ADR-0005 §7).
//
// The release workflow computes a single manifest over every platform-package
// tarball and the main-package tarball and publishes it alongside the GitHub
// Release. `verify` is the "must pass before the main package is published"
// step: every manifest entry must recompute to the same hash and no tarball
// may be missing.
//
// Usage:
//   bun scripts/checksums.mjs generate <dir> [--out <manifest>]
//   bun scripts/checksums.mjs verify   <dir> [--manifest <manifest>]
//
// The manifest is the standard shasum format, one `<sha256>  <filename>` per
// line sorted by filename; the filename carries the package name + version
// (npm tarball convention), which is the ADR-0005 §7 "package name + version +
// sha256" contract.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = join(REPO_ROOT, "build", "SHASUMS256.txt");

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function tarballs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
}

function generate(dir, manifest) {
  const entries = tarballs(dir).map((name) => `${sha256(join(dir, name))}  ${name}`);
  writeFileSync(manifest, `${entries.join("\n")}\n`);
  return { count: entries.length, manifest };
}

function verify(dir, manifest) {
  const expected = new Map();
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    const match = line.match(/^([0-9a-f]{64})\s\s(.+\.tgz)$/);
    if (match) expected.set(match[2], match[1]);
  }
  if (expected.size === 0) throw new Error(`no manifest entries found in ${manifest}`);

  const problems = [];
  for (const [name, want] of expected) {
    const filePath = join(dir, name);
    if (!readdirSync(dir).includes(name)) {
      problems.push(`missing tarball: ${name}`);
      continue;
    }
    const got = sha256(filePath);
    if (got !== want) problems.push(`checksum mismatch for ${name}: want ${want}, got ${got}`);
  }
  return { entries: expected.size, problems };
}

const [subcommand, dirArg, ...rest] = process.argv.slice(2);
if (!["generate", "verify"].includes(subcommand) || !dirArg) {
  console.error("usage: bun scripts/checksums.mjs <generate|verify> <dir> [--out|--manifest <file>]");
  process.exit(2);
}

try {
  const dir = resolve(dirArg);
  const flag = rest.indexOf(subcommand === "generate" ? "--out" : "--manifest");
  const manifest = flag === -1 ? DEFAULT_MANIFEST : resolve(rest[flag + 1]);

  if (subcommand === "generate") {
    const { count } = generate(dir, manifest);
    console.log(`checksums: wrote ${count} entry(ies) to ${manifest}`);
  } else {
    const { entries, problems } = verify(dir, manifest);
    if (problems.length > 0) {
      console.error(`checksums: ${problems.length} problem(s) across ${entries} manifest entry(ies):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`checksums: OK — all ${entries} manifest entry(ies) recompute to the same sha256`);
  }
} catch (error) {
  console.error(`checksums: ${error.message}`);
  process.exit(1);
}
