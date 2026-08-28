// Tests for the public API snapshot pipeline (T08).
//
// Covered here:
//   - collector determinism and key normalization on a synthetic fixture;
//   - fixture assertions for prototype chains, arity, descriptor shapes,
//     symbol (informational) handling, construction statuses and defaults;
//   - regeneration equivalence: running the real generator in an isolated
//     subprocess must reproduce compat/public-api/snapshot.json byte-for-byte;
//   - snapshot meta contains the generator version and baseline references
//     and no volatile fields;
//   - comparator sensitivity: an intentionally modified fake module surfaces
//     missing / extra / shape-mismatch / value-mismatch differences;
//   - comparator CLI exit codes for tampered and informational-only inputs.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareSnapshots, CATEGORY } from "../../compat/public-api/compare-snapshot.js";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const COLLECTOR = join(REPO_ROOT, "compat", "public-api", "collector.js");
const GENERATOR = join(REPO_ROOT, "compat", "public-api", "generate-snapshot.js");
const COMPARATOR_CLI = join(REPO_ROOT, "compat", "public-api", "compare-snapshot-cli.js");
const SNAPSHOT_PATH = join(REPO_ROOT, "compat", "public-api", "snapshot.json");
const FIXTURE_PATH = join(REPO_ROOT, "tests", "compat", "fixtures", "fake-dom.mjs");
const FIXTURE_MODIFIED_PATH = join(REPO_ROOT, "tests", "compat", "fixtures", "fake-dom-modified.mjs");

const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
const BASELINE = JSON.parse(readFileSync(join(REPO_ROOT, "compat", "happy-dom-baseline.json"), "utf8"));
const PACKAGE = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

const TMP_DIR = mkdtempSync(join(tmpdir(), "mad-dom-public-api-snapshot-"));

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function runProcess(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function collectFixture(fixturePath, outName) {
  const outPath = join(TMP_DIR, outName);
  const run = await runProcess(process.execPath, [COLLECTOR, fixturePath, outPath]);
  expect(run.code).toBe(0);
  return JSON.parse(readFileSync(outPath, "utf8"));
}

function expectKeysSorted(object, path) {
  const keys = Object.keys(object);
  expect(keys, `${path} keys must be sorted`).toEqual([...keys].sort());
}

describe("collector on synthetic fixture", () => {
  test("is deterministic across isolated subprocess runs", async () => {
    const first = await collectFixture(FIXTURE_PATH, "fixture-1.json");
    const second = await collectFixture(FIXTURE_PATH, "fixture-2.json");
    expect(first).toEqual(second);
    expect(first.schema).toBe("mad-dom-public-api-collector/1");
    expectKeysSorted(first.exports, "exports");
  }, 60_000);

  test("records export metadata, arity and prototype chains", async () => {
    const collected = await collectFixture(FIXTURE_PATH, "fixture-3.json");
    const exports = collected.exports;

    expect(exports.FAKE_VERSION).toMatchObject({ category: "primitive", typeOf: "string", value: "1.2.3" });
    expect(exports.fakeCreateNode).toMatchObject({ category: "function", length: 1, name: "fakeCreateNode" });
    expect(exports.FakeNode).toMatchObject({
      category: "class",
      typeOf: "function",
      length: 0,
      name: "FakeNode",
      prototypeChain: ["FakeNode", "Object"],
      constructorChain: ["FakeNode", "Function", "Object"],
    });
    expect(exports.FakeElement).toMatchObject({
      category: "class",
      prototypeChain: ["FakeElement", "FakeNode", "Object"],
      constructorChain: ["FakeElement", "FakeNode", "Function", "Object"],
    });
    expect(exports.FakeElement.prototypeMembers).toEqual(["constructor", "querySelector"]);
  }, 60_000);

  test("records descriptor shapes without invoking accessors", async () => {
    const collected = await collectFixture(FIXTURE_PATH, "fixture-4.json");
    const node = collected.exports.FakeNode;
    const windowLike = collected.exports.FakeWindowLike;

    expect(node.prototypeDescriptors.nodeName).toEqual({
      kind: "accessor",
      enumerable: false,
      configurable: true,
      hasGetter: true,
      hasSetter: false,
    });
    expect(node.prototypeDescriptors.append).toMatchObject({ kind: "data", valueType: "function" });
    expect(node.staticDescriptors.NODE_TYPE).toMatchObject({ kind: "data", valueType: "number" });
    expect(windowLike.prototypeDescriptors.location).toMatchObject({
      kind: "accessor",
      hasGetter: true,
      hasSetter: true,
    });
  }, 60_000);

  test("records construction status, serializable defaults and exclusions", async () => {
    const collected = await collectFixture(FIXTURE_PATH, "fixture-5.json");
    const node = collected.exports.FakeNode;
    const broken = collected.exports.FakeBrokenElement;
    const windowLike = collected.exports.FakeWindowLike;

    expect(node.construction.status).toBe("constructible");
    expect(node.construction.instanceDefaults).toEqual({ label: "node", nodeType: 1 });

    expect(broken.construction).toEqual({
      strategy: "no-args",
      status: "not-constructible",
      errorName: "TypeError",
    });

    expect(windowLike.construction.status).toBe("constructible");
    expect(windowLike.construction.instanceDefaults).toEqual({
      closed: false,
      name: "",
      negZero: "~negZero",
      ratio: "~NaN",
      size: { height: 768, width: 1024 },
    });
    expect(windowLike.construction.instanceNonSerializableKeys).toEqual(["internalToken"]);
  }, 60_000);

  test("records enums, constants and symbol registries as informational", async () => {
    const collected = await collectFixture(FIXTURE_PATH, "fixture-6.json");
    const exports = collected.exports;

    expect(exports.FAKE_PHASE_ENUM).toMatchObject({
      category: "enum",
      values: { 0: "none", 1: "capturing", none: 0, capturing: 1 },
    });
    expect(exports.FAKE_RULES).toMatchObject({
      category: "constant-object",
      frozen: true,
      values: { IMPORT_RULE: 3, STYLE_RULE: 1 },
    });
    expect(exports.FakeSymbolRegistry).toMatchObject({
      category: "symbol-object",
      symbolValues: ["Symbol(fake.element)", "Symbol(fake.node)"],
    });
    expect(exports.FakeNode.staticSymbols).toMatchObject({
      "Symbol(fake.node.tag)": { kind: "data", valueType: "string" },
    });
  }, 60_000);
});

describe("committed snapshot", () => {
  test("meta carries generator version, baseline reference and no timestamps", () => {
    expect(SNAPSHOT.meta.schemaVersion).toBe("1.0.0");
    expect(SNAPSHOT.meta.generator).toMatchObject({ name: PACKAGE.name, version: PACKAGE.version });
    expect(SNAPSHOT.meta.baseline.happyDom).toEqual({
      npmVersion: BASELINE.happyDom.npmVersion,
      gitCommit: BASELINE.happyDom.gitCommit,
      tag: BASELINE.happyDom.tag,
    });
    expect(SNAPSHOT.meta.baseline.bun).toEqual({ version: BASELINE.bun.version });
    expect(Object.keys(SNAPSHOT.meta).sort()).toEqual(["baseline", "generator", "schemaVersion", "target"]);
    expect(JSON.stringify(SNAPSHOT.meta)).not.toMatch(/generatedAt|timestamp|Date/i);
  });

  test("matches the pinned baseline scale (200 exports / 192 classes)", () => {
    const entries = Object.values(SNAPSHOT.exports);
    expect(entries.length).toBe(200);
    expect(entries.filter((entry) => entry.category === "class").length).toBe(192);
  });

  test("regenerates identically from the locked happy-dom entry", async () => {
    const outPath = join(TMP_DIR, "regenerated.json");
    const run = await runProcess(process.execPath, [GENERATOR, "--out", outPath]);
    expect(run.code, `generator failed: ${run.stderr}`).toBe(0);

    const regenerated = JSON.parse(readFileSync(outPath, "utf8"));
    const result = compareSnapshots(SNAPSHOT, regenerated);
    if (!result.ok) {
      const first = result.hard[0] ?? result.differences[0];
      throw new Error(
        `regenerated snapshot differs at ${first.path} (${first.category}): expected ${first.expected}, actual ${first.actual}`,
      );
    }
    expect(result.differences).toEqual([]);
  }, 180_000);
});

describe("comparator sensitivity (modified fixture)", () => {
  let baselineExports;
  let result;

  test("collects both fixture variants", async () => {
    const baselineCollected = await collectFixture(FIXTURE_PATH, "sensitivity-base.json");
    const modifiedCollected = await collectFixture(FIXTURE_MODIFIED_PATH, "sensitivity-modified.json");
    // Only the API surface is compared; the collector's target.specifier
    // legitimately differs between two different fixture modules.
    baselineExports = baselineCollected.exports;
    result = compareSnapshots(baselineExports, modifiedCollected.exports);
    expect(result.ok).toBe(false);
  }, 60_000);

  test("reports the added export as extra", () => {
    const extra = result.differences.filter((difference) => difference.category === CATEGORY.EXTRA);
    expect(extra.map((difference) => difference.path)).toContain("$.FakeComment");
  });

  test("reports the removed prototype member as missing", () => {
    const missing = result.differences.filter((difference) => difference.category === CATEGORY.MISSING);
    const paths = missing.map((difference) => difference.path);
    expect(paths).toContain("$.FakeElement.prototypeDescriptors.querySelector");
  });

  test("reports the accessor-to-method change as shape-mismatch", () => {
    const shape = result.differences.filter((difference) => difference.category === CATEGORY.SHAPE_MISMATCH);
    const paths = shape.map((difference) => difference.path);
    expect(paths).toContain("$.FakeNode.prototypeDescriptors.nodeName.kind");
  });

  test("reports changed enum and instance defaults as value-mismatch", () => {
    const value = result.differences.filter((difference) => difference.category === CATEGORY.VALUE_MISMATCH);
    const paths = value.map((difference) => difference.path);
    expect(paths).toContain("$.FAKE_PHASE_ENUM.values.capturing");
    expect(paths).toContain("$.FakeNode.construction.instanceDefaults.label");
  });

  test("treats symbol-only differences as informational, not hard failures", () => {
    const symbolTampered = structuredClone(baselineExports);
    symbolTampered.FakeSymbolRegistry.symbolValues.push("Symbol(fake.added)");
    const informationalResult = compareSnapshots(baselineExports, symbolTampered);
    expect(informationalResult.ok).toBe(true);
    expect(informationalResult.informational.length).toBeGreaterThan(0);

    const strictResult = compareSnapshots(baselineExports, symbolTampered, { strict: true });
    expect(strictResult.ok).toBe(false);
  });
});

describe("comparator CLI on tampered snapshots", () => {
  test("fails with exit 1 and the first difference path", async () => {
    const tampered = structuredClone(SNAPSHOT);
    tampered.exports.FakeComment = { category: "class", typeOf: "function", enumerable: true };
    const tamperedPath = join(TMP_DIR, "tampered-extra.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));

    const run = await runProcess(process.execPath, [COMPARATOR_CLI, SNAPSHOT_PATH, tamperedPath]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("first difference at $.exports.FakeComment");
    expect(run.stderr).toContain("extra $.exports.FakeComment");
  }, 60_000);

  test("reports a deleted export as missing", async () => {
    const tampered = structuredClone(SNAPSHOT);
    delete tampered.exports.Node;
    const tamperedPath = join(TMP_DIR, "tampered-missing.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));

    const run = await runProcess(process.execPath, [COMPARATOR_CLI, SNAPSHOT_PATH, tamperedPath]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("first difference at $.exports.Node");
    expect(run.stderr).toContain("missing $.exports.Node");
  }, 60_000);

  test("passes with exit 0 for informational-only differences", async () => {
    const tampered = structuredClone(SNAPSHOT);
    tampered.exports.PropertySymbol.symbolValues.push("Symbol(fake.informational)");
    const tamperedPath = join(TMP_DIR, "tampered-informational.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));

    const run = await runProcess(process.execPath, [COMPARATOR_CLI, SNAPSHOT_PATH, tamperedPath]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("informational-only differences: 1");
  }, 60_000);
});
