import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  CAPABILITY_SCHEMA,
  assertCapabilityReport,
  collectCapabilities,
} from "../../scripts/bun-capability-probe.mjs";
import {
  BENCHMARK_SCHEMA,
  assertBenchmarkReport,
  runBenchmark,
} from "../../scripts/bench-bun-native.mjs";

describe("T1 Bun capability matrix", () => {
  test("reports every capability as data, including unavailable paths", async () => {
    const report = await collectCapabilities();
    expect(report.schema).toBe(CAPABILITY_SCHEMA);
    expect(() => assertCapabilityReport(report)).not.toThrow();
    expect(report.runtime.name).toBe("bun");
    expect(typeof report.runtime.version === "string" || report.runtime.version === null).toBe(true);
    expect(report.capabilities.ffi.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.gc.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.arrayBuffer.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.io.file.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.io.spawn.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.io.serve.status).toMatch(/^(available|unavailable|disabled)$/);
    expect(report.capabilities.jscPrivateApi.defaultPath).toBe(false);
  });

  test("matrix semantics keep latest, baseline, disabled and unavailable distinct", async () => {
    const report = await collectCapabilities({ env: { ...process.env, MAD_DOM_FFI_DISABLED: "1" } });
    expect(report.matrix.latest.meaning).toContain("current Bun release");
    expect(report.matrix.baseline.selection).toBe(".bun-version");
    expect(report.matrix.ffiDisabled.expectedPath).toBe("node-api");
    expect(report.matrix.ffiUnavailable.expectedPath).toBe("node-api");
    expect(report.capabilities.ffi.status).toBe("disabled");
  });
});

describe("T1 same-input native boundary benchmark", () => {
  test("returns machine-readable comparison rows without synthetic FFI numbers", async () => {
    const report = await runBenchmark({ iterations: 2, batchSize: 4 });
    expect(report.schema).toBe(BENCHMARK_SCHEMA);
    expect(() => assertBenchmarkReport(report)).not.toThrow();
    expect(Object.keys(report.comparisons).length).toBeGreaterThanOrEqual(6);
    expect(report.input.largeDocumentSize).toBe(512);
    for (const row of Object.values(report.comparisons)) {
      expect(row.sameInput).toBe(true);
      if (row.ffi.status === "unavailable") expect(row.comparable).toBe(false);
    }
    expect(report.validation.noSyntheticFfiMetrics).toBe(true);
  });

  test("CLI entry points are present for the package scripts", () => {
    expect(join(import.meta.dir, "../../scripts/bun-capability-probe.mjs")).toContain("bun-capability-probe");
    expect(join(import.meta.dir, "../../scripts/bench-bun-native.mjs")).toContain("bench-bun-native");
  });
});
