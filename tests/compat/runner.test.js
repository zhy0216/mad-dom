// Tests for the black-box differential runner (T10 / ADR-0002 sections 5-6).
//
// Covered here:
//   - self-test gate: the agreeing self-test scenarios produce byte-equal
//     normalized records on both mock targets (raw value classes, event
//     order, identity matrix, descriptor shapes, DOM snapshot);
//   - subprocess isolation: pollution written by one scenario is invisible to
//     a later scenario and the runner report proves distinct probe pids;
//   - deliberately divergent self-test scenarios (selftest/divergent/, run
//     explicitly): the comparator fires with exit 1 and localizes every
//     seeded divergence at an exact path — including in --report mode, where
//     mock-pair differences stay fatal;
//   - tamper sensitivity on /tmp scenario copies: a one-sided tampered pass
//     scenario flips to exit 1 with the exact paths, and a scenario that
//     crashes on both sides surfaces as an infrastructure error (exit 2),
//     never a silent pass;
//   - real targets: report mode (`--report`) exits 0 while the genuine
//     happy-dom vs mad-dom gaps (mad-dom's setup-phase createWindow throw)
//     stay fully visible with name/message/phase verbatim; strict mode fails
//     on the same scenario.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const COMPAT_DIR = import.meta.dir;
const RUNNER = join(COMPAT_DIR, "runner", "run.js");
const REPO_ROOT = resolve(COMPAT_DIR, "..", "..");
const DIVERGENT_DIR = join(COMPAT_DIR, "scenarios", "selftest", "divergent");
const DOM_DIR = join(COMPAT_DIR, "scenarios", "dom");
const RECORD_SCHEMA = "mad-dom-diff-record/1";
const MAD_DOM_SETUP_ERROR = {
  name: "Error",
  message: "mad-dom is in pre-alpha development and does not implement Window yet.",
  phase: "setup",
};

function runRunner(args, timeoutMs = 180_000) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function differencesByPath(differences) {
  return Object.fromEntries(differences.map((difference) => [difference.path, difference]));
}

describe("differential runner self-test gate (mock targets)", () => {
  let run;
  let report;

  beforeAll(() => {
    run = runRunner(["--selftest", "--json"]);
    report = JSON.parse(run.stdout);
  });

  test("self-test gate exits 0 with every scenario equal on both mock targets", () => {
    if (run.status !== 0) {
      throw new Error(`self-test runner exited ${run.status}\n${run.stderr}`);
    }
    expect(report.schema).toBe("mad-dom-diff-report/1");
    expect(report.mode).toBe("strict");
    expect(report.exitCode).toBe(0);
    expect(report.scenarios.map((scenario) => scenario.id).sort()).toEqual([
      "selftest-identity-descriptors",
      "selftest-isolation-read",
      "selftest-isolation-write",
      "selftest-primitives-events",
    ]);
    for (const scenario of report.scenarios) {
      expect(scenario.status).toBe("pass");
      expect(scenario.reportOnly).toBe(false);
      expect(scenario.differences).toEqual([]);
      expect(scenario.targets).toEqual(["mock-pass", "mock-fail"]);
    }
  });

  test("raw values, event order and details normalize identically on both sides", () => {
    const primitives = report.scenarios.find((scenario) => scenario.id === "selftest-primitives-events");
    const left = primitives.sides["mock-pass"].record;
    const right = primitives.sides["mock-fail"].record;
    expect(left.schema).toBe(RECORD_SCHEMA);
    expect(left).toEqual(right);

    expect(left.values.nan).toEqual({ type: "number", value: "~NaN" });
    expect(left.values.infinity).toEqual({ type: "number", value: "~Infinity" });
    expect(left.values["negative-infinity"]).toEqual({ type: "number", value: "~NegativeInfinity" });
    expect(left.values["negative-zero"]).toEqual({ type: "number", value: "~NegativeZero" });
    expect(left.values.integer).toEqual({ type: "number", value: 42 });
    expect(left.values.string).toEqual({ type: "string", value: "mad-dom" });
    expect(left.values["undefined-value"]).toEqual({ type: "undefined" });
    expect(left.values["null-value"]).toEqual({ type: "null" });
    expect(left.values.symbol).toEqual({ type: "symbol", description: "mock-token" });
    expect(left.values.bigint).toEqual({ type: "bigint", value: "9007199254740993" });
    expect(left.values.function).toEqual({ type: "function", name: "sample", length: 2 });
    expect(left.values.array).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "string", value: "two" },
        { type: "object", entries: { three: { type: "number", value: 3 } } },
      ],
    });
    expect(Object.keys(left.values.object.entries)).toEqual(["a", "b", "nested"]);

    expect(left.events.map((event) => event.name)).toEqual(["init", "mount", "ready"]);
    expect(left.events[1].detail).toEqual({ type: "object", entries: { step: { type: "number", value: 2 } } });
  });

  test("descriptor shapes and the identity matrix render as documented", () => {
    const scenario = report.scenarios.find((item) => item.id === "selftest-identity-descriptors");
    const record = scenario.sides["mock-pass"].record;

    expect(record.descriptors["element-node-name"]).toEqual({
      present: true,
      writable: true,
      enumerable: true,
      configurable: true,
      hasGet: false,
      hasSet: false,
    });
    expect(record.descriptors["element-tag-lower-accessor"]).toEqual({
      present: true,
      writable: null,
      enumerable: true,
      configurable: true,
      hasGet: true,
      hasSet: false,
    });
    expect(record.descriptors["element-child-nodes"].present).toBe(true);
    expect(record.descriptors["element-missing-property"]).toEqual({ present: false });

    expect(record.identity).toEqual({
      "distinct-elements": false,
      "element-is-itself": true,
      "element-is-not-text": false,
      "first-child-is-text": true,
    });

    expect(record.snapshots.tree.nodeType).toBe(1);
    expect(record.snapshots.tree.nodeName).toBe("SECTION");
    expect(record.snapshots.tree.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(record.snapshots.tree.children[0]).toMatchObject({
      nodeType: 3,
      nodeName: "#text",
      data: "42",
      children: [],
    });
    expect(record.snapshots.tree.outerHTML).toBe("<section>42</section>");
  });

  test("globalThis pollution cannot cross probe processes (distinct pids, clean reader)", () => {
    const write = report.scenarios.find((scenario) => scenario.id === "selftest-isolation-write");
    const read = report.scenarios.find((scenario) => scenario.id === "selftest-isolation-read");
    for (const target of ["mock-pass", "mock-fail"]) {
      expect(Number.isInteger(write.sides[target].pid)).toBe(true);
      expect(Number.isInteger(read.sides[target].pid)).toBe(true);
      expect(write.sides[target].pid).not.toBe(read.sides[target].pid);
    }
    expect(write.sides["mock-pass"].record.values["pollution-set"]).toEqual({ type: "boolean", value: true });
    expect(read.sides["mock-pass"].record.values["pollution-detected"]).toEqual({ type: "null" });
    expect(read.sides["mock-fail"].record.values["pollution-detected"]).toEqual({ type: "null" });
  });
});

describe("deliberately divergent self-test scenarios", () => {
  let run;
  let report;

  beforeAll(() => {
    run = runRunner([join(DIVERGENT_DIR, "error-shape.js"), join(DIVERGENT_DIR, "dom-snapshot-events.js"), "--json"]);
    report = JSON.parse(run.stdout);
  });

  test("error name, stable message and throw phase are separately comparable", () => {
    expect(run.status).toBe(1);
    expect(report.exitCode).toBe(1);
    const scenario = report.scenarios.find((item) => item.id === "selftest-error-shape");
    expect(scenario.status).toBe("differences-fatal");
    expect(scenario.differences.map((difference) => difference.path)).toEqual([
      "errors[0].phase",
      "errors[1].message",
      "errors[1].name",
      "values.sync-mode.value",
    ]);
    const byPath = differencesByPath(scenario.differences);
    expect(byPath["errors[0].phase"]).toMatchObject({ kind: "changed", left: "sync-throw", right: "promise-rejection" });
    expect(byPath["errors[1].name"]).toMatchObject({ kind: "changed", left: "Error", right: "MockFailureError" });
    expect(byPath["errors[1].message"].left).toBe("mock failure (async): controlled divergence");
    expect(byPath["errors[1].message"].right).toBe("mock failure (async): divergent payload");
  });

  test("DOM snapshot and event-order divergences are localized at exact paths", () => {
    const scenario = report.scenarios.find((item) => item.id === "selftest-dom-snapshot-events");
    expect(scenario.status).toBe("differences-fatal");
    expect(scenario.differences.map((difference) => difference.path)).toEqual([
      "events[1].name",
      "events[2].name",
      "snapshots.tree.attributes.id",
      "snapshots.tree.children[0].data",
      "snapshots.tree.outerHTML",
    ]);
    const byPath = differencesByPath(scenario.differences);
    expect(byPath["events[1].name"]).toMatchObject({ kind: "changed", left: "build", right: "finish" });
    expect(byPath["events[2].name"]).toMatchObject({ kind: "changed", left: "finish", right: "build" });
    expect(byPath["snapshots.tree.attributes.id"]).toMatchObject({ kind: "left-only", left: "root" });
    expect(byPath["snapshots.tree.children[0].data"]).toMatchObject({
      kind: "changed",
      left: "hello",
      right: "HELLO",
    });
    expect(byPath["snapshots.tree.outerHTML"]).toMatchObject({
      kind: "changed",
      left: '<div class="box" id="root">hello</div>',
      right: '<div class="box">HELLO</div>',
    });
  });

  test("mock-pair differences stay fatal even in --report mode", () => {
    const reportRun = runRunner([join(DIVERGENT_DIR, "error-shape.js"), "--report", "--json"]);
    expect(reportRun.status).toBe(1);
    const reportModeReport = JSON.parse(reportRun.stdout);
    expect(reportModeReport.mode).toBe("report");
    expect(reportModeReport.scenarios[0].reportOnly).toBe(false);
    expect(reportModeReport.scenarios[0].status).toBe("differences-fatal");
  });
});

describe("tamper sensitivity on temporary scenario copies", () => {
  const tamperDir = mkdtempSync(join(tmpdir(), "mad-dom-differential-tamper-"));

  afterAll(() => {
    rmSync(tamperDir, { recursive: true, force: true });
  });

  test("one-sided tampering of a pass scenario flips the run to exit 1 with exact paths", () => {
    const tamperedPath = join(tamperDir, "tampered-values.js");
    writeFileSync(
      tamperedPath,
      [
        `export const id = "tampered-primitives";`,
        `export const description = "tampered copy of a pass scenario: the mock-fail side observes different values";`,
        `export const targets = "mock";`,
        `export async function run(api) {`,
        `  api.record.value("probe", api.target === "mock-fail" ? "diverged" : "stable");`,
        `  api.dom.emitSequence((name, detail) =>`,
        `    api.record.event(api.target === "mock-fail" ? \`\${name}-diverged\` : name, detail));`,
        `}`,
        ``,
      ].join("\n"),
    );

    const run = runRunner([tamperedPath, "--json"]);
    expect(run.status).toBe(1);
    const report = JSON.parse(run.stdout);
    const scenario = report.scenarios[0];
    expect(scenario.id).toBe("tampered-primitives");
    expect(scenario.status).toBe("differences-fatal");
    expect(scenario.differences.map((difference) => difference.path)).toEqual([
      "events[0].name",
      "events[1].name",
      "events[2].name",
      "values.probe.value",
    ]);
    const byPath = differencesByPath(scenario.differences);
    expect(byPath["values.probe.value"]).toMatchObject({
      kind: "changed",
      left: "stable",
      right: "diverged",
    });
  });

  test("a scenario crashing on both sides is an infrastructure error (exit 2), never a silent pass", () => {
    const crasherPath = join(tamperDir, "tampered-crash.js");
    writeFileSync(
      crasherPath,
      [
        `export const id = "tampered-crash";`,
        `export const description = "tampered scenario that crashes on both sides; must surface as an infrastructure error";`,
        `export const targets = "mock";`,
        `export async function run() {`,
        `  throw new Error("tampered crash on purpose");`,
        `}`,
        ``,
      ].join("\n"),
    );

    const run = runRunner([crasherPath, "--json"]);
    expect(run.status).toBe(2);
    const report = JSON.parse(run.stdout);
    expect(report.exitCode).toBe(2);
    expect(report.totals.infraErrors).toBe(1);
    const scenario = report.scenarios[0];
    expect(scenario.status).toBe("infra-error");
    for (const target of ["mock-pass", "mock-fail"]) {
      expect(scenario.sides[target].infraError).toMatchObject({ name: "Error", message: "tampered crash on purpose" });
      expect(scenario.sides[target].record).toBeNull();
    }
  });
});

describe("real differential (happy-dom vs mad-dom)", () => {
  let run;
  let report;

  beforeAll(() => {
    run = runRunner(["--report", "--json"]);
    report = JSON.parse(run.stdout);
  });

  test("report mode exits 0: self-test gate clean, real gaps reported non-fatally", () => {
    if (run.status !== 0) {
      throw new Error(`report runner exited ${run.status}\n${run.stderr}`);
    }
    expect(report.mode).toBe("report");
    expect(report.exitCode).toBe(0);
    expect(report.totals.infraErrors).toBe(0);
    expect(report.totals.differencesFatal).toBe(0);
    for (const scenario of report.scenarios.filter((item) => item.id.startsWith("selftest-"))) {
      expect(scenario.status).toBe("pass");
    }
    for (const id of ["dom-create-append-serialize", "dom-query-selector-identity"]) {
      const scenario = report.scenarios.find((item) => item.id === id);
      expect(scenario.status).toBe("differences-report");
      expect(scenario.reportOnly).toBe(true);
      expect(scenario.targets).toEqual(["happy-dom", "mad-dom"]);
      for (const target of ["happy-dom", "mad-dom"]) {
        expect(Number.isInteger(scenario.sides[target].pid)).toBe(true);
        expect(scenario.sides[target].infraError).toBeNull();
      }
    }
  });

  test("mad-dom's setup-phase createWindow throw is reported verbatim", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-create-append-serialize");
    const byPath = differencesByPath(scenario.differences);

    expect(byPath["errors[0]"]).toMatchObject({ kind: "right-only", right: MAD_DOM_SETUP_ERROR });

    const madRecord = scenario.sides["mad-dom"].record;
    expect(madRecord.errors).toEqual([MAD_DOM_SETUP_ERROR]);
    expect(madRecord.snapshots).toEqual({});
    expect(madRecord.events).toEqual([]);
    expect(madRecord.values["entry-create-window-type"]).toEqual({ type: "string", value: "function" });
    expect(madRecord.values["entry-window-type"]).toEqual({ type: "string", value: "undefined" });

    expect(byPath["values.entry-window-type.value"]).toEqual({
      path: "values.entry-window-type.value",
      kind: "changed",
      left: "function",
      right: "undefined",
    });
    expect(byPath["snapshots.body"].kind).toBe("left-only");
    expect(byPath["snapshots.body"].left.nodeType).toBe(1);
    expect(byPath["snapshots.body"].left.nodeName).toBe("BODY");
    expect(byPath["identity.query-finds-appended-section"]).toMatchObject({ kind: "left-only", left: true });

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.values["body-child-count"]).toEqual({ type: "number", value: 1 });
  });

  test("query/identity real scenario reports its gaps too", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-query-selector-identity");
    expect(scenario.status).toBe("differences-report");
    const paths = scenario.differences.map((difference) => difference.path);
    expect(paths).toContain("errors[0]");
    expect(paths).toContain("identity.requery-returns-same-element");
    expect(paths).toContain("snapshots.list");
    expect(paths).toContain("values.item-count");

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.values["item-count"]).toEqual({ type: "number", value: 2 });
    expect(happyRecord.identity["requery-returns-same-element"]).toBe(true);
    expect(happyRecord.events.map((event) => event.name)).toEqual(["click", "click"]);
    expect(happyRecord.events[0].detail.entries.target).toEqual({ type: "string", value: "li.item:first" });
    expect(happyRecord.events[1].detail.entries.target).toEqual({ type: "string", value: "body" });
  });

  test("strict mode fails on the same real scenario (exit 1)", () => {
    const strictRun = runRunner([join(DOM_DIR, "create-append-serialize.js"), "--json"]);
    expect(strictRun.status).toBe(1);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.exitCode).toBe(1);
    expect(strictReport.scenarios[0].id).toBe("dom-create-append-serialize");
    expect(strictReport.scenarios[0].status).toBe("differences-fatal");
    expect(strictReport.scenarios[0].reportOnly).toBe(false);
  });
});
