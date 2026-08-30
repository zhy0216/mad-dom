// Loader probe fixture (T49). Imports the shared runtime loader in an isolated
// child process and reports whether the native module loaded, or the stable
// error contract (`code` + `message`) when it did not. Driven by
// tests/bun/native-loader.test.js with per-scenario env overrides.
import { loadNative } from "../../../js/native-loader.js";

let out;
try {
  const native = loadNative();
  out = { loaded: true, abi: typeof native?.abiVersion === "function" ? native.abiVersion() : null };
} catch (error) {
  out = { loaded: false, code: error?.code ?? null, message: error?.message ?? String(error) };
}
console.log("PROBE " + JSON.stringify(out));
