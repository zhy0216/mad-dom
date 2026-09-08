// Sequential post-campaign verification. Do not run alongside sampling.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";
const directory = import.meta.dir, root = resolve(directory, "../../../..");
const frozen = JSON.parse(readFileSync(join(directory, "reference-manifest.json"), "utf8"));
const runner = join(root, "benchmark/bun-performance/run.mjs");
function run(lane, label, args) {
  const bun = frozen.runtimes[lane].path, image = join(root, "build/mad-dom.node");
  const result = recordedCommand(join(directory, "commands"), label, [bun, ...args], root, {
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
    PATH: `${dirname(bun)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1",
  });
  if (result.exitCode !== 0 || result.signal || result.error) throw new Error(`${label} failed; full command output retained`);
}
run("baseline", "post-campaign-integrity", [join(directory, "integrity.mjs")]);
run("latest", "latest-harness-tests", ["test", "benchmark/bun-performance"]);
for (const lane of ["baseline", "latest"]) {
  run(lane, `${lane}-check`, ["run", "check"]);
  run(lane, `${lane}-help`, [runner, "--help"]);
  const bun = frozen.runtimes[lane].path;
  for (const mode of ["reference", "source-on", "source-off"]) {
    const label = `${lane}-final-${mode}-smoke`;
    run(lane, label, [runner, "--bun", bun, "--reference-root", frozen.source.root,
      "--reference-image", frozen.artifact.path, "--smoke", "--out", join(directory, label),
      ...(mode === "reference" ? [] : ["--mode", "source", "--ffi", mode.slice(7), "--candidate-root", root, "--candidate-image", frozen.taskArtifact.path])]);
  }
}
for (const entry of readdirSync(directory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^(baseline|latest)-/.test(entry.name)) continue;
  const lane = entry.name.startsWith("baseline") ? "baseline" : "latest";
  run(lane, `verify-${entry.name}`, [runner, "--verify", join(directory, entry.name)]);
}
for (const name of ["smoke-development-01", "diagnostic-development"]) run("baseline", `verify-${name}`, [runner, "--verify", join(directory, name)]);
run("latest", "historical-gate-reference-copy", [join(directory, "historical-gate-reference.mjs")]);
run("latest", "latest-io-selftest", ["run", "bench:bun-io:selftest"]);
run("latest", "latest-bench-check", ["run", "bench:check"]);
run("baseline", "final-reference-integrity", [join(directory, "integrity.mjs")]);
