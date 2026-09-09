import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evidence, root, run, save } from "./command.mjs";

const { runtimes } = JSON.parse(readFileSync(join(evidence, "runtimes.json"), "utf8"));
const stage = process.argv[2] ?? "focused";
const selected = new Set(stage === "all" ? ["focused", "rust", "bun-focused", "bun-full", "asan"] : [stage]);
if ([...selected].some(x => !["focused", "rust", "bun-focused", "bun-full", "asan"].includes(x))) throw new Error(`Unknown stage: ${stage}`);
const commands = [];
if (selected.has("focused")) {
  commands.push(["format", ["cargo", "fmt"]],
    ["rust-ffi", ["cargo", "test", "-p", "mad-dom-bun", "ffi::"]],
    ["rust-checked-fill", ["cargo", "test", "-p", "mad-dom-bun", "checked_snapshot_fill"]],
    ["candidate-build", [runtimes.baseline.path, "run", "dev:build"]]);
}
if (selected.has("rust")) {
  commands.push(["rust-version", ["rustc", "--version", "--verbose"]],
    ["fmt-check", ["cargo", "fmt", "--check"]],
    ["clippy", ["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
    ["workspace-tests", ["cargo", "test", "--workspace"]],
    ["core-safety", ["bash", "scripts/check-core-safety.sh"]]);
}
for (const bunStage of ["bun-focused", "bun-full"].filter(x => selected.has(x))) {
  for (const [lane, { path }] of Object.entries(runtimes)) {
    const lists = bunStage === "bun-focused" ? [
      ["check", ["run", "check"]], ["runtime", ["run", "report:runtime"]],
      ["ffi-tests", ["test", "tests/bun/ffi-fast-path.test.js", "tests/bun/ffi-memory.test.js", "tests/bun/native-loader.test.js"]],
      ["identity-tests", ["test", "tests/bun/lazy-token-fast-path.test.js", "tests/bun/navigation-memo.test.js"]],
      ["native-selftest", ["run", "bench:bun-native:selftest"]],
    ] : [
      ["harness-tests", ["test", "benchmark/bun-performance", "benchmark/dom-bench/report.test.js", "benchmark/dom-bench/testing-worker.test.js"]],
      ["rewrite-prepare", ["run", "compat:hdunit:rewrite"]],
      ["validate", ["run", "validate"]],
      ["io-selftest", ["run", "bench:bun-io:selftest"]],
    ];
    for (const [label, args] of lists) commands.push([`${lane}-${label}`, [path, ...args]]);
  }
}
if (selected.has("asan")) {
  commands.push(["asan-ffi-tests", ["env", "RUSTUP_TOOLCHAIN=1.93.1", "RUSTC_BOOTSTRAP=1", "RUSTFLAGS=-Zsanitizer=address",
    `CARGO_TARGET_DIR=${join(root, "target/asan")}`, "cargo", "test", "-p", "mad-dom-bun", "--target", "x86_64-unknown-linux-gnu", "--lib", "ffi::"]]);
}
commands.push(["static-verification", [runtimes.baseline.path, "plans/bun-native-performance/evidence/task-02/static-verification.mjs"]]);
const results = [];
for (const [label, command] of commands) {
  const result = run(label, command);
  results.push({ id: result.id, exitCode: result.exitCode });
  save(`checks-${stage}.json`, results);
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}
