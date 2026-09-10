// Read/verify saved evidence and emit all phase tables. Run under sampling gate.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { summarizeComparison } from "../../../../benchmark/bun-performance/report.mjs";
import { summarize } from "../../../../benchmark/dom-bench/stats.mjs";
import { sha256 } from "../../../../benchmark/bun-performance/protocol.mjs";

const directory = import.meta.dir;
const names = readdirSync(directory).filter(name => existsSync(join(directory, name, "manifest.json")));
const batches = names.map(name => {
  const path = join(directory, name);
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json")));
  if (!manifest.valid || manifest.protocol.kind !== "formal") return { name, valid: manifest.valid, kind: manifest.protocol.kind };
  const attempts = manifest.attempts.map(file => JSON.parse(readFileSync(join(path, file))));
  const rows = summarizeComparison(attempts, manifest.protocol);
  assert.deepEqual(rows, JSON.parse(readFileSync(join(path, "summary.json"))).rows);
  return { name, valid: true, kind: "formal", manifest, attempts, rows };
});
const summary = [];
const tables = ["# Complete task 05 phase tables", "", "Positive change means B takes longer. Every saved formal sample remains included.",
  "All medians/p90/MAD are milliseconds per original round. Source comparisons use A=reference, B=candidate; FFI comparisons use A=off, B=on.", ""];
for (const batch of batches) {
  if (!batch.rows) { summary.push({ name: batch.name, valid: batch.valid, kind: batch.kind }); continue; }
  const { name, manifest: m, rows, attempts } = batch;
  const flags = rows.filter(r => r.unstable || r.groupChangesPercent.every(n => n > 5));
  summary.push({ name, valid: true, kind: "formal", protocol: m.protocol, runtime: m.bun,
    source: { A: m.reference.source.productionSha256, B: m.candidate.source.productionSha256 },
    images: { A: m.reference.image, B: m.candidate.image }, processes: attempts.length,
    repeatedRegressionRows: rows.filter(r => r.groupChangesPercent.every(n => n > 5)).map(r => ({ suite: r.suite, size: r.size, phase: r.phase })),
    supplementalSuites: m.protocol.suites.filter(s => flags.some(r => r.suite === s)), rows,
    memory: attempts.map(a => ({ id: a.id, side: a.side, before: a.before, after: a.after,
      samples: a.report.results.map(r => ({ size: r.size, memory: r.memory, rss: r.rss })) })) });
  tables.push(`## ${name}`, "", `Runtime ${m.bun.version} (${m.bun.revision}); ${m.protocol.mode}, FFI ${m.protocol.sourceFfi}.`, "",
    "| Suite | Size | Phase | A median / p90 / MAD | B median / p90 / MAD | Change | ABBA group changes | Noise |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- | --- |",
    ...rows.map(r => `| ${r.suite} | ${r.size} | ${r.phase} | ${[r.A.medianMs, r.A.p90Ms, r.A.madMs].map(n => n.toPrecision(5)).join(" / ")} | ${[r.B.medianMs, r.B.p90Ms, r.B.madMs].map(n => n.toPrecision(5)).join(" / ")} | ${r.changePercent.toFixed(1)}% | ${r.groupChangesPercent.map(n => n.toFixed(1) + "%").join(", ")} | ${r.unstable} |`), "");
}
// Supplements keep every round; only the suites flagged by the original batch
// are repeated. Validate identity before combining distributions, and retain
// the original/repeat noise flags instead of treating a pooled median as proof.
const combined = {};
const combinedTables = ["# Task 03 initial and supplemental samples", "",
  "A/B and units follow tables.md. Every original and supplemental round is retained.", ""];
for (const base of batches.filter(b => b.rows && !b.name.endsWith("-supplemental"))) {
  const extra = batches.find(b => b.name === `${base.name}-supplemental`);
  if (extra) {
    assert.ok(extra.rows, "supplemental batch must be valid and formal");
    for (const key of ["bun", "reference", "candidate", "harness"]) assert.deepEqual(extra.manifest[key], base.manifest[key]);
    const withoutSuites = ({ suites, ...protocol }) => protocol;
    assert.deepEqual(withoutSuites(extra.manifest.protocol), withoutSuites(base.manifest.protocol));
    assert.deepEqual(extra.manifest.protocol.suites, summary.find(b => b.name === base.name).supplementalSuites);
  }
  const rows = base.rows.map(row => {
    const repeat = extra?.rows.find(r => r.suite === row.suite && r.size === row.size && r.phase === row.phase);
    if (extra?.manifest.protocol.suites.includes(row.suite)) assert.ok(repeat, "missing supplemental workload");
    const side = key => ({ ...summarize([...row[key].samples, ...(repeat?.[key].samples ?? [])]),
      processMedians: [...row[key].processMedians, ...(repeat?.[key].processMedians ?? [])] });
    const A = side("A"), B = side("B");
    return { suite: row.suite, size: row.size, phase: row.phase, A, B,
      initialChangePercent: row.changePercent, supplementalChangePercent: repeat?.changePercent ?? null,
      initialUnstable: row.unstable, supplementalUnstable: repeat?.unstable ?? null,
      groupChangesPercent: [...row.groupChangesPercent, ...(repeat?.groupChangesPercent ?? [])],
      changePercent: (B.medianMs / A.medianMs - 1) * 100 };
  });
  combined[base.name] = { batches: [base.name, ...(extra ? [extra.name] : [])], rows };
  combinedTables.push(`## ${base.name}`, "",
    "| Suite | Size | Phase | A median / p90 / MAD | B median / p90 / MAD | Change | All ABBA groups | Noise initial / supplemental |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- | --- |",
    ...rows.map(r => `| ${r.suite} | ${r.size} | ${r.phase} | ${[r.A.medianMs, r.A.p90Ms, r.A.madMs].map(n => n.toPrecision(5)).join(" / ")} | ${[r.B.medianMs, r.B.p90Ms, r.B.madMs].map(n => n.toPrecision(5)).join(" / ")} | ${r.changePercent.toFixed(1)}% | ${r.groupChangesPercent.map(n => n.toFixed(1) + "%").join(", ")} | ${r.initialUnstable} / ${r.supplementalUnstable ?? "not triggered"} |`), "");
}
writeFileSync(join(directory, "analysis.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(join(directory, "tables.md"), tables.join("\n") + "\n");
writeFileSync(join(directory, "combined.json"), JSON.stringify(combined, null, 2) + "\n");
writeFileSync(join(directory, "combined-tables.md"), combinedTables.join("\n") + "\n");
writeFileSync(join(directory, "sample-files.json"), JSON.stringify(Object.fromEntries(names.flatMap(name => readdirSync(join(directory, name))
  .filter(file => file.endsWith(".json")).map(file => [`${name}/${file}`, sha256(readFileSync(join(directory, name, file)))]))), null, 2) + "\n");
console.log(JSON.stringify(summary.map(({ name, valid, kind, processes, supplementalSuites, repeatedRegressionRows }) =>
  ({ name, valid, kind, processes, supplementalSuites, repeatedRegressionRows })), null, 2));
