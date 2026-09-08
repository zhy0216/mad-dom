// Recompute committed tables from all successful formal batches, preserving repeats.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { summarize } from "../../../../benchmark/dom-bench/stats.mjs";
import { sha256 } from "../../../../benchmark/bun-performance/protocol.mjs";
const evidence = import.meta.dir;
const json = p => JSON.parse(readFileSync(p, "utf8"));
const combined = {};
const campaign = { batches: [], note: "All initial and predeclared supplemental samples retained; endpoint load snapshots are context, not continuous CPU attribution." };
let tables = "# Complete task-01 formal phase tables\n\nA = FFI off, B = FFI on, same frozen source and Bun executable. All original and supplemental rounds are retained. Each cell is median / p90 / MAD in ms. Hotspot cells time 32 operations (creation: 32 full pool tiers). Positive change means FFI on took longer. Group changes retain each independent ABBA block; these are not confidence intervals.\n";
for (const lane of ["baseline", "latest"]) {
  const base = json(join(evidence, `${lane}-formal/summary.json`));
  const extra = existsSync(join(evidence, `${lane}-supplemental/summary.json`)) ? json(join(evidence, `${lane}-supplemental/summary.json`)) : null;
  assert.equal(base.valid, true);
  if (extra) { assert.equal(extra.valid, true); assert.deepEqual(extra.protocol, base.protocol); assert.equal(extra.rows.length, base.rows.length); }
  for (const batch of [`${lane}-formal`, ...(extra ? [`${lane}-supplemental`] : [])]) {
    const manifest = json(join(evidence, batch, "manifest.json"));
    assert.equal(manifest.valid, true);
    const attempts = manifest.attempts.map(file => json(join(evidence, batch, file)));
    assert.ok(attempts.every(a => a.exitCode === 0 && a.signal === null && a.error === null));
    const loads = attempts.flatMap(a => [a.before, a.after]);
    const range = values => ({ min: Math.min(...values), max: Math.max(...values) });
    const pressure = (load, field) => Number(load[field].match(/some avg10=([\d.]+)/)[1]);
    const names = [...new Set(loads.flatMap(l => l.competingProcesses.slice(1).map(line => line.trim().split(/\s+/)[2]).filter(Boolean)))].sort();
    campaign.batches.push({ batch, manifestSha256: sha256(readFileSync(join(evidence, batch, "manifest.json"))),
      started: manifest.started, ended: manifest.ended, processes: attempts.length, protocol: manifest.protocol,
      cpu: { count: loads[0].cpuCount, model: loads[0].cpuModel, kernel: loads[0].kernel },
      load1: range(loads.map(l => l.loadavg[0])), cpuSomeAvg10Percent: range(loads.map(l => pressure(l, "cpuPressure"))),
      memorySomeAvg10Percent: range(loads.map(l => pressure(l, "memoryPressure"))),
      freeMemoryBytes: range(loads.map(l => l.freeMemory)), visibleProcessNames: names,
      unstableRows: json(join(evidence, batch, "summary.json")).rows.filter(r => r.unstable).length });
  }
  const rows = base.rows.map(row => {
    const repeated = extra?.rows.find(r => r.suite === row.suite && r.size === row.size && r.phase === row.phase);
    if (extra) assert.ok(repeated, `missing supplemental row: ${lane}/${row.suite}/${row.size}/${row.phase}`);
    const side = key => {
      const samples = [...row[key].samples, ...(repeated?.[key].samples ?? [])];
      return { ...summarize(samples), processMedians: [...row[key].processMedians, ...(repeated?.[key].processMedians ?? [])] };
    };
    const A = side("A"), B = side("B");
    return { suite: row.suite, size: row.size, phase: row.phase, A, B,
      initialChangePercent: row.changePercent, supplementalChangePercent: repeated?.changePercent ?? null,
      groupChangesPercent: [...row.groupChangesPercent, ...(repeated?.groupChangesPercent ?? [])],
      initialUnstable: row.unstable, supplementalUnstable: repeated?.unstable ?? null,
      changePercent: (B.medianMs / A.medianMs - 1) * 100, speedupAoverB: A.medianMs / B.medianMs };
  });
  combined[lane] = rows;
  for (const suite of base.protocol.suites) for (const size of base.protocol.sizes) {
    tables += `\n## ${lane}: ${suite}, size ${size}\n\n| Phase | A median / p90 / MAD ms | B median / p90 / MAD ms | Change | ABBA group changes | Noise flags (initial/repeat) |\n| --- | ---: | ---: | ---: | --- | --- |\n`;
    const cell = x => [x.medianMs, x.p90Ms, x.madMs].map(n => n.toPrecision(5)).join(" / ");
    for (const r of rows.filter(r => r.suite === suite && r.size === size)) tables += `| ${r.phase} | ${cell(r.A)} | ${cell(r.B)} | ${r.changePercent.toFixed(1)}% | ${r.groupChangesPercent.map(x => x.toFixed(1) + "%").join(", ")} | ${r.initialUnstable}/${r.supplementalUnstable ?? "not triggered"} |\n`;
  }
}
writeFileSync(join(evidence, "combined.json"), JSON.stringify(combined, null, 2) + "\n");
writeFileSync(join(evidence, "tables.md"), tables);
writeFileSync(join(evidence, "campaign.json"), JSON.stringify(campaign, null, 2) + "\n");

const profiles = [];
for (const lane of ["baseline", "latest"]) {
  const manifest = json(join(evidence, `${lane}-profiles/manifest.json`));
  for (const file of manifest.attempts) {
    const attempt = json(join(evidence, `${lane}-profiles`, file));
    const directory = `/tmp/mad-dom-bun-performance-01/profiles/${lane}/${attempt.id}`;
    const names = readdirSync(directory).filter(n => n.endsWith(".cpuprofile"));
    assert.equal(names.length, 1, `expected one complete profile: ${directory}`);
    for (const name of names) {
      const path = join(directory, name), raw = readFileSync(path), profile = JSON.parse(raw);
      const nodes = new Map(profile.nodes.map(n => [n.id, n]));
      assert.ok(profile.samples?.length > 0);
      assert.equal(profile.timeDeltas?.length, profile.samples.length);
      assert.ok(profile.samples.every(id => nodes.has(id)));
      const parents = new Map();
      for (const node of nodes.values()) for (const child of node.children ?? []) parents.set(child, node.id);
      const totals = new Map(), operate = new Map();
      let operateSamples = 0, operateMicros = 0;
      const label = node => `${node.callFrame?.functionName || "(anonymous)"} @ ${node.callFrame?.url || "(native/runtime)"}:${(node.callFrame?.lineNumber ?? -1) + 1}`;
      for (let i = 0; i < (profile.samples ?? []).length; i++) {
        const id = profile.samples[i], node = nodes.get(id), key = label(node), weight = profile.timeDeltas?.[i] ?? 1;
        totals.set(key, (totals.get(key) ?? 0) + weight);
        let parent = id, inside = false;
        while (parent !== undefined) {
          const frame = nodes.get(parent)?.callFrame;
          if (frame?.functionName === "operate" && frame.url?.includes("bun-performance/worker.mjs")) { inside = true; break; }
          parent = parents.get(parent);
        }
        if (inside) { operateSamples++; operateMicros += weight; operate.set(key, (operate.get(key) ?? 0) + weight); }
      }
      const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([frame, sampledMicroseconds]) => ({ frame, sampledMicroseconds }));
      assert.ok(operateSamples > 0 && operateMicros > 0, `missing operate stack samples: ${path}`);
      profiles.push({ lane, suite: attempt.config.suite, ffi: attempt.config.ffi, path, sha256: sha256(raw), bytes: raw.length,
        command: attempt.command, config: attempt.config, cwd: attempt.cwd,
        profileSamples: profile.samples?.length ?? 0, operateSamples, operateMicros,
        note: "CPU profile is independent, includes setup/validation/GC; operate subset uses stack ancestry, may lose inlined frames; JS sampling does not resolve Rust allocator internals.",
        topWholeProcess: top(totals), topOperate: top(operate) });
    }
  }
}
assert.equal(profiles.length, 12);
writeFileSync(join(evidence, "profiles.json"), JSON.stringify(profiles, null, 2) + "\n");
console.log(JSON.stringify({ rows: Object.fromEntries(Object.entries(combined).map(([k, v]) => [k, v.length])), profiles: profiles.length }));
