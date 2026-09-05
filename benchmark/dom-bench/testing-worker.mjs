#!/usr/bin/env bun
// A separate process from the large-tree worker, so the testing suite's memory
// and warmup are not conditioned on the core suite having run first.
import { createHash } from "node:crypto";
import { TESTING_SCENARIOS, casesForSize } from "./testing-scenarios.mjs";
import { collectAndDrain, summarize } from "./stats.mjs";

const LOADERS = { "mad-dom": () => import("../../index.js"), "happy-dom": () => import("happy-dom") };

function parseArgs(argv) {
  const args = { engine: null, runs: 5, sizes: [1] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--engine") args.engine = argv[++i];
    else if (arg === "--runs") args.runs = Number(argv[++i]);
    else if (arg === "--sizes") {
      const parts = String(argv[++i] ?? "").split(",");
      args.sizes = parts.map((part) => part.trim() ? Number(part) : NaN);
    } else if (arg !== "--json") throw new Error(`unknown argument: ${arg}`);
  }
  if (!Object.hasOwn(LOADERS, args.engine) || !Number.isInteger(args.runs) || args.runs < 1 ||
      args.sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
    throw new Error("usage: bun benchmark/dom-bench/testing-worker.mjs --engine <mad-dom|happy-dom> [--runs <n>] [--sizes <s1,s2,...>] [--json]");
  }
  return args;
}

export async function runTestingSize(Window, size, runs, scenarios = TESTING_SCENARIOS) {
  const samples = Object.fromEntries(scenarios.map(({ name }) => [name, []]));
  const checks = {};
  const failures = {};
  const perPhase = {};
  let baseline = 0;
  for (let round = 0; round < runs + 2; round++) {
    const measured = round >= 2;
    if (round === 2) baseline = process.memoryUsage().rss;
    for (const scenario of scenarios) {
      const { name } = scenario;
      if (failures[name]) continue;
      try {
        const result = await scenario.run(Window, casesForSize(scenario, size));
        const fingerprint = createHash("sha256").update(JSON.stringify(result.checks)).digest("hex");
        if (checks[name] && checks[name].fingerprint !== fingerprint) throw new Error("results changed between rounds");
        checks[name] = { cases: result.checks.cases, fingerprint };
        if (measured) samples[name].push(result.ms);
      } catch (error) {
        failures[name] = {
          round, stage: measured ? "measured" : "warmup",
          message: String(error.message ?? error).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000),
        };
        // Never publish a partial or failed run as a speedup.
        samples[name] = [];
        delete checks[name];
      }
      const peak = process.memoryUsage().rss;
      await collectAndDrain();
      if (measured) perPhase[name] = { peak, after: process.memoryUsage().rss };
    }
  }
  return {
    size,
    workload: { runs, cases: Object.fromEntries(scenarios.map((s) => [s.name, casesForSize(s, size)])) },
    phases: Object.fromEntries(scenarios.map(({ name }) => [name,
      failures[name] ? { status: "failed", samples: [], error: failures[name] } : { status: "passed", ...summarize(samples[name]) }])),
    checks, rss: { baseline, perPhase }, valid: Object.keys(failures).length === 0,
  };
}

if (import.meta.main) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(2); }
  const { Window } = await LOADERS[args.engine]();
  const results = [];
  for (const size of args.sizes) results.push(await runTestingSize(Window, size, args.runs));
  // A completed worker returns its failure data. The comparison runner owns the
  // nonzero exit status after printing both engines' reports.
  console.log(JSON.stringify({
    schema: "mad-dom-testing-bench/1", engine: args.engine,
    host: { os: process.platform, arch: process.arch, bun: process.versions.bun },
    sizes: args.sizes, runs: args.runs, phases: TESTING_SCENARIOS.map((s) => s.name), results,
  }, null, 2));
}
