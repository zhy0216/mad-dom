import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { recordedCommand } from "../../../../benchmark/bun-performance/command.mjs";

const root = resolve(import.meta.dir, "../../../..");
const { runtimes } = JSON.parse(readFileSync(join(import.meta.dir, "runtimes.json")));
const [lane, phase = "all", suffix = ""] = process.argv.slice(2);
const runtime = runtimes[lane];
if (!runtime) throw new Error("validation.mjs baseline|latest [native|all|gate] [suffix]");
const commands = [
  ...(phase === "native" ? [] : [["hdunit-prepare", ["run", "compat:hdunit:rewrite"]]]),
  ["check", ["run", "check"]],
  ["runtime", ["run", "report:runtime"]],
  ["loader-memory", ["test", "tests/bun/native-loader.test.js", "tests/bun/ffi-memory.test.js"]],
  ["navigation-query", ["test", "tests/bun/lazy-token-fast-path.test.js", "tests/bun/navigation-memo.test.js", "tests/bun/query-api.test.js"]],
  ["html-live", ["test", "tests/bun/html-api.test.js", "tests/bun/nodelist-live.test.js"]],
  ["capability-facade-worker", ["test", "tests/bun/ffi-loader.test.js", "tests/bun/ffi-facade-hot-path.test.js", "tests/bun/safety.test.js"]],
  ["boundary-selftest", ["run", "bench:bun-native:selftest"]],
  ...(phase === "native" ? [] : [["validate", ["run", "validate"]]]),
].filter(([name]) => phase !== "gate" || ["hdunit-prepare", "validate"].includes(name));
let failed = false;
for (const [name, args] of commands) {
  const image = join(root, "build/mad-dom.node");
  const result = recordedCommand(join(import.meta.dir, "commands"), `${lane}-${name}${suffix}`, [runtime.path, ...args], root, {
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
    PATH: `${dirname(runtime.path)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1", CARGO_TARGET_DIR: join(root, "target"),
  });
  if (result.exitCode !== 0 || result.signal || result.error) failed = true;
}
process.exitCode = failed ? 1 : 0;
