#!/usr/bin/env bun
// Probe process bootstrap for the black-box differential runner (T10).
//
// One fresh process per (scenario, target) pair — the isolation unit of
// ADR-0002 section 5.2. Invoked by run.js as:
//
//   bun child.js <scenarioPath> <targetId> <outPath>
//
// The probe:
//   1. loads the target adapter (api.dom) — the ONLY place any implementation
//      is ever imported;
//   2. loads and validates the scenario module;
//   3. runs the scenario with a recorder-backed api;
//   4. normalizes the recorded observations (normalize.js runs HERE, in the
//      probe process, because raw values may contain symbols/bigints/cycles
//      that cannot survive JSON transport);
//   5. writes the structured envelope to <outPath> and exits 0.
//
// Everything that goes wrong (unknown target, scenario contract violation,
// scenario crash, normalizer crash) is captured as envelope.infraError — a
// structured, side-local result. The parent turns missing/unparseable output
// or a non-zero exit into the same shape. infraError therefore means "this
// side could not produce a comparable record" and always fails the run with
// exit code 2 (infrastructure), even when both sides fail identically — a
// broken scenario must never silently "pass".
//
// Envelope shape (mad-dom-diff-envelope/1):
//   { schema, scenario, target, pid, record, infraError }
// pid is self-test evidence only; it never enters the normalized record.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRecorder, createScenarioApi, describeScenarioProblems } from "./protocol.js";
import { normalizeRecord } from "./normalize.js";
import { getTarget } from "./targets.js";

const ENVELOPE_SCHEMA = "mad-dom-diff-envelope/1";

function toInfrastructureError(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: typeof error?.message === "string" ? error.message : String(error),
  };
}

const [scenarioPath, targetId, outPath] = process.argv.slice(2);

const envelope = {
  schema: ENVELOPE_SCHEMA,
  scenario: null,
  target: targetId ?? null,
  pid: process.pid,
  record: null,
  infraError: null,
};

try {
  if (typeof scenarioPath !== "string" || typeof targetId !== "string" || typeof outPath !== "string") {
    throw new Error("usage: bun child.js <scenarioPath> <targetId> <outPath>");
  }
  const target = getTarget(targetId);
  const scenarioModule = await import(pathToFileURL(resolve(scenarioPath)).href);
  const problems = describeScenarioProblems(scenarioModule, scenarioPath);
  if (problems.length > 0) throw new Error(`scenario contract violations: ${problems.join("; ")}`);
  envelope.scenario = scenarioModule.id;

  const dom = await target.load();
  const recorder = createRecorder();
  const api = createScenarioApi(targetId, dom, recorder);
  await scenarioModule.run(api);
  envelope.record = normalizeRecord(recorder);
} catch (error) {
  envelope.infraError = toInfrastructureError(error);
}

try {
  await writeFile(outPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
} catch (error) {
  console.error(`[mad-dom-diff child] cannot write envelope to ${outPath}: ${toInfrastructureError(error).message}`);
  process.exit(1);
}
