import { createRequire } from "node:module";

import { bunHostIO } from "./bun-host-io.js";

const requireNode = createRequire(import.meta.url);

// Child `bun` script for the sync send path: performs the fetch and prints a
// JSON envelope (status / statusText / final URL / raw headers / base64 body).
// `disableStrictSSL` mirrors the happy-dom `SyncFetchScriptBuilder` contract:
// the child transport relaxes TLS verification when the window settings ask
// for it.
const SYNC_FETCH_SCRIPT = `
const payload = JSON.parse(process.argv[1]);
const { method, url, headers, body, credentials, referrer, disableStrictSSL } = payload;
(async () => {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : Buffer.from(body, "base64"),
      redirect: "follow",
      ...(disableStrictSSL ? { tls: { rejectUnauthorized: false } } : {}),
    });
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const headerEntries = {};
    for (const [key, value] of response.headers) headerEntries[key] = value;
    console.log(JSON.stringify({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: headerEntries,
      body: bodyBuffer.toString("base64"),
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
  }
})();
`;

// Bun-native transport (T5): `Bun.spawnSync` keeps the synchronous send off
// the node:child_process compat layer. The Node-compatible `spawnSync`
// fallback is loaded lazily so Bun never touches it, and produces the same
// normalized shape: { error, stdout, exitCode, signal, stderr }.
//
// Both transports cap child output the same way: node:child_process enforces
// it as `maxBuffer`, and `Bun.spawnSync` accepts the same `maxBuffer` option
// and kills the child (`exitedDueToMaxBuffer`, SIGTERM) when stdout or stderr
// exceeds it — so neither transport lets a runaway child buffer without bound.
export const SYNC_FETCH_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

let nodeSpawnSync;

function resolveNodeSpawnSync() {
  nodeSpawnSync ??= requireNode("node:child_process").spawnSync;
  return nodeSpawnSync;
}

/**
 * Spawns the sync-fetch child through either the Bun-native or the
 * node:child_process transport and normalizes the outcome.
 *
 * `options.env` defaults to `process.env`. It is threaded explicitly because
 * `Bun.spawnSync` otherwise snapshots the environment at process startup and
 * would ignore runtime `process.env` changes (e.g. the `MAD_DOM_BUN_IO_DISABLED`
 * test lane). `options.maxOutputBytes` mirrors the node `maxBuffer` ceiling.
 */
export function runSyncFetchChild(args, { env = process.env, maxOutputBytes = SYNC_FETCH_MAX_OUTPUT_BYTES } = {}) {
  if (bunHostIO("spawnSync")) {
    try {
      const proc = Bun.spawnSync([process.execPath, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env,
        maxBuffer: maxOutputBytes,
      });
      // `maxBuffer` makes Bun kill the child the moment stdout OR stderr
      // crosses the ceiling (exitedDueToMaxBuffer + SIGTERM). The byte-length
      // guard is a belt-and-braces check for runtimes that report the flag
      // differently; both normalize to the same `{ error }` shape.
      const rawOut = proc.stdout ?? new Uint8Array(0);
      if (proc.exitedDueToMaxBuffer === true || rawOut.byteLength > maxOutputBytes) {
        return {
          error: new Error(
            `sync fetch transport output exceeds the ${maxOutputBytes}-byte limit`,
          ),
          stdout: "",
          exitCode: null,
          signal: null,
          stderr: "",
        };
      }
      return {
        error: null,
        stdout: rawOut.toString(),
        exitCode: proc.exitCode,
        signal: proc.signalCode ?? null,
        stderr: proc.stderr?.toString() ?? "",
      };
    } catch (error) {
      // Bun.spawnSync throws synchronously (e.g. the binary is missing);
      // keep the `{ error }` shape the fallback uses.
      return { error, stdout: "", exitCode: null, signal: null, stderr: "" };
    }
  }
  const proc = resolveNodeSpawnSync()(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: maxOutputBytes,
    env,
  });
  if (proc.error) {
    // node spawnSync can return partial stdout/stderr on ENOBUFS; drop both so
    // the normalized shape matches the Bun path (which blanks output on
    // overflow).
    return { error: proc.error, stdout: "", exitCode: null, signal: proc.signal ?? null, stderr: "" };
  }
  return {
    error: null,
    stdout: proc.stdout ?? "",
    exitCode: proc.status,
    signal: proc.signal ?? null,
    stderr: proc.stderr ?? "",
  };
}

export function syncFetch(windowFacade, method, url, requestHeaders, body) {
  const payload = {
    method,
    url,
    headers: Object.fromEntries(requestHeaders),
    body: body === null ? null : Buffer.from(body).toString("base64"),
    disableStrictSSL: windowFacade.happyDOM?.settings?.fetch?.disableStrictSSL ?? false,
  };
  const proc = runSyncFetchChild(["-e", SYNC_FETCH_SCRIPT, JSON.stringify(payload)]);
  if (proc.error) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${proc.error.message}`, "NetworkError");
  }
  let result;
  try {
    result = JSON.parse(proc.stdout);
  } catch {
    // The child died (or printed garbage) before the JSON envelope: surface
    // the exit code / signal and the first stderr line instead of a raw
    // SyntaxError.
    const outcome =
      proc.exitCode !== null && proc.exitCode !== undefined
        ? `exited with code ${proc.exitCode}`
        : proc.signal
          ? `was killed by ${proc.signal}`
          : "did not exit cleanly";
    const detail = proc.stderr.trim().split("\n")[0];
    throw new windowFacade.DOMException(
      `Failed to execute "send()": sync fetch transport ${outcome} before returning a response${detail ? ` (${detail})` : ""}`,
      "NetworkError",
    );
  }
  if (!result.ok) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${result.error}`, "NetworkError");
  }
  return result;
}
