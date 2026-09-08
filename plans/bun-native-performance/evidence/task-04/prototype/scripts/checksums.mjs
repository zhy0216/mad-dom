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
//
// Host IO (T5): tarball reads, manifest reads and manifest writes go through
// `Bun.file`/`Bun.write` when the host-IO capability is available, and
// hashing through `Bun.CryptoHasher`; node:fs/node:crypto stay as the
// fallback. Each capability is probed independently, so a partial host (file
// read without CryptoHasher, or vice versa) still lands on the working
// implementation instead of crashing. Digest bytes, manifest format, console
// messages and exit codes are identical on every combination.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bunHostIO } from "../js/facade/bun-host-io.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = join(REPO_ROOT, "build", "SHASUMS256.txt");

// Both hashing branches consume a Buffer so they are interchangeable: node
// crypto rejects a raw ArrayBuffer, and a Buffer is a valid CryptoHasher
// input.
async function readBytes(filePath) {
  if (bunHostIO("file")) {
    return Buffer.from(await Bun.file(filePath).arrayBuffer());
  }
  return readFileSync(filePath);
}

async function sha256(filePath) {
  const bytes = await readBytes(filePath);
  if (bunHostIO("CryptoHasher")) {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  }
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

async function readManifestText(manifest) {
  return bunHostIO("file") ? await Bun.file(manifest).text() : readFileSync(manifest, "utf8");
}

async function writeManifestText(manifest, contents) {
  if (bunHostIO("write")) {
    await Bun.write(manifest, contents);
  } else {
    writeFileSync(manifest, contents);
  }
}

function tarballs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
}

// Measurement-only prototype: two jobs, at most 8 MiB declared file bytes.
// Immutable benchmark fixtures only; file growth after stat is not bounded.
async function hashNames(dir, names) {
  const results = new Map();
  for (let index = 0; index < names.length;) {
    const batch = [];
    let bytes = 0;
    while (index < names.length && batch.length < 2) {
      const name = names[index];
      const size = statSync(join(dir, name)).size;
      if (batch.length && bytes + size > 8 * 1024 * 1024) break;
      batch.push(name);
      bytes += size;
      index++;
    }
    const settled = await Promise.allSettled(batch.map(name => sha256(join(dir, name))));
    for (let i = 0; i < settled.length; i++) {
      if (settled[i].status === "rejected") throw settled[i].reason;
      results.set(batch[i], settled[i].value);
    }
  }
  return results;
}

async function generate(dir, manifest) {
  const entries = [...await hashNames(dir, tarballs(dir))].map(([name, hash]) => `${hash}  ${name}`);
  await writeManifestText(manifest, `${entries.join("\n")}\n`);
  return { count: entries.length, manifest };
}

async function verify(dir, manifest) {
  const expected = new Map();
  for (const line of (await readManifestText(manifest)).split("\n")) {
    const match = line.match(/^([0-9a-f]{64})\s\s(.+\.tgz)$/);
    if (match) expected.set(match[2], match[1]);
  }
  if (expected.size === 0) throw new Error(`no manifest entries found in ${manifest}`);

  // Snapshot membership once; retain manifest insertion order for diagnostics.
  const available = new Set(readdirSync(dir));
  const hashes = await hashNames(dir, [...expected.keys()].filter(name => available.has(name)));
  const problems = [];
  for (const [name, want] of expected) {
    const filePath = join(dir, name);
    if (!available.has(name)) {
      problems.push(`missing tarball: ${name}`);
      continue;
    }
    const got = hashes.get(name);
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
    const { count } = await generate(dir, manifest);
    console.log(`checksums: wrote ${count} entry(ies) to ${manifest}`);
  } else {
    const { entries, problems } = await verify(dir, manifest);
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
