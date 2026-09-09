// Off-lane test-robustness validation driver (post-merge followup on
// bun-native-performance todo 05 T1). Invoke through the ordinary activity.py
// build-test gate, one stage per reservation, e.g.
//
//   python3 /tmp/mad-dom-bun-native-performance-efaa64b/activity.py \
//     --task 06-offlane --kind build-test -- \
//     <lane bun> plans/bun-native-performance/evidence/offlane-test-robustness/validate.mjs setup
//
// Stages: setup | before-suites-off | suites | validate-latest | validate-baseline | summary.
// Every command is retained under commands/ (full stdout/stderr, exit, hashes)
// by the shared recorded-command ledger; a failing step stops the stage but
// keeps its logs. Nothing here rewrites historical evidence, and no timed
// sample is produced or claimed: this task validates test robustness, not
// performance.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
import { fileIdentity } from "../../../../benchmark/bun-performance/provenance.mjs";

const directory = import.meta.dir, root = resolve(directory, "../../../..");
const commands = join(directory, "commands");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const stage = process.argv[2];
// `main` at the start of this followup: the composition todo 05 measured.
const baseCommit = "09c6a68edfd4a6929c3c404222a11a518f75f095";
const suites = [
  "tests/bun/ffi-loader.test.js",
  "tests/bun/ffi-facade-hot-path.test.js",
  "tests/bun/ffi-memory.test.js",
  "tests/bun/release-metadata.test.js",
];
// The 16 suite members todo 05 recorded as colliding with a global
// MAD_DOM_FFI_DISABLED=1 (commands/065 and /069 of evidence/final), extracted
// verbatim from the copied logs; the before-run must reproduce exactly those names.
const beforeReference = json(join(directory, "before-05-failures.json"));
const expectedBeforeFailures = beforeReference.count;
// The two pinned runtimes of the todo-05 matrix, identified by the immutable
// task-01 reference manifest (path, sha256, version, revision).
const frozen = json(join(root, "plans/bun-native-performance/evidence/baseline/reference-manifest.json"));
const lanes = Object.entries(frozen.runtimes).map(([lane, runtime]) => ({ lane, ...runtime }));
const laneOf = (name) => lanes.find((entry) => entry.lane === name);
const image = join(root, "build/mad-dom.node");
const results = existsSync(join(directory, "state.json"))
  ? json(join(directory, "state.json"))
  : { stage: null, commands: [] };

function run(label, command, bun, ffiDisabled, expectedExit = 0) {
  const record = recordedCommand(commands, label, command, root, {
    PATH: `${dirname(bun)}:${process.env.PATH}`,
    RUSTUP_TOOLCHAIN: "1.93.1",
    CARGO_TARGET_DIR: join(root, "target"),
    MAD_DOM_NATIVE_PATH: image,
    MAD_DOM_FFI_PATH: image,
    MAD_DOM_FFI_DISABLED: ffiDisabled,
  });
  results.commands.push({
    seq: results.commands.length + 1, label, exit: record.exitCode, signal: record.signal,
    error: record.error, stdout: record.stdout.file, stderr: record.stderr.file,
    expectedExit,
  });
  writeFileSync(join(directory, "state.json"), JSON.stringify(results, null, 2) + "\n");
  assert.ok(record.exitCode === expectedExit && record.signal === null && record.error === null,
    `${label} exited ${record.exitCode}, expected ${expectedExit}; full output retained under commands/`);
  return record;
}
const streamText = (record, stream) => readFileSync(join(commands, record[stream].file), "utf8");

if (stage === "setup") {
  // Resumable: each recorded command persists in state.json before the next one
  // starts, so a re-run after a failure repeats only what is still missing.
  const identity = () => {
    const branch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    assert.equal(branch.status, 0);
    results.repository = { branch: branch.stdout.trim(), head: head.stdout.trim() };
    const baseline = laneOf("baseline").path;
    results.bunVersionFile = readFileSync(join(root, ".bun-version"), "utf8").trim();
    assert.equal(results.bunVersionFile, laneOf("baseline").version);
    assert.match(streamText(run("rust-toolchain", ["rustc", "--version"], baseline, "0"), "stdout"), /^rustc 1\.93\.1 /);
    results.runtimes = {};
    for (const { lane, path, sha256, version, revision } of lanes) {
      assert.equal(fileIdentity(path).sha256, sha256, `${lane} executable drifted from the task-01 manifest`);
      const observed = JSON.parse(streamText(run(`${lane}-runtime-identity`, [path, "-e",
        "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision}))"], path, "0"), "stdout"));
      assert.equal(observed.version, version);
      assert.equal(observed.revision, revision);
      results.runtimes[lane] = { path, sha256, version, revision, observed };
    }
    return baseline;
  };
  const baseline = identity();
  if (!results.install) {
    for (const name of ["node_modules", "build", "target"]) {
      assert.equal(existsSync(join(root, name)), false, `fresh ${name}/ required for an independent build`);
    }
    const lockBefore = fileIdentity(join(root, "bun.lock")).sha256;
    run("install", [baseline, "install", "--frozen-lockfile"], baseline, "0");
    assert.equal(fileIdentity(join(root, "bun.lock")).sha256, lockBefore, "bun.lock must not change");
    results.install = { lockSha256: lockBefore };
  }
  if (!results.artifact) {
    run("build", [baseline, "run", "dev:build"], baseline, "0");
    results.artifact = fileIdentity(image);
    results.ffiImage = fileIdentity(join(root, "build/mad-dom-ffi.so"));
    // build.sh keeps one inode for both names: the C ABI registry belongs to the
    // loaded image, so a byte copy would be a disconnected second registry.
    assert.equal(`${results.ffiImage.dev}:${results.ffiImage.inode}`, `${results.artifact.dev}:${results.artifact.inode}`);
  }
} else if (stage === "before-suites-off") {
  // Only meaningful while the four suite files are at their pre-fix contents, so
  // this stage temporarily restores them from the base commit, reproduces the todo-05
  // collision in this checkout and environment, and puts the fix back. The
  // restore runs even if the measurement below fails.
  assert.equal(results.stage, "setup", "run install/build first");
  // The pre-fix contents are read from the todo-05 composition itself, not from
  // HEAD, so this stage can never measure the fixed files by accident (and keeps
  // working after this followup's own commit).
  const atBase = (file) => {
    const shown = spawnSync("git", ["show", `${baseCommit}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(shown.status, 0, `git show ${baseCommit}:${file} failed: ${shown.stderr}`);
    return shown.stdout;
  };
  const saved = suites.map((file) => [file, readFileSync(join(root, file), "utf8")]);
  results.beforeFailures = {};
  try {
    for (const [file, content] of saved) {
      const pre = atBase(file);
      assert.notEqual(pre, content, `${file} is already at its pre-fix contents; nothing to reproduce`);
      writeFileSync(join(root, file), pre);
    }
    for (const { lane, path } of lanes) {
      const record = run(`${lane}-before-suites-off`, [path, "test", ...suites], path, "1", 1);
      const failed = [...streamText(record, "stderr").matchAll(/^\(fail\) (.+?)(?: \[[0-9.]+ms\])?$/gm)]
        .map((match) => match[1].trim());
      assert.equal(failed.length, expectedBeforeFailures, `${lane} before-run failure names:\n${failed.join("\n")}`);
      assert.deepEqual(failed.slice().sort(), beforeReference.byLane[lane].slice().sort(),
        `${lane} before-run failure set differs from the todo-05 record`);
      results.beforeFailures[lane] = { exit: 1, failed };
      writeFileSync(join(directory, "state.json"), JSON.stringify(results, null, 2) + "\n");
    }
  } finally {
    for (const [file, content] of saved) writeFileSync(join(root, file), content);
  }
} else if (stage === "suites") {
  assert.ok(["setup", "before-suites-off"].includes(results.stage), "run install/build first");
  // The four FFI-assuming suites per pinned runtime, in both ambient modes,
  // plus the repo's own `check` entry point.
  for (const { lane, path } of lanes) {
    for (const [suffix, mode] of [["on", "0"], ["off", "1"]]) {
      run(`${lane}-check-${suffix}`, [path, "run", "check"], path, mode);
      run(`${lane}-suites-${suffix}`, [path, "test", ...suites], path, mode);
    }
  }
} else if (stage === "validate-latest" || stage === "validate-baseline") {
  const lane = stage === "validate-latest" ? "latest" : "baseline";
  const { path } = laneOf(lane);
  assert.ok(["suites", "validate-latest"].includes(results.stage),
    `run install/build and the suites stage first (state stage is ${results.stage})`);
  for (const [suffix, mode] of [["on", "0"], ["off", "1"]]) {
    // todo 05 ran the hdunit rewrite in front of every validate; keep the
    // same procedure so the two records are comparable.
    run(`${lane}-hdunit-rewrite-${suffix}`, [path, "run", "compat:hdunit:rewrite"], path, mode);
    run(`${lane}-validate-${suffix}`, [path, "run", "validate"], path, mode);
  }
} else if (stage === "summary") {
  const required = lanes.flatMap(({ lane }) => [`${lane}-suites-on`, `${lane}-suites-off`,
    `${lane}-check-on`, `${lane}-check-off`]).concat("latest-validate-on", "latest-validate-off");
  // The baseline full validate is included when it was run here; todo 05's
  // coordinator re-verifies the baseline off lane otherwise.
  if (results.commands.some((entry) => entry.label.startsWith("baseline-validate"))) {
    required.push("baseline-validate-on", "baseline-validate-off");
  }
  const done = new Set(results.commands.map((entry) => entry.label));
  for (const label of required) assert.ok(done.has(label), `missing recorded command: ${label}`);
  const failures = results.commands.filter((entry) => entry.exit !== entry.expectedExit || entry.signal || entry.error);
  assert.equal(failures.length, 0, `unexpected failures: ${JSON.stringify(failures)}`);
  const summaries = {};
  const countsOf = (text) => text.split("\n")
    .filter((line) => /^\s*\d+ (?:pass|fail|skip|error)s?\b/.test(line)).map((line) => line.trim());
  for (const entry of results.commands.filter((item) =>
    /(?:suites|validate)-(?:on|off)$/.test(item.label) && !item.label.includes("before"))) {
    // bun:test writes its summary to stderr, so both streams are scanned.
    summaries[entry.label] = {
      exit: entry.exit,
      counts: countsOf(streamText({ stdout: { file: entry.stdout }, stderr: { file: entry.stderr } }, "stdout"))
        .concat(countsOf(streamText({ stdout: { file: entry.stdout }, stderr: { file: entry.stderr } }, "stderr"))),
    };
  }
  results.summary = {
    at: new Date().toISOString(),
    suites,
    recordedCommands: results.commands.length,
    unexpectedFailures: failures.length,
    beforeFailuresReproduced: Object.fromEntries(Object.entries(results.beforeFailures ?? {})
      .map(([lane, entry]) => [lane, entry.failed.length])),
    afterSummaries: summaries,
  };
} else {
  throw new Error(`unknown stage: ${stage}`);
}
results.stage = stage;
writeFileSync(join(directory, "state.json"), JSON.stringify(results, null, 2) + "\n");
console.log(`${stage}: OK (${results.commands.length} recorded commands)`);
