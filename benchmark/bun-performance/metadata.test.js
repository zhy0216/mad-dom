import { describe, test, expect } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { HOTSPOTS, POOLS, operationPath } from "./protocol.mjs";
import { sourceManifest, fileIdentity } from "./provenance.mjs";
import { observedPaths } from "./audit.mjs";
import { validateAttempt, compareAttempts } from "./report.mjs";

const root = resolve(import.meta.dir, "../..");
const historical = join(root, "plans/bun-native-performance/evidence/baseline/baseline-reference-smoke");
const read = file => JSON.parse(readFileSync(join(historical, file), "utf8"));
const clone = value => structuredClone(value);

describe("nominal facade labels describe output independently of capability", () => {
  test("HTML names the complete public string operation and independent provider", () => {
    for (const name of HOTSPOTS.filter(n => /HTML/.test(n))) {
      const label = operationPath("facade", name, "on");
      expect(label).toBe(operationPath("facade", name, "off"));
      expect(label).toContain(name.startsWith("inner") ? "public innerHTML" : "public outerHTML");
      expect(label).toContain("complete string generation and length consumption");
      expect(label).toContain("provider: independent observedPath");
      expect(label).not.toMatch(/FFI|decode/);
    }
  });
  test("creation retains complete tier/count and canonical wrappers; scalar/cache labels stay exact", () => {
    for (const count of POOLS.slice(1)) {
      const label = operationPath("facade", `create.${count}`, "on");
      expect(label).toBe(operationPath("facade", `create.${count}`, "off"));
      expect(label).toContain(`tier ${count} (count ${count})`);
      expect(label).toContain("provider: independent observedPath -> canonical wrappers");
      expect(label).not.toMatch(/FFI|Node-API/);
    }
    for (const ffi of ["on", "off"]) {
      expect(operationPath("facade", "create.1", ffi)).toBe("public createElement -> tier 1 -> Node-API scalar -> canonical wrappers");
      for (const name of ["query.small.hot", "query.large.hot"]) expect(operationPath("facade", name, ffi))
        .toBe("public scoped query -> new StaticNodeList over cached wrappers -> full iteration (no boundary on hit)");
    }
  });
  test("raw and adapter labels remain identical to recorded labels in both real modes", () => {
    for (const suite of ["raw", "adapter"]) for (const side of ["A", "B"]) {
      const audit = read(`audit-${side}-${suite}.json`);
      for (const name of HOTSPOTS) expect(operationPath(suite, name, audit.config.ffi))
        .toBe(audit.report.results[0].phases[name].expectedPath);
    }
  });
});

describe("independent path evidence, with unchanged audit and report guards", () => {
  // Policy fixtures use actual off-mode Node-API call records and actual on-mode
  // capabilities/results. They test provider reporting, not a measured candidate
  // optimization; no historical evidence is written or relabelled.
  const enabled = read("audit-B-facade.json"), disabled = read("audit-A-facade.json");
  function nodeApiPolicy() {
    const audit = clone(enabled);
    for (const name of HOTSPOTS.filter(n => /HTML/.test(n) || n.startsWith("create."))) {
      audit.report.results[0].phases[name].diagnostics = clone(disabled.report.results[0].phases[name].diagnostics);
    }
    return audit;
  }
  test("available FFI can retain real Node-API HTML/range observations in a facade policy fixture", () => {
    const audit = nodeApiPolicy(), paths = observedPaths(audit), size = audit.config.sizes[0];
    expect(audit.metadata.runtime.ffi.status).toBe("available");
    expect(audit.config.ffi).toBe("on");
    expect(paths[size]["innerHTML.unicode"].channels).toEqual(["NodeAPI.innerHTML"]);
    expect(paths[size]["outerHTML.unicode"].channels).toEqual(["NodeAPI.outerHTML"]);
    for (const count of POOLS.slice(1)) expect(paths[size][`create.${count}`].channels).toEqual(["NodeAPI.createElementTokenRange"]);
    expect(compareAttempts(enabled, audit)).toBe(true);
    const m = read("manifest.json");
    const attempt = read(m.attempts.find(f => f.endsWith("facade-2-B.json")));
    attempt.config.observedPaths = paths;
    for (const name of HOTSPOTS) attempt.report.results[0].phases[name].observedPath = paths[size][name];
    expect(validateAttempt(attempt)).toBe(true);
    // A nominal label never excuses worker/audit disagreement.
    attempt.report.results[0].phases["innerHTML.unicode"].observedPath = { channels: ["adapter.serialize"] };
    expect(() => validateAttempt(attempt)).toThrow(/observed path evidence mismatch/);
  });
  test("unexpected fallback and missing/empty cold calls remain invalid", () => {
    for (const mutate of [
      a => { a.report.results[0].phases["innerHTML.unicode"].diagnostics[0]["fallback.serialize"] = 1; },
      a => { delete a.report.results[0].phases["innerHTML.unicode"].diagnostics; },
      a => { a.report.results[0].phases["innerHTML.unicode"].diagnostics = []; },
      a => { a.report.results[0].phases["innerHTML.unicode"].diagnostics = [{}, {}, {}]; },
      a => { a.report.results[0].phases["create.8"].diagnostics = [{}, {}, {}]; },
    ]) {
      const audit = nodeApiPolicy(); mutate(audit);
      expect(() => observedPaths(audit)).toThrow(/fallback|missing path audit rounds|unobserved operation path/);
    }
  });
  test("raw/adapter FFI-on still requires its own FFI channel", () => {
    for (const suite of ["raw", "adapter"]) {
      const audit = read(`audit-B-${suite}.json`);
      audit.report.results[0].phases["innerHTML.unicode"].diagnostics = clone(disabled.report.results[0].phases["innerHTML.unicode"].diagnostics);
      expect(() => observedPaths(audit)).toThrow(/expected real FFI operation/);
    }
  });
  test("provider flexibility cannot excuse capability, fingerprint or child failures", () => {
    for (const mutate of [
      a => { a.metadata.runtime.ffi.status = "partial"; },
      a => { a.metadata.runtime.ffi.symbols.pop(); },
      a => { a.report.results[0].checks["innerHTML.unicode"].fingerprint = "0".repeat(64); },
      a => { a.exitCode = 1; },
    ]) {
      const audit = nodeApiPolicy(); mutate(audit);
      expect(() => observedPaths(audit)).toThrow();
    }
  });
});

// Instrument only these isolated test processes, before importing the real
// preload. Production preload/worker preparation and timing stay untouched.
const tracePreload = `
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
const config = JSON.parse(process.env.MAD_DOM_PERFORMANCE_CONFIG);
const fromRoot = p => import(pathToFileURL(join(config.root, p)).href);
const loader = await fromRoot("js/native-loader.js"), native = loader.loadNative();
const { installDiagnostics } = await fromRoot("benchmark/bun-performance/diagnostics.mjs");
const diagnostics = installDiagnostics(native, loader);
const lifecycle = { created: 0, destroyed: 0 };
const create = native.createDocument, destroy = native.DocumentHandle.prototype.destroy;
native.createDocument = function (...args) { lifecycle.created++; return Reflect.apply(create, this, args); };
native.DocumentHandle.prototype.destroy = function (...args) { lifecycle.destroyed++; return Reflect.apply(destroy, this, args); };
diagnostics.start();
await fromRoot("benchmark/bun-performance/preload.mjs");
const calls = diagnostics.stop();
console.log(JSON.stringify({ lifecycle, calls, metadata: JSON.parse(readFileSync(config.metadataPath, "utf8")) }));
`;

describe("real preload metadata matches executed checks", () => {
  for (const ffi of ["off", "on"]) test(`isolated ${ffi} preload call trace agrees with its handshake`, () => {
    const directory = mkdtempSync(join(tmpdir(), "mad-dom-preload-metadata-"));
    const config = { root, image: fileIdentity(join(root, "build/mad-dom.node")), source: sourceManifest(root), ffi,
      bun: { ...fileIdentity(process.execPath), version: Bun.version, revision: Bun.revision }, metadataPath: join(directory, "metadata.json") };
    const env = { ...process.env, MAD_DOM_NATIVE_PATH: config.image.path, MAD_DOM_FFI_PATH: config.image.path,
      MAD_DOM_FFI_DISABLED: ffi === "on" ? "0" : "1", MAD_DOM_PERFORMANCE_CONFIG: JSON.stringify(config) };
    for (const key of Object.keys(env)) if (key.startsWith("MAD_DOM_TEST_")) delete env[key];
    const child = spawnSync(config.bun.path, ["-e", tracePreload], { cwd: root, env, encoding: "utf8" });
    if (child.status !== 0) throw new Error(child.stderr);
    const result = JSON.parse(child.stdout), { metadata, calls } = result;
    expect(result.lifecycle).toEqual({ created: 1, destroyed: 1 });
    expect(metadata.runtime.ffi.status).toBe(ffi === "on" ? "available" : "disabled");
    expect(metadata.artifact.path).toBe(config.image.path);
    expect(metadata.handshake).toContain("preload: verified native runtime/path");
    if (ffi === "on") {
      expect(calls["adapter.querySnapshot"]).toBe(1);
      expect(calls["adapter.serialize"]).toBe(1);
      expect(calls["NodeAPI.innerHTML"]).toBe(1);
      expect(calls["decode.calls"]).toBe(1);
      expect(metadata.handshake).toContain("real document query + full UTF-8 serialization");
      expect(metadata.handshake).toContain("document destroyed; same Node-API/FFI image");
    } else {
      expect(Object.keys(calls).filter(k => /^(adapter|NodeAPI)\./.test(k))).toEqual([]);
      expect(metadata.handshake).toContain("FFI explicitly disabled with null document binding");
      expect(metadata.handshake).toContain("real document created and destroyed");
      expect(metadata.handshake).not.toMatch(/query|serialization|UTF-8/);
    }
    // Keep the actual trace in the enclosing command's stdout evidence.
    console.log(JSON.stringify({ test: "isolated-preload-trace", ffi, ...result }));
  });
});
