import { describe, expect, test } from "bun:test";
import { printSizeTable, resultMatch, testingPhaseMatches } from "./run.mjs";
import { summarize, summarizeOperations } from "./stats.mjs";

describe("benchmark timing summaries", () => {
  test("operation total preserves round pairing instead of adding medians", () => {
    const a = summarize([1, 1, 100]);
    const b = summarize([100, 1, 1]);
    const total = summarizeOperations({ a, b });
    expect(total.samples).toEqual([101, 2, 101]);
    expect(total.medianMs).toBe(101);
    expect(a.medianMs + b.medianMs).toBe(2);
  });

  test("rejects empty, invalid or unpaired samples", () => {
    for (const samples of [[], [NaN], [Infinity], [-1]]) {
      expect(() => summarize(samples)).toThrow(RangeError);
    }
    expect(() => summarizeOperations({})).toThrow(RangeError);
    expect(() => summarizeOperations({ a: summarize([1]), b: summarize([1, 2]) })).toThrow(RangeError);
  });
});

function coreResult() {
  const names = ["parse", "buildMixed", "queryHot", "queryCold", "getById", "getByTag",
    "serialize", "traverseWarm", "traverseCold", "buildCreate", "buildAttr", "buildAppend",
    "buildText", "buildBulk", "readHeavy", "mutationChurn"];
  return {
    host: { bun: "test", os: "test", arch: "test" },
    workload: { runs: 1, sections: 1, elementCount: 10, htmlBytes: 100, builtElements: 10, builtTextNodes: 2 },
    checks: { roundsIdentical: true, serializeHash: 123, mutation: { fp: "correct", fpHash: 456 } },
    phases: Object.fromEntries(names.map((name) => [name, summarize([1])])),
    operations: summarize([16]), total: summarize([100]),
  };
}

describe("benchmark comparison validity", () => {
  test("requires identical complete workload metadata and checks", () => {
    const a = coreResult();
    expect(resultMatch(a, structuredClone(a))).toBe(true);
    for (const mutate of [
      (b) => { b.workload.runs = 2; },
      (b) => { b.workload.sections = 2; },
      (b) => { b.checks.mutation.fp = "different even if hash collides"; },
      (b) => { b.checks.roundsIdentical = false; },
      (b) => { delete b.checks.roundsIdentical; },
    ]) {
      const b = structuredClone(a);
      mutate(b);
      expect(resultMatch(a, b)).toBe(false);
    }
  });

  test("invalid core results publish no speedup", () => {
    const a = coreResult();
    const b = coreResult();
    b.checks.serializeHash++;
    const lines = [];
    const log = console.log;
    try {
      console.log = (line) => { lines.push(line); };
      printSizeTable(a, b, 1);
    } finally {
      console.log = log;
    }
    expect(lines.filter((line) => line.includes("invalid (no speedup)"))).toHaveLength(18);
    expect(lines.join("\n")).not.toContain("1.0x");
  });

  test("testing comparisons reject missing checks, changed runs and skipped cases", () => {
    const a = { workload: { runs: 2, cases: { scenario: 3 } },
      phases: { scenario: { status: "passed" } }, checks: { scenario: { cases: 3, fingerprint: "same" } } };
    expect(testingPhaseMatches(a, structuredClone(a), "scenario")).toBe(true);
    const b = structuredClone(a);
    b.workload.runs++;
    expect(testingPhaseMatches(a, b, "scenario")).toBe(false);
    delete a.checks.scenario;
    delete b.checks.scenario;
    b.workload.runs = a.workload.runs;
    expect(testingPhaseMatches(a, b, "scenario")).toBe(false);
    a.checks.scenario = b.checks.scenario = { cases: 1, fingerprint: "same" };
    expect(testingPhaseMatches(a, b, "scenario")).toBe(false);
  });
});
