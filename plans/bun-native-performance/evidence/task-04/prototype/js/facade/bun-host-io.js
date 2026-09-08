// Bun host IO capability gate (bun-native-runtime T5).
//
// One gate for every host-IO migration point (virtual-server `Bun.file`,
// sync-fetch `Bun.spawnSync`, checksums `Bun.file`/`Bun.write`): a Bun API is
// used only when the runtime exposes it AND `MAD_DOM_BUN_IO_DISABLED` has not
// forced the Node-compatible fallback. The override mirrors the
// `MAD_DOM_FFI_DISABLED` selector convention from the capability matrix
// (scripts/bun-capability-probe.mjs), so CI lanes and tests can exercise the
// fallback branch in place.

const DISABLED_PATTERN = /^(1|true|yes)$/i;

/**
 * Whether the named `Bun.*` host-IO API may be used on this runtime.
 *
 * @param {string} name - Bun API name ("file", "write", "spawnSync", ...).
 * @param {object} [env] - Environment to read the override from (tests).
 * @returns {boolean}
 */
export function bunHostIO(name, env = process.env) {
  if (DISABLED_PATTERN.test(String(env.MAD_DOM_BUN_IO_DISABLED ?? ""))) {
    return false;
  }
  return typeof globalThis.Bun?.[name] === "function";
}
