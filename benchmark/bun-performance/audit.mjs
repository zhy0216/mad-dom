import { strict as assert } from "node:assert";
import { HOTSPOTS } from "./protocol.mjs";
import { validateAttempt } from "./report.mjs";

export function observedPaths(attempt) {
  validateAttempt(attempt);
  assert.equal(attempt.config.diagnostic, true, "path evidence must come from an independent diagnostic process");
  const paths = {};
  for (const row of attempt.report.results) {
    paths[row.size] = {};
    for (const name of HOTSPOTS) {
      const rounds = row.phases[name].diagnostics;
      assert.equal(rounds?.length, attempt.config.runs + 2, "missing path audit rounds");
      assert.ok(rounds.every(r => Object.entries(r).every(([key, n]) => Number.isFinite(n) && n >= 0 && (!key.startsWith("fallback.") || n === 0))), "unexpected adapter fallback in path audit");
      const calls = rounds.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => /^(NodeAPI|adapter|raw)\./.test(key))));
      const channels = [...new Set(calls.flatMap(r => Object.keys(r)))].sort();
      if (!name.endsWith("hot") || attempt.config.suite !== "facade") assert.ok(channels.length, `unobserved operation path: ${name}`);
      if (attempt.config.ffi === "on" && attempt.config.suite !== "facade") {
        assert.ok(channels.some(x => x.startsWith(attempt.config.suite === "raw" ? "raw." : "adapter.")), `expected real FFI operation: ${name}`);
      }
      // Facade is allowed to select Node-API with available FFI capability.
      // Record that decision faithfully; undefined adapter output is refused above.
      paths[row.size][name] = { evidence: attempt.id, channels, callsPerRound: calls,
        operationsPerRound: attempt.config.iterations,
        selection: channels.length ? "observed calls in independent audit" : "observed zero boundary calls (hot public cache hit)" };
    }
  }
  return paths;
}
