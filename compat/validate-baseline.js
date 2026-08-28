#!/usr/bin/env bun
// Validator for compat/happy-dom-baseline.json (T07).
// Zero dependencies, fully offline: reads the manifest, the repo's
// .bun-version, and the baseline values pinned from ADR-0002 section 1.
// No upstream / network access happens here or in any baseline generation.
//
// Usage:
//   bun compat/validate-baseline.js [path/to/manifest.json]
//
// Exit codes: 0 = valid, 1 = invalid.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_MANIFEST = join(SCRIPT_DIR, "happy-dom-baseline.json");

const SCHEMA_VERSION = "1.0.0";

// Pinned baseline triple from ADR-0002 section 1. These constants must only
// change together with the manifest and the ADR, inside the same independent
// baseline-upgrade commit (ADR-0002 section 9).
const PINNED = {
  happyDomNpmVersion: "20.11.11",
  happyDomGitCommit: "64e2c774cadbb8eda5416c1e2bcca5006d1b5df9",
  bunVersion: "1.4.0",
};

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const GIT_COMMIT_SHA = /^[0-9a-f]{40}$/;
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const HTTPS_URL = /^https:\/\/\S+$/;

const errors = [];

function fail(path, message) {
  errors.push(`${path}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(path, object, allowedKeys) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) {
      fail(`${path}.${key}`, "unknown field (schema forbids extra keys)");
    }
  }
}

function checkNonEmptyString(path, value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkSemver(path, value) {
  if (typeof value !== "string" || value === "") {
    fail(path, "must be a non-empty semver string");
    return;
  }
  if (!SEMVER.test(value)) {
    fail(path, `must be a valid semver (MAJOR.MINOR.PATCH), got ${JSON.stringify(value)}`);
  }
}

function checkCommit(path, value) {
  if (typeof value !== "string" || value === "") {
    fail(path, "must be a non-empty git commit SHA");
    return;
  }
  if (!GIT_COMMIT_SHA.test(value)) {
    fail(path, `must be a 40-character lowercase hex SHA-1, got ${JSON.stringify(value)}`);
  }
}

function checkIsoUtc(path, value) {
  if (typeof value !== "string" || value === "") {
    fail(path, "must be a non-empty ISO 8601 UTC timestamp");
    return;
  }
  if (!ISO_8601_UTC.test(value)) {
    fail(path, `must be ISO 8601 with UTC designator "Z", got ${JSON.stringify(value)}`);
    return;
  }
  if (Number.isNaN(Date.parse(value))) {
    fail(path, `must be a parseable date, got ${JSON.stringify(value)}`);
  }
}

function checkHttpsUrl(path, value) {
  if (typeof value !== "string" || value === "") {
    fail(path, "must be a non-empty URL string");
    return;
  }
  if (!HTTPS_URL.test(value)) {
    fail(path, `must be an https:// URL, got ${JSON.stringify(value)}`);
  }
}

function readBunVersionFile() {
  try {
    return readFileSync(join(REPO_ROOT, ".bun-version"), "utf8").trim();
  } catch {
    return null;
  }
}

function validate(manifest) {
  if (!isObject(manifest)) {
    fail("$", "manifest must be a JSON object");
    return;
  }

  checkKeys("$", manifest, [
    "schemaVersion",
    "generator",
    "happyDom",
    "bun",
    "generatedAt",
    "source",
    "adr",
  ]);

  if (!checkNonEmptyString("$.schemaVersion", manifest.schemaVersion)) {
    fail("$.schemaVersion", "must be a non-empty string");
  } else if (manifest.schemaVersion !== SCHEMA_VERSION) {
    fail(
      "$.schemaVersion",
      `unsupported schema version ${JSON.stringify(manifest.schemaVersion)}, expected ${JSON.stringify(SCHEMA_VERSION)}`,
    );
  }

  const generator = manifest.generator;
  if (!isObject(generator)) {
    fail("$.generator", "must be an object");
  } else {
    checkKeys("$.generator", generator, ["name", "version"]);
    if (!checkNonEmptyString("$.generator.name", generator.name)) {
      fail("$.generator.name", "must be a non-empty string");
    }
    checkSemver("$.generator.version", generator.version);
  }

  const happyDom = manifest.happyDom;
  if (!isObject(happyDom)) {
    fail("$.happyDom", "must be an object");
  } else {
    checkKeys("$.happyDom", happyDom, ["npmVersion", "gitCommit", "tag", "npmPublishTime"]);
    checkSemver("$.happyDom.npmVersion", happyDom.npmVersion);
    checkCommit("$.happyDom.gitCommit", happyDom.gitCommit);
    if (!checkNonEmptyString("$.happyDom.tag", happyDom.tag)) {
      fail("$.happyDom.tag", "must be a non-empty string");
    } else if (
      typeof happyDom.npmVersion === "string" &&
      SEMVER.test(happyDom.npmVersion) &&
      happyDom.tag !== `v${happyDom.npmVersion}`
    ) {
      fail("$.happyDom.tag", `must be "v${happyDom.npmVersion}" to match npmVersion`);
    }
    checkIsoUtc("$.happyDom.npmPublishTime", happyDom.npmPublishTime);

    if (happyDom.npmVersion !== PINNED.happyDomNpmVersion) {
      fail(
        "$.happyDom.npmVersion",
        `drifts from the ADR-0002 pinned baseline ${JSON.stringify(PINNED.happyDomNpmVersion)}; run the ADR-0002 section 9 upgrade flow`,
      );
    }
    if (happyDom.gitCommit !== PINNED.happyDomGitCommit) {
      fail(
        "$.happyDom.gitCommit",
        `drifts from the ADR-0002 pinned baseline ${JSON.stringify(PINNED.happyDomGitCommit)}; run the ADR-0002 section 9 upgrade flow`,
      );
    }
  }

  const bun = manifest.bun;
  if (!isObject(bun)) {
    fail("$.bun", "must be an object");
  } else {
    checkKeys("$.bun", bun, ["version"]);
    checkSemver("$.bun.version", bun.version);

    const bunVersionFile = readBunVersionFile();
    if (bunVersionFile === null) {
      fail("$.bun.version", `cannot read ${join(REPO_ROOT, ".bun-version")} for cross-check`);
    } else if (bun.version !== bunVersionFile) {
      fail(
        "$.bun.version",
        `does not match .bun-version (manifest ${JSON.stringify(bun.version)}, file ${JSON.stringify(bunVersionFile)})`,
      );
    }

    if (bun.version !== PINNED.bunVersion) {
      fail(
        "$.bun.version",
        `drifts from the ADR-0002 pinned baseline ${JSON.stringify(PINNED.bunVersion)}; run the ADR-0002 section 9 upgrade flow`,
      );
    }
  }

  checkIsoUtc("$.generatedAt", manifest.generatedAt);

  const source = manifest.source;
  if (!isObject(source)) {
    fail("$.source", "must be an object");
  } else {
    checkKeys("$.source", source, [
      "kind",
      "registry",
      "tarball",
      "upstreamRepository",
      "branchPolicy",
    ]);
    if (!checkNonEmptyString("$.source.kind", source.kind)) {
      fail("$.source.kind", "must be a non-empty string");
    }
    checkHttpsUrl("$.source.registry", source.registry);
    checkHttpsUrl("$.source.tarball", source.tarball);
    checkHttpsUrl("$.source.upstreamRepository", source.upstreamRepository);
    if (!checkNonEmptyString("$.source.branchPolicy", source.branchPolicy)) {
      fail("$.source.branchPolicy", "must be a non-empty string");
    } else if (!/main/i.test(source.branchPolicy)) {
      fail("$.source.branchPolicy", "must state the no-upstream-main policy");
    }
  }

  if (!checkNonEmptyString("$.adr", manifest.adr)) {
    fail("$.adr", "must be a non-empty relative path pointing at ADR-0002");
  } else if (!/adr\/0002-happy-dom-compatibility-baseline-and-differential-protocol\.md$/.test(manifest.adr)) {
    fail("$.adr", `must point at ADR-0002, got ${JSON.stringify(manifest.adr)}`);
  }
}

function main() {
  const manifestPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_MANIFEST;

  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    console.error(`FAIL ${manifestPath}: cannot read manifest (${error.message})`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    console.error(`FAIL ${manifestPath}: invalid JSON (${error.message})`);
    process.exit(1);
  }

  validate(manifest);

  if (errors.length > 0) {
    console.error(`FAIL ${manifestPath}: ${errors.length} error(s)`);
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }

  console.log(`OK ${manifestPath}`);
  console.log(`  schemaVersion ${manifest.schemaVersion}`);
  console.log(
    `  happy-dom ${manifest.happyDom.npmVersion} (tag ${manifest.happyDom.tag}, commit ${manifest.happyDom.gitCommit.slice(0, 8)}...)`,
  );
  console.log(`  bun ${manifest.bun.version} (matches .bun-version)`);
  console.log(`  generator ${manifest.generator.name} ${manifest.generator.version}`);
  console.log(`  generatedAt ${manifest.generatedAt}`);
  console.log("  pinned to ADR-0002 section 1; offline check, upstream main never read");
}

main();
