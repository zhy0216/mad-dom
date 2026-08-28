#!/usr/bin/env bun
// Deterministic public API snapshot generator for the happy-dom baseline (T08).
//
// The generator never imports happy-dom itself. It spawns an isolated
// subprocess (bun compat/public-api/collector.js happy-dom <tmp-output>) that
// loads the locked happy-dom entry in a clean process, then reads the JSON
// document the collector produced, wraps it in snapshot metadata and writes
// the committed snapshot.
//
// Usage:
//   bun compat/public-api/generate-snapshot.js [--out <path>]
//
// Determinism contract (why "same environment -> no meaningless diff"):
//   - meta contains NO timestamps: only the generator identity (mad-dom
//     version from package.json), the baseline reference read from
//     compat/happy-dom-baseline.json and the snapshot schema version;
//   - the collector records no time-, pid- or randomness-dependent values
//     (see the rule header in collector.js);
//   - every object key is sorted before serialization; arrays contain
//     pre-sorted data;
//   - the output ends with a trailing newline and 2-space indentation.
//
// Any change to the output format is a schema change: bump SNAPSHOT_SCHEMA
// and document it in compat/public-api/README.md.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_OUT = join(SCRIPT_DIR, "snapshot.json");
const COLLECTOR_PATH = join(SCRIPT_DIR, "collector.js");
const BASELINE_PATH = join(REPO_ROOT, "compat", "happy-dom-baseline.json");
const PACKAGE_PATH = join(REPO_ROOT, "package.json");

const SNAPSHOT_SCHEMA = "1.0.0";
const COLLECT_TIMEOUT_MS = 120_000;

const args = process.argv.slice(2);
let outPath = DEFAULT_OUT;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--out") {
    outPath = resolve(args[index + 1] ?? "");
    index++;
  }
}
if (!outPath) {
  console.error("generate-snapshot: --out requires a path");
  process.exit(1);
}

const pkg = readJson(PACKAGE_PATH);
const baseline = readJson(BASELINE_PATH);

const installedVersion = readJson(
  join(REPO_ROOT, "node_modules", "happy-dom", "package.json"),
).version;
if (installedVersion !== baseline.happyDom.npmVersion) {
  console.error(
    `generate-snapshot: installed happy-dom ${installedVersion} does not match the locked baseline ` +
      `${baseline.happyDom.npmVersion}; run "npm install --save-exact --save-dev happy-dom@${baseline.happyDom.npmVersion}"`,
  );
  process.exit(1);
}

  const collected = await runCollector();
const snapshot = {
  meta: {
    schemaVersion: SNAPSHOT_SCHEMA,
    generator: {
      name: pkg.name,
      version: pkg.version,
      entry: "compat/public-api/generate-snapshot.js",
    },
    baseline: {
      manifest: "compat/happy-dom-baseline.json",
      manifestSchemaVersion: baseline.schemaVersion,
      happyDom: {
        npmVersion: baseline.happyDom.npmVersion,
        gitCommit: baseline.happyDom.gitCommit,
        tag: baseline.happyDom.tag,
      },
      bun: { version: baseline.bun.version },
    },
    target: {
      specifier: collected.target.specifier,
      installedVersion,
    },
  },
  exports: collected.exports,
};

writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const exportCount = Object.keys(collected.exports).length;
const classCount = Object.values(collected.exports).filter((entry) => entry.category === "class").length;
console.log(`generate-snapshot: wrote ${outPath}`);
console.log(`  exports ${exportCount} (classes ${classCount})`);
console.log(`  happy-dom ${installedVersion} @ baseline ${baseline.happyDom.gitCommit.slice(0, 8)}`);
console.log(`  generator ${pkg.name} ${pkg.version}, snapshot schema ${SNAPSHOT_SCHEMA}`);

async function runCollector() {
  const child = spawn(process.execPath, [COLLECTOR_PATH, "happy-dom", outTmpPath()], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, COLLECT_TIMEOUT_MS);

  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  clearTimeout(timeout);

  if (exitCode !== 0) {
    console.error(`generate-snapshot: collector exited with code ${exitCode}`);
    if (stderr.trim() !== "") {
      console.error(stderr.trim());
    }
    process.exit(1);
  }

  // The collector writes its JSON payload to a temp file (so that console
  // noise from inspected constructors can never corrupt anything) and only
  // prints diagnostics on stdout. Read the payload and clean it up.
  try {
    const collected = JSON.parse(readFileSync(outTmpPath(), "utf8"));
    rmSync(outTmpPath(), { force: true });
    return collected;
  } catch (error) {
    console.error(`generate-snapshot: collector payload unusable: ${error.message}`);
    if (stdout.trim() !== "") {
      console.error(stdout.trim());
    }
    process.exit(1);
  }
}

// Temp file lives next to the requested output path; deleted after reading.
function outTmpPath() {
  return `${outPath}.collector-tmp.json`;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`generate-snapshot: cannot read ${path}: ${error.message}`);
    process.exit(1);
  }
}
