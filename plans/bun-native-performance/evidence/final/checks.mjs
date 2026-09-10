#!/usr/bin/env bun
// Task 05 T1 gated functional checks. Every leaf command runs under its own
// ordinary `activity.py --task 05 --kind build-test` reservation (never nested).
// Usage: bun plans/bun-native-performance/evidence/final/checks.mjs <batch> [--only=<regex>]
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
const FINAL = join(ROOT, "plans/bun-native-performance/evidence/final");
const CMDS = join(FINAL, "commands");
const LEDGER = join(CMDS, "commands.json");
const GATE = ["/usr/bin/python3", "/tmp/mad-dom-bun-native-performance-efaa64b/activity.py", "--task", "05", "--kind", "build-test", "--"];
const LANE = {
  baseline: "/tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun",
  latest: "/tmp/mad-dom-bun-performance-01/runtimes/latest/bun-linux-x64/bun",
};
const IMAGE = join(ROOT, "build/mad-dom.node");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function env(lane, ffi, extra = {}) {
  const dir = LANE[lane].slice(0, LANE[lane].lastIndexOf("/"));
  return {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    CARGO_TARGET_DIR: join(ROOT, "target"),
    MAD_DOM_NATIVE_PATH: IMAGE,
    MAD_DOM_FFI_PATH: IMAGE,
    ...(ffi === "off" ? { MAD_DOM_FFI_DISABLED: "1" } : { MAD_DOM_FFI_DISABLED: "0" }),
    ...extra,
  };
}

// [suites, ffiModes]: parent-process-FFI suites require FFI on; the loader
// off/partial/missing-symbol/ABI-mismatch/oversized coverage runs inside their
// child fixtures and via the full off-lane validate below.
const suites = [
  [["tests/bun/native-loader.test.js", "tests/bun/ffi-memory.test.js"], ["on"]],
  [["tests/bun/lazy-token-fast-path.test.js", "tests/bun/navigation-memo.test.js", "tests/bun/query-api.test.js"], ["on", "off"]],
  [["tests/bun/html-api.test.js", "tests/bun/nodelist-live.test.js"], ["on", "off"]],
  [["tests/bun/ffi-loader.test.js", "tests/bun/ffi-facade-hot-path.test.js", "tests/bun/safety.test.js"], ["on"]],
  [["tests/bun/ffi-fast-path.test.js"], ["on", "off"]],
  [["tests/bun/live-collections.test.js", "tests/bun/node-metadata-fast-path.test.js"], ["on", "off"]],
  [["tests/bun/bun-native-runtime-probe.test.js"], ["on", "off"]],
  [["tests/bun/gc.test.js"], ["on", "off"]],
];

const batches = { focused: [], validate: [], offGates: [], integration: [] };
for (const lane of ["baseline", "latest"]) for (const ffi of ["on", "off"]) {
  batches.focused.push(
    [`report-runtime-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "report:runtime"]],
    ...suites.filter(([, modes]) => modes.includes(ffi)).map(([files,], i) => [`native-suite-${files.map(f => f.replace(/^tests\/bun\//, "").replace(/\.test\.js$/, "")).join("+")}-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "test", ...files]]),
    [`selftest-boundary-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "bench:bun-native:selftest"]],
    [`selftest-io-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "bench:bun-io:selftest"]],
    [`selftest-probe-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "probe:bun:selftest"]],
    [`harness-bun-performance-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "test", "benchmark/bun-performance"]],
    [`harness-dom-bench-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "test", "benchmark/dom-bench/report.test.js", "benchmark/dom-bench/testing-worker.test.js"]],
  );
  batches.validate.push(
    [`hdunit-rewrite-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "compat:hdunit:rewrite"]],
    [`validate-${lane}-${ffi}`, env(lane, ffi), [LANE[lane], "run", "validate"]],
  );
  if (ffi === "off") batches.offGates.push(
    // The off-lane full `bun run test` step stops at parent-FFI-assumption tests
    // (see WORKLOG row 12); the remaining downstream validate gates run here so
    // the off-lane coverage is otherwise complete.
    [`offgate-ledger-${lane}`, env(lane, ffi), [LANE[lane], "run", "compat:ledger"]],
    [`offgate-hdunit-validate-${lane}`, env(lane, ffi), [LANE[lane], "run", "compat:hdunit:validate"]],
    [`offgate-wpt-${lane}`, env(lane, ffi), [LANE[lane], "run", "wpt:test"]],
  );
}
// Isolated file-dependency snapshot rules (benchmark/mad-dom-integration-test/README.md):
// reinstall the snapshot after any mad-dom JavaScript change, then run test:ci
// with both overrides pointed at this worktree's single image.
for (const lane of ["baseline", "latest"]) {
  batches.integration.push(
    [`integration-refresh-${lane}`, env(lane, "on"), [LANE[lane], "install", "--frozen-lockfile", "--cwd", "benchmark/mad-dom-integration-test"]],
    [`integration-testci-${lane}`, env(lane, "on"), [LANE[lane], "run", "test:integration"]],
  );
}
// bench:check is timing-sensitive: it runs inside campaign-all.mjs under the
// single task-05 sampling reservation, never here under build-test.

mkdirSync(CMDS, { recursive: true });
if (!existsSync(LEDGER)) writeFileSync(LEDGER, "[]\n");
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const batch = process.argv[2];
const only = /--only=(.+)/.exec(process.argv.slice(3).join(" "))?.[1];
if (!batch || !(batch in batches)) { console.error(`batch must be one of ${Object.keys(batches)}`); process.exit(2); }
let failures = 0;
for (const [label, e, argv] of batches[batch]) {
  if (only && !new RegExp(only).test(label)) continue;
  const seq = String(ledger.length + 1).padStart(3, "0");
  const out = join(CMDS, `${seq}-${label}.stdout.log`), err = join(CMDS, `${seq}-${label}.stderr.log`);
  const started = new Date().toISOString();
  const done = Bun.spawnSync([GATE[0], ...GATE.slice(1), ...argv], { cwd: ROOT, env: e, stdin: "ignore" });
  const exit = done.exitCode;
  writeFileSync(out, done.stdout.length ? Buffer.from(done.stdout) : "");
  writeFileSync(err, done.stderr.length ? Buffer.from(done.stderr) : "");
  const entry = { seq: Number(seq), batch, label, argv, cwd: ROOT,
    laneEnv: { laneBunDir: e.PATH.split(":")[0], MAD_DOM_FFI_DISABLED: e.MAD_DOM_FFI_DISABLED, MAD_DOM_NATIVE_PATH: e.MAD_DOM_NATIVE_PATH, MAD_DOM_FFI_PATH: e.MAD_DOM_FFI_PATH, CARGO_TARGET_DIR: e.CARGO_TARGET_DIR },
    startedAt: started, endedAt: new Date().toISOString(), exitCode: exit,
    gate: { wrapper: "/tmp/mad-dom-bun-native-performance-efaa64b/activity.py", task: "05", kind: "build-test" },
    stdout: { file: out, bytes: statSync(out).size, sha256: sha256(readFileSync(out)) },
    stderr: { file: err, bytes: statSync(err).size, sha256: sha256(readFileSync(err)) } };
  ledger.push(entry); writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`${seq} ${label} exit=${exit}`);
  if (exit !== 0) failures++;
}
console.log(JSON.stringify({ batch, failures }));
process.exitCode = failures ? 1 : 0;
