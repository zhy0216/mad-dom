import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { TESTING_SCENARIOS, casesForSize } from "./testing-scenarios.mjs";
import { runTestingSize } from "./testing-worker.mjs";

describe("unit-test benchmark fixtures", () => {
  for (const scenario of TESTING_SCENARIOS) {
    test(`${scenario.name} satisfies its oracle on the reference engine`, async () => {
      // Two cycles exercise cleanup/reuse and the changing case data.
      const result = await scenario.run(Window, 2);
      expect(result.checks.cases).toBe(2);
      expect(result.ms).toBeGreaterThan(0);
    });
  }

  test("scaling changes case count, with at least one case", () => {
    expect(casesForSize({ cases: 25 }, 0.1)).toBe(3);
    expect(casesForSize({ cases: 25 }, 2)).toBe(50);
    expect(casesForSize({ cases: 25 }, 0.001)).toBe(1);
  });
});

describe("unit-test benchmark validity", () => {
  test("discards two warmup samples and verifies every round", async () => {
    let calls = 0;
    const report = await runTestingSize(null, 0.1, 3, [{
      name: "success", cases: 20,
      async run(_Window, count) {
        return { ms: ++calls, checks: { cases: count, value: "correct" } };
      },
    }]);
    expect(calls).toBe(5);
    expect(report.valid).toBe(true);
    expect(report.workload.cases.success).toBe(2);
    expect(report.phases.success.samples).toEqual([3, 4, 5]);
    expect(report.phases.success.medianMs).toBe(4);
    expect(report.checks.success.cases).toBe(2);
  });

  test("reports a failure and continues the other scenarios", async () => {
    let failedCalls = 0;
    let healthyCalls = 0;
    const report = await runTestingSize(null, 1, 1, [
      { name: "broken", cases: 1, run() { failedCalls++; throw new Error("missing API"); } },
      { name: "healthy", cases: 1, run() { healthyCalls++; return { ms: 1, checks: { cases: 1 } }; } },
    ]);
    expect(failedCalls).toBe(1);
    expect(healthyCalls).toBe(3);
    expect(report.valid).toBe(false);
    expect(report.phases.broken).toEqual({
      status: "failed", samples: [], error: { round: 0, stage: "warmup", message: "missing API" },
    });
    expect(report.checks.broken).toBeUndefined();
    expect(report.phases.healthy.status).toBe("passed");
  });

  test("a later failure invalidates earlier measured samples", async () => {
    let calls = 0;
    const report = await runTestingSize(null, 1, 3, [{
      name: "lateFailure", cases: 1,
      run() {
        if (++calls === 4) throw new Error("wrong result");
        return { ms: 1, checks: { cases: 1 } };
      },
    }]);
    expect(calls).toBe(4);
    expect(report.phases.lateFailure.samples).toEqual([]);
    expect(report.phases.lateFailure.medianMs).toBeUndefined();
    expect(report.phases.lateFailure.error.stage).toBe("measured");
    expect(report.checks.lateFailure).toBeUndefined();
    expect(report.valid).toBe(false);
  });

  test("different outcomes across rounds invalidate the timing", async () => {
    let calls = 0;
    const report = await runTestingSize(null, 1, 2, [{
      name: "unstableResult", cases: 1,
      run() { return { ms: 1, checks: { cases: 1, value: calls++ } }; },
    }]);
    expect(report.valid).toBe(false);
    expect(report.phases.unstableResult.samples).toEqual([]);
    expect(report.phases.unstableResult.error.message).toBe("results changed between rounds");
  });
});
