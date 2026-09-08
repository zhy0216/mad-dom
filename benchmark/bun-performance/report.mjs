import { strict as assert } from "node:assert";
import { isDeepStrictEqual } from "node:util";
import { phasesFor, HOTSPOTS, TESTING, SUITES, hotWorkload, fingerprint, SCHEMA } from "./protocol.mjs";
import { resultMatch, testingPhaseMatches } from "../dom-bench/run.mjs";
import { summarize, summarizeOperations } from "../dom-bench/stats.mjs";

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const baseCases = [100, 25, 50, 50, 25, 25, 50, 50, 50, 50, 25, 50, 50];
function same(a, b, message) { assert.ok(isDeepStrictEqual(a, b), message); }

export function validateAttempt(attempt, expected) {
  assert.equal(attempt.validationError ?? null, null, "previously failed subprocess validation");
  assert.equal(attempt.exitCode, 0, "failed subprocess: nonzero/missing exit");
  assert.equal(attempt.signal, null, "failed subprocess: signal");
  assert.equal(attempt.error, null, "failed subprocess: spawn/parse error");
  const { metadata: m, report: r, config: c } = attempt;
  assert.ok(m && r && c, "missing result/provenance/config");
  assert.ok(Array.isArray(attempt.command), "missing actual subprocess command");
  assert.equal(attempt.command[0], c.bun.path, "subprocess executable mismatch");
  if (expected) same(c, expected, "unexpected process configuration");
  assert.ok(digest(c.image?.sha256) && digest(c.source?.productionSha256) && digest(c.bun?.sha256), "missing artifact/source/runtime hash");
  assert.ok(/^[a-f0-9]{40}$/.test(c.source.sourceSha ?? ""), "missing source commit");
  assert.equal(m.artifact?.path, c.image.path, "artifact path mismatch");
  assert.equal(m.artifact?.sha256, c.image.sha256, "artifact hash mismatch");
  assert.equal(m.executable?.path, c.bun.path, "runtime executable mismatch");
  assert.equal(m.executable?.sha256, c.bun.sha256, "runtime executable hash mismatch");
  assert.equal(m.source?.root, c.root, "source root mismatch");
  assert.equal(m.source?.productionSha256, c.source.productionSha256, "source hash mismatch");
  assert.equal(m.source?.domWorkloadSha256, c.source.domWorkloadSha256, "DOM workload source mismatch");
  assert.equal(m.source?.sourceSha, c.source.sourceSha, "source commit mismatch");
  assert.equal(m.overrides?.MAD_DOM_NATIVE_PATH, c.image.path, "Node-API override mismatch");
  assert.equal(m.overrides?.MAD_DOM_FFI_PATH, c.image.path, "FFI must use same image");
  assert.equal(m.overrides?.MAD_DOM_FFI_DISABLED, c.ffi === "on" ? "0" : "1");
  const rt = m.runtime;
  assert.ok(rt?.bunVersion && rt?.bunRevision && rt?.platform?.platform && rt?.platform?.arch, "missing runtime/capability metadata");
  if (rt.platform.platform === "linux") assert.ok(rt.platform.libc, "missing libc capability");
  assert.equal(rt.bunVersion, c.bun.version, "runtime version mismatch");
  assert.equal(rt.bunRevision, c.bun.revision, "runtime revision mismatch");
  same(rt.expectedAbis, { nodeApi: 1, ffi: 1 }, "ABI contract mismatch");
  assert.equal(rt.nodeApi?.status, "available", "unexpected Node-API fallback");
  assert.equal(rt.nodeApi?.abiVersion, 1);
  assert.equal(rt.nodeApi?.path, c.image.path);
  assert.equal(rt.ffi?.status, c.ffi === "on" ? "available" : "disabled", "unexpected FFI fallback");
  assert.equal(rt.ffi?.expectedAbiVersion, 1, "missing FFI ABI capability");
  assert.equal(rt.ffi?.expectedCapabilities, 31, "missing FFI capabilities");
  assert.ok(Array.isArray(rt.ffi.symbols), "missing FFI symbols");
  if (c.ffi === "on") {
    assert.equal(rt.ffi.abiVersion, 1);
    assert.equal(rt.ffi.capabilities, 31);
    assert.equal(rt.ffi.path, c.image.path);
    assert.equal(rt.ffi.symbols.length, 6, "missing FFI operation capability");
    assert.ok(!rt.ffi.imageReason, "FFI image fallback");
  }
  assert.equal(r.host?.bun, rt.bunVersion, "worker runtime mismatch");
  assert.equal(r.host?.os, rt.platform.platform);
  assert.equal(r.host?.arch, rt.platform.arch);
  assert.equal(r.schema, c.suite === "core" ? "mad-dom-dom-bench/3" : c.suite === "testing" ? "mad-dom-testing-bench/1" : `${SCHEMA}/hotspots`);
  assert.equal(r.engine, "mad-dom");
  assert.equal(r.runs, c.runs);
  same(r.sizes, c.sizes, "skipped/reordered size");
  assert.equal(r.results?.length, c.sizes.length, "skipped size");
  for (let i = 0; i < c.sizes.length; i++) {
    const row = r.results[i];
    assert.equal(row.size, c.sizes[i]);
    assert.equal(row.workload?.runs, c.runs);
    same(Object.keys(row.phases).sort(), [...phasesFor(c.suite)].sort(), "skipped/extra workload");
    for (const name of phasesFor(c.suite)) {
      const p = row.phases[name];
      assert.ok(Array.isArray(p?.samples), `missing timing: ${name}`);
      assert.equal(p.samples.length, c.runs, `skipped round: ${name}`);
      assert.ok(p.samples.every(t => typeof t === "number" && Number.isFinite(t) && t >= 0), `invalid timing: ${name}`);
      const calculated = summarize(p.samples);
      for (const field of ["medianMs", "p90Ms", "madMs", "minMs"]) assert.equal(p[field], calculated[field], `invalid timing statistic: ${name}.${field}`);
      assert.ok(calculated.medianMs > 0, `zero median has no valid speedup: ${name}`);
    }
    if (c.suite === "core") {
      assert.equal(row.checks?.roundsIdentical, true, "inconsistent core checks");
      for (const key of ["queryHits", "buildMixed", "buildDecomp", "readHeavy", "mutation", "serializeHash", "traverseCount", "traverseColdCount", "elementCount"]) {
        assert.ok(Object.hasOwn(row.checks, key), `missing core oracle: ${key}`);
      }
      const sections = Math.max(1, Math.round(100 * row.size));
      assert.equal(row.workload.sections, sections);
      assert.equal(row.workload.buildNodes, Math.max(100, Math.round(20000 * row.size)));
      assert.equal(row.workload.itemsPerSection, 25);
      same(row.operations, summarizeOperations(row.phases), "invalid per-round core sum");
    } else if (c.suite === "testing") {
      assert.equal(row.valid, true, "testing failure");
      same(r.phases, TESTING, "skipped testing scenario");
      for (const [j, name] of TESTING.entries()) {
        assert.equal(row.phases[name].status, "passed", `failed scenario: ${name}`);
        assert.equal(row.workload.cases[name], Math.max(1, Math.round(baseCases[j] * row.size)), `skipped case: ${name}`);
        assert.equal(row.checks?.[name]?.cases, row.workload.cases[name]);
        assert.ok(digest(row.checks[name].fingerprint), `missing oracle fingerprint: ${name}`);
      }
    } else {
      assert.equal(row.valid, true, "hotspot failure");
      assert.equal(row.workload.iterations, c.iterations);
      for (const name of HOTSPOTS) {
        assert.equal(row.phases[name].status, "passed");
        if (!c.diagnostic) assert.equal(row.phases[name].diagnostics, undefined, "unexpected timing instrumentation");
        assert.ok(row.phases[name].expectedPath ?? row.phases[name].path, "missing expected operation path");
        if (c.pathAudit) same(row.phases[name].observedPath, c.observedPaths?.[row.size]?.[name], "observed path evidence mismatch");
        same(row.workload.cases[name], hotWorkload(name, row.size, c.iterations), `workload fingerprint mismatch: ${name}`);
        assert.equal(row.phases[name].warmupSamples?.length, 2, "missing warmup");
        assert.ok(row.phases[name].warmupSamples.every(t => Number.isFinite(t) && t >= 0), "invalid warmup timing");
        const check = row.checks[name];
        assert.equal(check?.rounds?.length, c.runs + 2, "skipped correctness round");
        assert.ok(check.rounds.every(x => x.iterations === c.iterations), "skipped hotspot iteration");
        assert.ok(check.rounds.every(x => fingerprint(x) === check.fingerprint), "incorrect hotspot fingerprint");
      }
    }
  }
  return true;
}

export function compareAttempts(a, b) {
  validateAttempt(a); validateAttempt(b);
  for (const key of ["suite", "runs", "iterations", "sizes"]) same(a.config[key], b.config[key], `comparison ${key} mismatch`);
  for (const key of ["version", "revision", "sha256", "path"]) same(a.config.bun[key], b.config.bun[key], "runtime mismatch: cross-version ratios are forbidden");
  same(a.metadata.runtime.platform, b.metadata.runtime.platform, "host mismatch");
  same(a.metadata.source.domWorkloadSha256, b.metadata.source.domWorkloadSha256, "DOM workload source fingerprint mismatch");
  for (let i = 0; i < a.report.results.length; i++) {
    const x = a.report.results[i], y = b.report.results[i];
    same(x.workload, y.workload, "workload fingerprint mismatch");
    if (a.config.suite === "core") assert.ok(resultMatch(x, y), "core oracle fingerprint mismatch");
    else if (a.config.suite === "testing") for (const name of TESTING) assert.ok(testingPhaseMatches(x, y, name), "testing oracle fingerprint mismatch");
    else same(x.checks, y.checks, "hotspot oracle fingerprint mismatch");
  }
  return true;
}

export function summarizeComparison(attempts, protocol) {
  assert.ok(attempts.length > 0, "missing subprocesses");
  assert.ok(["formal", "smoke", "profile", "diagnostic"].includes(protocol.kind), "invalid protocol kind");
  assert.equal(protocol.warmup, 2, "protocol warmup mismatch");
  assert.equal(protocol.runs, protocol.kind === "smoke" ? 1 : 9, "protocol measured runs mismatch");
  assert.ok(Number.isInteger(protocol.groups) && protocol.groups >= 2, "protocol ABBA group count mismatch");
  assert.ok(protocol.suites.length > 0 && new Set(protocol.suites).size === protocol.suites.length, "protocol suites mismatch");
  assert.ok(protocol.suites.every(s => SUITES.includes(s)), "unknown protocol suite");
  const processesPerSuite = protocol.kind === "formal" ? protocol.groups * 4 : 2;
  same(attempts.map(a => a.config.suite), protocol.suites.flatMap(s => Array(processesPerSuite).fill(s)), "protocol/config suites or process sequence mismatch");
  same([...new Set(attempts.map(a => a.config.suite))].sort(), [...protocol.suites].sort(), "protocol/config suites mismatch");
  for (const a of attempts) {
    validateAttempt(a);
    if (protocol.kind === "formal") assert.ok(!a.command.some(arg => arg.startsWith("--cpu-prof")), "profile commands cannot enter formal timing");
    assert.equal(a.config.runs, protocol.runs, "protocol/config runs mismatch");
    same(a.config.sizes, protocol.sizes, "protocol/config sizes mismatch");
    assert.equal(a.config.iterations, protocol.iterations, "protocol/config iterations mismatch");
    assert.equal(Boolean(a.config.diagnostic), protocol.kind === "diagnostic", "instrumentation must stay out of formal timing");
    if (protocol.mode === "ffi") assert.equal(a.config.ffi, a.side === "A" ? "off" : "on", "FFI side mismatch");
    else if (protocol.mode === "source") assert.equal(a.config.ffi, protocol.sourceFfi, "source FFI mode mismatch");
    else throw new Error("invalid comparison mode");
  }
  const rows = [];
  for (const suite of protocol.suites) {
    const records = attempts.filter(a => a.config.suite === suite);
    const order = protocol.kind === "formal" ? Array.from({ length: protocol.groups }, () => ["A", "B", "B", "A"]).flat() : ["A", "B"];
    same(records.map(a => a.side), order, "incomplete/unbalanced process sequence");
    for (const a of records) compareAttempts(records[0], a);
    for (let i = 0; i < protocol.sizes.length; i++) {
      for (const phase of [...phasesFor(suite), ...(suite === "core" || suite === "testing" ? ["operations"] : [])]) {
        const sampleOf = a => phase === "operations" ? summarizeOperations(a.report.results[i].phases).samples : a.report.results[i].phases[phase].samples;
        const summarizeSide = side => {
          const selected = records.filter(a => a.side === side);
          return { ...summarize(selected.flatMap(sampleOf)), processMedians: selected.map(a => summarize(sampleOf(a)).medianMs) };
        };
        const A = summarizeSide("A"), B = summarizeSide("B");
        const groupChanges = [];
        if (protocol.kind === "formal") for (let group = 0; group < protocol.groups; group++) {
          const block = records.slice(group * 4, group * 4 + 4);
          const median = side => summarize(block.filter(a => a.side === side).flatMap(sampleOf)).medianMs;
          groupChanges.push((median("B") / median("A") - 1) * 100);
        }
        const unstable = A.madMs > A.medianMs * 0.2 || B.madMs > B.medianMs * 0.2 ||
          summarize(A.processMedians).madMs > summarize(A.processMedians).medianMs * 0.1 ||
          summarize(B.processMedians).madMs > summarize(B.processMedians).medianMs * 0.1 ||
          groupChanges.some(x => x > 5) && groupChanges.some(x => x < -5);
        rows.push({ suite, size: protocol.sizes[i], phase, A, B, groupChangesPercent: groupChanges, unstable,
          ...(protocol.kind === "formal" ? { speedupAoverB: A.medianMs / B.medianMs, changePercent: (B.medianMs / A.medianMs - 1) * 100 } : {}) });
      }
    }
  }
  return rows;
}
