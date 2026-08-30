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
import { isNativeAvailable } from "../../index.js";

const COMPAT_DIR = import.meta.dir;
const RUNNER = join(COMPAT_DIR, "runner", "run.js");
const REPO_ROOT = resolve(COMPAT_DIR, "..", "..");
const DIVERGENT_DIR = join(COMPAT_DIR, "scenarios", "selftest", "divergent");
const DOM_DIR = join(COMPAT_DIR, "scenarios", "dom");
const RECORD_SCHEMA = "mad-dom-diff-record/1";

// The real differential runs against the built mad-dom entry. Since T22,
// createWindow() no longer throws a setup placeholder; with the dev artifact
// the window is acquired and the (still missing) node surface fails during
// the scenario body, so the recorded gap shape depends on the artifact.
const nativeAvailable = isNativeAvailable();

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
    for (const id of [
      "dom-create-append-serialize",
      "dom-node-navigation",
      "dom-query-selector-identity",
    ]) {
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

  test("mad-dom's window facade gap is reported verbatim", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-create-append-serialize");
    const byPath = differencesByPath(scenario.differences);

    const madRecord = scenario.sides["mad-dom"].record;
    // Since T22, createWindow() is exported and no longer a setup placeholder.
    expect(madRecord.values["entry-create-window-type"]).toEqual({ type: "string", value: "function" });
    expect(madRecord.values["entry-window-type"]).toEqual({ type: "string", value: "function" });
    expect(byPath["values.entry-create-window-type.value"]).toEqual({
      path: "values.entry-create-window-type.value",
      kind: "changed",
      left: "undefined",
      right: "function",
    });
    expect(byPath["values.entry-window-type"]).toBeUndefined();

    // The gap moved from the setup phase to the surface: with the dev artifact
    // the window is acquired, createElement (T23), tree mutation (T24), the
    // attribute/textContent surface (T25), document.body with the implied
    // skeleton (T29) and — since T31 — the selector query all succeed, so the
    // scenario body completes with no recorded error; without one, loading the
    // native binding fails lazily at createWindow().
    if (nativeAvailable) {
      expect(madRecord.errors).toEqual([]);
    } else {
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].name).toBe("Error");
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
    }
    expect(byPath["errors[0]"]).toBeUndefined();

    expect(madRecord.values["document-ready-state"]).toEqual({ type: "undefined" });
    expect(byPath["values.document-ready-state.value"]).toMatchObject({
      kind: "left-only",
      left: "interactive",
    });

    // Since T29 the mad-dom side captures the body snapshot too. Its tree
    // structure, outerHTML, attributes and namespaceURI match happy-dom byte
    // for byte (since T34), so the only snapshot-leaf differences that remain
    // are the nodeName casing (T23A).
    const madBody = madRecord.snapshots["body"];
    expect(madBody).toBeDefined();
    expect(madBody.nodeType).toBe(1);
    expect(madBody.nodeName).toBe("body");
    expect(madBody.outerHTML).toBe(
      '<body><section class="diff-probe" id="probe">differential body</section></body>',
    );
    expect(byPath["snapshots.body.nodeName"]).toMatchObject({
      kind: "changed",
      left: "BODY",
      right: "body",
    });
    expect(madRecord.events).toEqual([]);

    // Since T31 the query that finds the appended section succeeds on both
    // sides, so the identity relation is no longer a difference.
    expect(madRecord.identity["query-finds-appended-section"]).toBe(true);
    expect(byPath["identity.query-finds-appended-section"]).toBeUndefined();

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.values["body-child-count"]).toEqual({ type: "number", value: 1 });
  });

  test("query/identity real scenario reports its gaps too", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-query-selector-identity");
    expect(scenario.status).toBe("differences-report");
    const paths = scenario.differences.map((difference) => difference.path);
    expect(paths).toContain("snapshots.list.nodeName");
    expect(paths).toContain("values.entry-create-window-type.value");

    // Since T31 the query surface matches: item-count is 2 and re-querying
    // returns the same element on both sides, so those paths are gone, and
    // since T34 the list snapshot's .attributes and namespaceURI match too.
    // Since T39 Element.click() is implemented, so the scenario's click events
    // fire and record identically on both sides (no errors[0] difference
    // anymore). The remaining differences are the snapshot leaf nodeName
    // casing (T23A) and the createWindow export shape.
    expect(paths).not.toContain("errors[0]");
    expect(paths).not.toContain("values.item-count");
    expect(paths).not.toContain("identity.requery-returns-same-element");

    const madRecord = scenario.sides["mad-dom"].record;
    expect(madRecord.values["item-count"]).toEqual({ type: "number", value: 2 });
    expect(madRecord.identity["requery-returns-same-element"]).toBe(true);
    expect(madRecord.errors).toEqual([]);
    expect(madRecord.events.map((event) => event.name)).toEqual(["click", "click"]);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.values["item-count"]).toEqual({ type: "number", value: 2 });
    expect(happyRecord.identity["requery-returns-same-element"]).toBe(true);
    expect(happyRecord.events.map((event) => event.name)).toEqual(["click", "click"]);
    expect(happyRecord.events[0].detail.entries.target).toEqual({ type: "string", value: "li.item:first" });
    expect(happyRecord.events[1].detail.entries.target).toEqual({ type: "string", value: "body" });
  });

  test("events real scenario passes exactly (order, options, cancellation, reentrancy)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-events");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T37 slice matches happy-dom observation for observation, so
    // the scenario is a genuine pass (ledgered hc-diff-events).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["struct-order-return"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["prevent-default-return"]).toEqual({ type: "boolean", value: false });
    expect(madRecord.values["prevent-default-flag"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["passive-return"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["after-phase"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.identity["after-target-is-leaf"]).toBe(true);
    // The ordered capture/target/bubble structs.
    const roles = madRecord.events.map((event) => event.detail?.entries?.role?.value);
    expect(roles.slice(0, 8)).toEqual([
      "doc-capture",
      "body-capture",
      "mid-capture",
      "leaf-capture",
      "leaf-target",
      "mid-bubble",
      "body-bubble",
      "doc-bubble",
    ]);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.events.length).toBe(madRecord.events.length);
    expect(happyRecord.values["struct-order-return"]).toEqual(madRecord.values["struct-order-return"]);
  });

  test("platform location/history real scenario passes exactly (URL, Location, History, Navigator)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-platform-location-history");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T45 location/history/navigator slice matches happy-dom
    // observation for observation (ledgered hc-diff-window-platform).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    // The four recorded errors are the deliberately probed exceptions
    // (cross-origin pushState SecurityError, arg-count TypeErrors, invalid URL)
    // and match happy-dom name for name and message for message.
    expect(madRecord.errors.map((error) => error.name)).toEqual([
      "SecurityError",
      "TypeError",
      "TypeError",
      "TypeError",
    ]);
    expect(madRecord.errors[0].message).toBe(
      "Failed to execute 'pushState' on 'History': A history state object with URL 'https://evil.example.com/x' cannot be created in a document with origin 'null' and URL 'about:blank'.",
    );
    expect(madRecord.errors[3].message).toBe("Invalid URL");

    expect(madRecord.values["loc-href"]).toEqual({ type: "string", value: "about:blank" });
    expect(madRecord.values["loc-origin"]).toEqual({ type: "string", value: "null" });
    expect(madRecord.values["loc-pathname"]).toEqual({ type: "string", value: "blank" });
    expect(madRecord.values["loc-proto-name"]).toEqual({ type: "string", value: "Location" });
    expect(madRecord.values["doc-url-eq-loc"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["hash-set-length-delta"]).toEqual({ type: "number", value: 1 });
    expect(madRecord.values["push-relative-state"]).toEqual({
      type: "object",
      entries: { a: { type: "number", value: 1 } },
    });
    expect(madRecord.values["replace-length-delta"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.values["hist-scroll-restoration"]).toEqual({ type: "string", value: "auto" });
    expect(madRecord.values["nav-platform"]).toEqual({ type: "string", value: "X11; Darwin arm64" });
    expect(madRecord.values["nav-languages"]).toEqual({
      type: "array",
      items: [
        { type: "string", value: "en-US" },
        { type: "string", value: "en" },
      ],
    });
    expect(madRecord.identity["loc-identity"]).toBe(true);
    expect(madRecord.identity["ls-ss-distinct"]).toBe(false);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors.map((error) => error.name)).toEqual(
      madRecord.errors.map((error) => error.name),
    );
    expect(happyRecord.values["loc-href"]).toEqual(madRecord.values["loc-href"]);
  });

  test("storage/cookie real scenario passes exactly (isolation, ordering, string conversion, cookies)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-storage-cookie");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T45 storage + cookie slice matches happy-dom observation for
    // observation (ledgered hc-diff-storage-cookie).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["ls-coerced"]).toEqual({
      type: "array",
      items: [
        { type: "string", value: "1" },
        { type: "string", value: "null" },
        { type: "string", value: "undefined" },
        { type: "string", value: "[object Object]" },
        { type: "string", value: "true" },
      ],
    });
    expect(madRecord.values["ls-keys-order"]).toEqual({
      type: "array",
      items: [
        { type: "string", value: "2" },
        { type: "string", value: "10" },
        { type: "string", value: "a" },
      ],
    });
    expect(madRecord.descriptors["ls-prop-f-desc"]).toMatchObject({
      present: true,
      writable: true,
      enumerable: true,
      configurable: true,
      hasGet: false,
      hasSet: false,
    });
    expect(madRecord.values["ls-isolation"]).toEqual({ type: "string", value: "ls" });
    expect(madRecord.values["ss-isolation"]).toEqual({ type: "string", value: "ss" });
    expect(madRecord.values["win2-ls-get"]).toEqual({ type: "null" });

    expect(madRecord.values["cookie-multi"]).toEqual({
      type: "string",
      value: "name=value; a=1; b=2",
    });
    expect(madRecord.values["cookie-httponly-filtered"]).toEqual({
      type: "string",
      value: "a=1; b=2; flag; name=newvalue",
    });
    expect(madRecord.values["cookie-secure-prefix-invalid"]).toEqual({
      type: "string",
      value: "a=1; b=2; flag; name=newvalue; hidden=2",
    });
    expect(madRecord.values["cookie-expired"]).toEqual({
      type: "string",
      value: "a=1; b=2; flag; name=newvalue; hidden=2",
    });
    expect(madRecord.values["cookie-order"]).toEqual({
      type: "string",
      value: "a=1; b=2; flag; name=newvalue; hidden=2; kept=1; nosamesite=1; zz=1; aa=2",
    });

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.values["cookie-order"]).toEqual(madRecord.values["cookie-order"]);
  });

  test("strict mode passes on the platform and storage/cookie scenarios exactly when they match happy-dom", () => {
    for (const scenarioFile of ["dom-platform-location-history.js", "dom-storage-cookie.js"]) {
      const strictRun = runRunner([join(DOM_DIR, scenarioFile), "--json"]);
      const strictReport = JSON.parse(strictRun.stdout);
      expect(strictReport.mode).toBe("strict");
      expect(strictReport.scenarios[0].id).toBe(scenarioFile.replace(".js", ""));
      if (nativeAvailable) {
        expect(strictRun.status).toBe(0);
        expect(strictReport.exitCode).toBe(0);
        expect(strictReport.scenarios[0].status).toBe("pass");
        expect(strictReport.scenarios[0].differences).toEqual([]);
      } else {
        expect(strictRun.status).toBe(1);
        expect(strictReport.scenarios[0].status).toBe("differences-fatal");
        expect(strictReport.totals.infraErrors).toBe(0);
      }
    }
  });

  test("traversal real scenario passes exactly (walk order, filters, mutation)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-traversal");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T35 slice matches happy-dom observation for observation, so
    // the scenario is a genuine pass (ledgered hc-diff-treewalker-nodeiterator).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["node-filter-show-all"]).toEqual({ type: "number", value: -1 });
    expect(madRecord.values["walker-root-is-body"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["walker-what-to-show-raw"]).toEqual({ type: "number", value: 1 });
    expect(madRecord.values["default-what-to-show-raw"]).toEqual({ type: "number", value: -1 });
    expect(madRecord.values["object-filter-this"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["show-text-elements-none"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["iterator-root"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["mutation-current-last"]).toEqual({ type: "boolean", value: true });

    const keysOf = (name) =>
      madRecord.events
        .filter((event) => event.name === name)
        .map((event) => event.detail?.entries?.key?.value);
    expect(keysOf("order")).toEqual(["a", "a1", "b", "b1", "b2"]);
    expect(keysOf("reject")).toEqual(["b", "b1", "b2"]);
    expect(keysOf("skip")).toEqual(["a1", "b", "b1", "b2"]);
    expect(keysOf("object-filter")).toEqual(["a", "a1", "b", "b2"]);
    expect(keysOf("iterator").slice(0, 6)).toEqual(["body", "a", "a1", "b", "b1", "b2"]);
    expect(keysOf("iterator-prev")).toEqual(["b1", "b", "a1", "a", "body"]);
    // Removing span#a1 mid-walk: the walk continues at div#b and never
    // revisits the removed subtree.
    expect(keysOf("mutation")).toEqual(["a", "b", "b1", "b2"]);
    // Reentrancy: the filter removes p#b1 when div#b is reached.
    expect(keysOf("reentrant")).toEqual(["a", "b", "b2"]);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.events.length).toBe(madRecord.events.length);
    expect(happyRecord.values["walker-what-to-show-raw"]).toEqual(
      madRecord.values["walker-what-to-show-raw"],
    );
  });

  test("node navigation real scenario reports exactly the frozen nodeName casing gap", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-node-navigation");
    expect(scenario.status).toBe("differences-report");

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].name).toBe("Error");
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T23 slice matches happy-dom except one value: Element.nodeName
    // casing (MAD DOM freezes the lowercased tag, happy-dom uppercases it).
    expect(scenario.differences).toHaveLength(1);
    expect(scenario.differences[0]).toMatchObject({
      path: "values.element-node-name.value",
      kind: "changed",
      left: "DIV",
      right: "div",
    });

    expect(madRecord.errors).toEqual([]);
    expect(madRecord.values["element-node-type"]).toEqual({ type: "number", value: 1 });
    expect(madRecord.values["element-node-name"]).toEqual({ type: "string", value: "div" });
    expect(madRecord.values["text-node-type"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["text-node-name"]).toEqual({ type: "string", value: "#text" });
    for (const suffix of ["parent-node", "first-child", "last-child", "previous-sibling", "next-sibling"]) {
      expect(madRecord.values[`element-${suffix}`]).toEqual({ type: "null" });
      expect(madRecord.values[`text-${suffix}`]).toEqual({ type: "null" });
    }
    expect(madRecord.values["element-child-count"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.values["text-child-count"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.identity["distinct-elements"]).toBe(false);
    expect(madRecord.identity["distinct-texts"]).toBe(false);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.values["element-node-name"]).toEqual({ type: "string", value: "DIV" });
    expect(happyRecord.values["text-node-name"]).toEqual({ type: "string", value: "#text" });
  });

  test("tree mutation real scenario passes exactly (append/insert/remove/replace/fragment)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-mutations");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].name).toBe("Error");
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T24 slice matches happy-dom observation for observation, so
    // the scenario is a genuine pass (ledgered hc-diff-node-mutations).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["after-append-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 3 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["after-insert-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 3 },
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["after-move-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 3 },
        { type: "number", value: 1 },
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["after-remove-count"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["after-replace-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 3 },
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["after-fragment-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 3 },
        { type: "number", value: 1 },
        { type: "number", value: 3 },
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["fragment-empty-after-insert"]).toEqual({ type: "number", value: 0 });

    for (const key of [
      "append-return-first",
      "append-return-text",
      "append-return-last",
      "insert-return-middle",
      "middle-parent-after-insert",
      "move-return-first",
      "moved-first-is-last",
      "remove-return-middle",
      "removed-middle-detached",
      "replace-return-last",
      "replacement-parent",
      "replaced-first-detached",
      "fragment-insert-return",
      "fragment-text-moved",
      "fragment-element-moved",
    ]) {
      expect(madRecord.identity[key], `${key} identity`).toBe(true);
    }

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.identity["append-return-first"]).toBe(true);
    expect(happyRecord.values["after-insert-types"]).toEqual(madRecord.values["after-insert-types"]);
  });

  test("live childNodes real scenario passes exactly (live length, index, identity)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-child-nodelist");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // Since the T25 gate wired `Node.prototype.childNodes` to the T25D live
    // collection, the whole scenario matches happy-dom observation for
    // observation: an existing childNodes object reflects append/insert/move/
    // remove/replace immediately and keeps one and the same NodeList identity
    // per parent. Ledgered hc-diff-child-nodelist.
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["captured-length"]).toEqual({ type: "number", value: 2 });
    expect(madRecord.values["indexed-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 3 },
      ],
    });
    expect(madRecord.values["live-after-append-length"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["live-after-append-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 3 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["live-after-move-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 1 },
        { type: "number", value: 3 },
      ],
    });
    expect(madRecord.values["live-after-remove-count"]).toEqual({ type: "number", value: 2 });
    expect(madRecord.values["live-after-replace-types"]).toEqual({
      type: "array",
      items: [
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
    });
    expect(madRecord.values["empty-list-length"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.identity["child-nodes-is-live-list"]).toBe(true);
  });

  test("attribute real scenario reports exactly the frozen T25 known gaps", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-attributes");
    expect(scenario).toBeDefined();
    expect(scenario.status).toBe("differences-report");

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T25E attribute slice matches happy-dom except the four frozen
    // gaps (ledgered hc-diff-attributes-read-write): the T21A error
    // degradation on DOM-spec violations, the strict WHATWG "Name" validation
    // (digit-led names rejected), the non-Element methods living on
    // Node.prototype, and the descriptor present on the element's direct
    // prototype.
    const paths = scenario.differences.map((difference) => difference.path);
    expect(paths).toContain("descriptors.getAttribute-descriptor.present");
    expect(paths).toContain("descriptors.setAttribute-descriptor.present");
    expect(paths).toContain("errors[0].name");
    expect(paths).toContain("errors[1].name");
    expect(paths).toContain("errors[2]");
    expect(paths).toContain("values.digit-led-name");

    // The value round-trip, WebIDL DOMString shaping and absent-name reads
    // match happy-dom exactly.
    expect(madRecord.values["absent-get"]).toEqual({ type: "null" });
    expect(madRecord.values["absent-has"]).toEqual({ type: "boolean", value: false });
    expect(madRecord.values["get-after-set"]).toEqual({ type: "string", value: "x" });
    expect(madRecord.values["numeric-value"]).toEqual({ type: "string", value: "123" });
    expect(madRecord.values["null-value"]).toEqual({ type: "string", value: "null" });
    expect(madRecord.values["undefined-value"]).toEqual({ type: "string", value: "undefined" });
    expect(madRecord.values["boolean-value"]).toEqual({ type: "string", value: "true" });
    expect(madRecord.values["survivor-value"]).toEqual({ type: "string", value: "2" });
    expect(madRecord.values["empty-value"]).toEqual({ type: "string", value: "" });
  });

  test("textContent real scenario reports exactly the frozen T25 known gaps", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-text-content");
    expect(scenario).toBeDefined();
    expect(scenario.status).toBe("differences-report");

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T25E textContent slice matches happy-dom except the two frozen
    // gaps (ledgered hc-diff-text-content-accessor): the Core NUL rejection
    // (text-data well-formedness) and the accessor descriptor living on the
    // element's direct prototype.
    const paths = scenario.differences.map((difference) => difference.path);
    expect(paths).toContain("descriptors.textContent-descriptor.present");
    expect(paths).toContain("errors[0]");
    expect(paths).toContain("values.nul-stored");

    // Reads, writes, null clearing, coercion and deep-tree concatenation match.
    expect(madRecord.values["empty-get"]).toEqual({ type: "string", value: "" });
    expect(madRecord.values["get-after-set"]).toEqual({ type: "string", value: "hello" });
    expect(madRecord.values["get-after-null"]).toEqual({ type: "string", value: "" });
    expect(madRecord.values["child-count-after-null"]).toEqual({ type: "number", value: 0 });
    expect(madRecord.values["get-after-number"]).toEqual({ type: "string", value: "42" });
    expect(madRecord.values["deep-concat"]).toEqual({ type: "string", value: "123" });
    expect(madRecord.values["text-get"]).toEqual({ type: "string", value: "data" });
    expect(madRecord.values["text-get-after-set"]).toEqual({ type: "string", value: "changed" });
  });

  test("extended-node real scenario passes exactly (CharacterData, splitText, clone family)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-extended-nodes");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // Since T33 the whole extended-node slice matches happy-dom observation for
    // observation, so the scenario is a genuine pass (ledgered
    // hc-diff-extended-nodes). It deliberately avoids the frozen divergences
    // (element/PI nodeName casing, adopt identity, error shape), so a clean
    // run proves the CharacterData / splitText / clone / import / adopt parity.
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    expect(madRecord.values["surface-create-processing-instruction"]).toEqual({
      type: "string",
      value: "function",
    });
    expect(madRecord.values["surface-import-node"]).toEqual({ type: "string", value: "function" });
    expect(madRecord.values["surface-adopt-node"]).toEqual({ type: "string", value: "function" });
    expect(madRecord.values["text-length"]).toEqual({ type: "number", value: 11 });
    expect(madRecord.values["after-replace"]).toEqual({ type: "string", value: "Xo beautiful world!" });
    expect(madRecord.values["pi-node-type"]).toEqual({ type: "number", value: 7 });
    expect(madRecord.values["pi-target"]).toEqual({ type: "string", value: "xml-stylesheet" });
    expect(madRecord.values["split-parent-child-count"]).toEqual({ type: "number", value: 2 });
    expect(madRecord.identity["split-tail-is-second-child"]).toBe(true);
    expect(madRecord.identity["split-head-next-is-tail"]).toBe(true);
    expect(madRecord.identity["deep-clone-child-distinct"]).toBe(false);
    expect(madRecord.identity["deep-clone-text-parent"]).toBe(true);
    expect(madRecord.identity["adopt-same-doc-identity"]).toBe(true);
    expect(madRecord.values["adopt-source-container-child-count"]).toEqual({ type: "number", value: 0 });

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.values["after-replace"]).toEqual({ type: "string", value: "Xo beautiful world!" });
    expect(happyRecord.values["pi-node-type"]).toEqual({ type: "number", value: 7 });
    expect(happyRecord.identity["split-tail-is-second-child"]).toBe(true);
    expect(happyRecord.identity["deep-clone-text-parent"]).toBe(true);
  });

  test("strict mode passes on the extended-node scenario exactly when it matches happy-dom", () => {
    const strictRun = runRunner([join(DOM_DIR, "dom-extended-nodes.js"), "--json"]);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.scenarios[0].id).toBe("dom-extended-nodes");
    if (nativeAvailable) {
      expect(strictRun.status).toBe(0);
      expect(strictReport.exitCode).toBe(0);
      expect(strictReport.scenarios[0].status).toBe("pass");
      expect(strictReport.scenarios[0].differences).toEqual([]);
    } else {
      expect(strictRun.status).toBe(1);
      expect(strictReport.scenarios[0].status).toBe("differences-fatal");
      expect(strictReport.totals.infraErrors).toBe(0);
    }
  });

  test("attribute-node/token real scenario passes exactly (NamedNodeMap/Attr, classList, createAttribute)", () => {
    const scenario = report.scenarios.find((item) => item.id === "dom-attributes-token");
    expect(scenario).toBeDefined();
    expect(scenario.reportOnly).toBe(true);

    const madRecord = scenario.sides["mad-dom"].record;
    if (!nativeAvailable) {
      // Without the dev artifact, loading the native binding fails lazily at
      // createWindow() and the scenario stops at the setup phase.
      expect(madRecord.errors).toHaveLength(1);
      expect(madRecord.errors[0].message).toContain("mad-dom native binding could not be loaded");
      expect(madRecord.errors[0].phase).toBe("setup");
      return;
    }

    // The whole T34 slice matches happy-dom observation for observation, so
    // the scenario is a genuine pass (ledgered hc-diff-attributes-token). It
    // deliberately avoids the frozen deviations (invalid tokens, the
    // empty-token-set attribute removal, Attr.nodeName/nodeValue, the
    // NamedNodeMap own-key leak and the Attr identity replacement).
    expect(scenario.status).toBe("pass");
    expect(scenario.differences).toEqual([]);
    expect(madRecord.errors).toEqual([]);

    // NamedNodeMap reads, Attr fields and the value write-through.
    expect(madRecord.values["attributes-length"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["attributes-item-0-name"]).toEqual({ type: "string", value: "id" });
    expect(madRecord.values["attributes-index-99"]).toEqual({ type: "null" });
    expect(madRecord.values["attributes-getNamedItem-class"]).toEqual({
      type: "string",
      value: "a b c",
    });
    expect(madRecord.values["attributes-named-getter-missing"]).toEqual({ type: "undefined" });
    expect(madRecord.values["attributes-in-id"]).toEqual({ type: "boolean", value: false });
    expect(madRecord.values["attributes-in-0"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["attributes-toStringTag"]).toEqual({
      type: "string",
      value: "[object NamedNodeMap]",
    });
    expect(madRecord.values["attr-node-type"]).toEqual({ type: "number", value: 2 });
    expect(madRecord.values["attr-value-write-through"]).toEqual({ type: "string", value: "newroot" });
    expect(madRecord.values["created-attr-owner"]).toEqual({ type: "null" });
    expect(madRecord.identity["attributes-map-identity"]).toBe(true);
    expect(madRecord.identity["attributes-owner-element"]).toBe(true);

    // The live retained-collection reads and the bidirectional class sync.
    expect(madRecord.values["live-attributes-length"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["live-getNamedItem-class"]).toEqual({ type: "string", value: "x y" });
    expect(madRecord.values["classlist-after-add"]).toEqual({ type: "string", value: "x y z" });
    expect(madRecord.values["classlist-replace"]).toEqual({ type: "boolean", value: true });
    expect(madRecord.values["classlist-replace-missing"]).toEqual({ type: "boolean", value: false });
    expect(madRecord.values["classlist-value-attr"]).toEqual({ type: "string", value: "  p  q   r " });
    expect(madRecord.values["classlist-value-length"]).toEqual({ type: "number", value: 3 });
    expect(madRecord.values["classlist-live-after-remove"]).toEqual({ type: "string", value: "" });
    expect(madRecord.values["classlist-live-contains-outer"]).toEqual({
      type: "boolean",
      value: false,
    });
    expect(madRecord.values["element-namespace-uri"]).toEqual({
      type: "string",
      value: "http://www.w3.org/1999/xhtml",
    });
    expect(madRecord.identity["classlist-identity"]).toBe(true);

    const happyRecord = scenario.sides["happy-dom"].record;
    expect(happyRecord.errors).toEqual([]);
    expect(happyRecord.values["attributes-getNamedItem-class"]).toEqual({
      type: "string",
      value: "a b c",
    });
    expect(happyRecord.values["classlist-after-add"]).toEqual({ type: "string", value: "x y z" });
    expect(happyRecord.identity["classlist-identity"]).toBe(true);
  });

  test("strict mode passes on the attribute-node/token scenario exactly when it matches happy-dom", () => {
    const strictRun = runRunner([join(DOM_DIR, "dom-attributes-token.js"), "--json"]);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.scenarios[0].id).toBe("dom-attributes-token");
    if (nativeAvailable) {
      expect(strictRun.status).toBe(0);
      expect(strictReport.exitCode).toBe(0);
      expect(strictReport.scenarios[0].status).toBe("pass");
      expect(strictReport.scenarios[0].differences).toEqual([]);
    } else {
      expect(strictRun.status).toBe(1);
      expect(strictReport.scenarios[0].status).toBe("differences-fatal");
      expect(strictReport.totals.infraErrors).toBe(0);
    }
  });

  test("strict mode passes on the traversal scenario exactly when it matches happy-dom", () => {
    const strictRun = runRunner([join(DOM_DIR, "dom-traversal.js"), "--json"]);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.scenarios[0].id).toBe("dom-traversal");
    if (nativeAvailable) {
      expect(strictRun.status).toBe(0);
      expect(strictReport.exitCode).toBe(0);
      expect(strictReport.scenarios[0].status).toBe("pass");
      expect(strictReport.scenarios[0].differences).toEqual([]);
    } else {
      expect(strictRun.status).toBe(1);
      expect(strictReport.scenarios[0].status).toBe("differences-fatal");
      expect(strictReport.totals.infraErrors).toBe(0);
    }
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

  test("strict mode passes on the tree-mutation scenario exactly when it matches happy-dom", () => {
    const strictRun = runRunner([join(DOM_DIR, "dom-mutations.js"), "--json"]);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.scenarios[0].id).toBe("dom-mutations");
    if (nativeAvailable) {
      // With the dev artifact the whole T24 slice matches happy-dom, so the
      // strict run must exit 0 with zero differences.
      expect(strictRun.status).toBe(0);
      expect(strictReport.exitCode).toBe(0);
      expect(strictReport.scenarios[0].status).toBe("pass");
      expect(strictReport.scenarios[0].differences).toEqual([]);
    } else {
      // Without the artifact the mad-dom side stops at setup, which is a real
      // difference, not an infrastructure error.
      expect(strictRun.status).toBe(1);
      expect(strictReport.scenarios[0].status).toBe("differences-fatal");
      expect(strictReport.totals.infraErrors).toBe(0);
    }
  });

  test("strict mode passes on the live childNodes scenario exactly when it matches happy-dom", () => {
    const strictRun = runRunner([join(DOM_DIR, "dom-child-nodelist.js"), "--json"]);
    const strictReport = JSON.parse(strictRun.stdout);
    expect(strictReport.mode).toBe("strict");
    expect(strictReport.scenarios[0].id).toBe("dom-child-nodelist");
    if (nativeAvailable) {
      // With the dev artifact the whole T25D live childNodes slice matches
      // happy-dom, so the strict run must exit 0 with zero differences.
      expect(strictRun.status).toBe(0);
      expect(strictReport.exitCode).toBe(0);
      expect(strictReport.scenarios[0].status).toBe("pass");
      expect(strictReport.scenarios[0].differences).toEqual([]);
    } else {
      expect(strictRun.status).toBe(1);
      expect(strictReport.scenarios[0].status).toBe("differences-fatal");
      expect(strictReport.totals.infraErrors).toBe(0);
    }
  });
});
