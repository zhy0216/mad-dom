// Derivation follows task 01's operation-stack attribution; run under sampling.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { evidence, digest, save } from "./command.mjs";
const json = path => JSON.parse(readFileSync(path, "utf8"));
const profiles = [];
for (const lane of ["baseline", "latest"]) {
  const name = `${lane}-source-on-profile`;
  const manifest = json(join(evidence, name, "manifest.json"));
  assert.equal(manifest.valid, true);
  assert.equal(json(join(evidence, `${name}-integrity.json`)).unchanged, true);
  for (const file of manifest.attempts) {
    const attempt = json(join(evidence, name, file));
    const directory = `/tmp/mad-dom-bun-performance-02/profiles/${name}/${attempt.id}`;
    const names = readdirSync(directory).filter(n => n.endsWith(".cpuprofile"));
    assert.equal(names.length, 1);
    const path = join(directory, names[0]), raw = readFileSync(path), profile = JSON.parse(raw);
    const nodes = new Map(profile.nodes.map(n => [n.id, n]));
    assert.ok(profile.samples?.length > 0);
    assert.equal(profile.timeDeltas?.length, profile.samples.length);
    assert.ok(profile.samples.every(id => nodes.has(id)));
    const parents = new Map();
    for (const node of nodes.values()) for (const child of node.children ?? []) parents.set(child, node.id);
    const totals = new Map(), operate = new Map();
    let operateSamples = 0, operateMicros = 0;
    const label = node => `${node.callFrame?.functionName || "(anonymous)"} @ ${node.callFrame?.url || "(native/runtime)"}:${(node.callFrame?.lineNumber ?? -1) + 1}`;
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i], key = label(nodes.get(id)), weight = profile.timeDeltas[i];
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
    assert.ok(operateSamples > 0 && operateMicros > 0);
    profiles.push({ lane, side: attempt.side, suite: attempt.config.suite, ffi: attempt.config.ffi,
      path, sha256: digest(raw), bytes: raw.length, command: attempt.command, config: attempt.config, cwd: attempt.cwd,
      profileSamples: profile.samples.length, operateSamples, operateMicros,
      note: "Independent diagnostic includes setup/validation/GC. Operation subset follows stack ancestry and can lose inlined frames. JS sampling does not resolve Rust allocator internals. Raw profile must remain available through task 05.",
      topWholeProcess: top(totals), topOperate: top(operate) });
  }
}
assert.equal(profiles.length, 12);
save("profiles.json", profiles);
console.log(JSON.stringify({ profiles: profiles.length, complete: true }));
