// Derive tables only from complete, validated campaigns. No timing is launched.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { summarize } from "../../../../benchmark/dom-bench/stats.mjs";
import { summarizeComparison } from "../../../../benchmark/bun-performance/report.mjs";
import { digest, evidence, save } from "./command.mjs";

const json = path => JSON.parse(readFileSync(join(evidence, path), "utf8"));
const combined = {}, campaign = [], regressions = [];
let table = "# All task-02 source-comparison rows\n\nA = frozen reference; B = candidate, same runtime and FFI mode. All completed recovery initial and supplemental samples are retained. The interrupted original campaign remains on disk and is excluded from ratios because it has no complete manifest, full paired matrix or closing fingerprint; see recovery-20260908/audit.json. Positive change is slower. Core/Testing operations use the median of per-round sums. Hotspots include 32 complete operations and all original materialization. Group changes are not confidence intervals.\n";
const cell = x => [x.medianMs, x.p90Ms, x.madMs].map(n => n.toPrecision(5)).join(" / ");
for (const lane of ["baseline", "latest"]) for (const ffi of ["on", "off"]) {
  const key = `resume-1-${lane}-source-${ffi}`;
  const readBatch = name => {
    const manifest = json(`${name}/manifest.json`);
    const summary = json(`${name}/summary.json`);
    assert.equal(manifest.valid, true);
    assert.equal(summary.valid, true);
    const attempts = manifest.attempts.map(file => json(`${name}/${file}`));
    assert.deepEqual(summarizeComparison(attempts, manifest.protocol), summary.rows);
    const integrity = json(`${name}-integrity.json`);
    assert.equal(integrity.unchanged, true);
    assert.deepEqual(integrity.before, integrity.after);
    const loads = attempts.flatMap(a => [a.before, a.after]);
    const range = values => ({ min: Math.min(...values), max: Math.max(...values) });
    const pressure = x => Number(x.cpuPressure.match(/some avg10=([\d.]+)/)[1]);
    campaign.push({ name, manifestSha256: digest(readFileSync(join(evidence, name, "manifest.json"))),
      started: manifest.started, ended: manifest.ended, processes: attempts.length, protocol: manifest.protocol,
      candidate: manifest.candidate.image, reference: manifest.reference.image, runtime: manifest.bun,
      unstableRows: summary.rows.filter(r => r.unstable).length,
      load1: range(loads.map(x => x.loadavg[0])), cpuSomeAvg10Percent: range(loads.map(pressure)),
      visibleProcessNames: [...new Set(loads.flatMap(x => x.competingProcesses.slice(1).map(s => s.trim().split(/\s+/)[2]).filter(Boolean)))].sort() });
    return { manifest, summary };
  };
  const initial = readBatch(`${key}-formal`);
  const flagged = [...new Set(initial.summary.rows.filter(r => r.unstable || r.changePercent > 5 || r.groupChangesPercent.every(x => x > 5)).map(r => r.suite))];
  const extra = existsSync(join(evidence, `${key}-supplemental/summary.json`)) ? readBatch(`${key}-supplemental`) : null;
  if (flagged.length) {
    assert.ok(extra, `${key}: predeclared supplement is required for ${flagged.join(",")}`);
    assert.deepEqual([...extra.manifest.protocol.suites].sort(), flagged.sort());
    assert.deepEqual(extra.manifest.protocol.sizes, initial.manifest.protocol.sizes);
    for (const name of ["candidate", "reference", "bun", "harness"]) assert.deepEqual(extra.manifest[name], initial.manifest[name]);
  }
  const rows = initial.summary.rows.map(row => {
    const repeated = extra?.summary.rows.find(r => r.suite === row.suite && r.size === row.size && r.phase === row.phase);
    if (flagged.includes(row.suite)) assert.ok(repeated);
    const side = name => ({ ...summarize([...row[name].samples, ...(repeated?.[name].samples ?? [])]),
      processMedians: [...row[name].processMedians, ...(repeated?.[name].processMedians ?? [])] });
    const A = side("A"), B = side("B");
    const r = { suite: row.suite, size: row.size, phase: row.phase, A, B,
      initialChangePercent: row.changePercent, supplementalChangePercent: repeated?.changePercent ?? null,
      groupChangesPercent: [...row.groupChangesPercent, ...(repeated?.groupChangesPercent ?? [])],
      initialUnstable: row.unstable, supplementalUnstable: repeated?.unstable ?? null,
      changePercent: (B.medianMs / A.medianMs - 1) * 100, speedupAoverB: A.medianMs / B.medianMs };
    if (r.groupChangesPercent.every(x => x > 5) || r.initialChangePercent > 5 && r.supplementalChangePercent > 5) {
      regressions.push({ comparison: key, ...r });
    }
    return r;
  });
  combined[key] = rows;
  for (const suite of initial.manifest.protocol.suites) for (const size of initial.manifest.protocol.sizes) {
    table += `\n## ${key}: ${suite}, size ${size}\n\n| Phase | A median / p90 / MAD ms | B median / p90 / MAD ms | Change | All ABBA group changes | Noise initial / supplemental |\n| --- | ---: | ---: | ---: | --- | --- |\n`;
    for (const r of rows.filter(x => x.suite === suite && x.size === size)) table += `| ${r.phase} | ${cell(r.A)} | ${cell(r.B)} | ${r.changePercent.toFixed(1)}% | ${r.groupChangesPercent.map(x => `${x.toFixed(1)}%`).join(", ")} | ${r.initialUnstable} / ${r.supplementalUnstable ?? "not triggered"} |\n`;
  }
}
save("combined.json", combined);
save("campaign.json", campaign);
save("repeated-regressions.json", regressions);
writeFileSync(join(evidence, "tables.md"), table);
console.log(JSON.stringify({ comparisons: Object.fromEntries(Object.entries(combined).map(([k, v]) => [k, v.length])),
  formalProcesses: campaign.reduce((n, x) => n + x.processes, 0), repeatedRegressions: regressions.map(r => ({ comparison: r.comparison, suite: r.suite, size: r.size, phase: r.phase, changePercent: r.changePercent })) }, null, 2));
