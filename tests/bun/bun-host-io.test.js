import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test, beforeAll, afterAll } from "bun:test";

import { isNativeAvailable, Window } from "../../index.js";
import { bunHostIO } from "../../js/facade/bun-host-io.js";
import { virtualServerResponse } from "../../js/facade/virtual-server.js";
import { runSyncFetchChild, syncFetch, SYNC_FETCH_MAX_OUTPUT_BYTES } from "../../js/facade/sync-fetch.js";
import { IO_BENCH_SCHEMA, assertBunIOReport, runBunIOBenchmark } from "../../scripts/bench-bun-io.mjs";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CHECKSUMS = join(REPO_ROOT, "scripts", "checksums.mjs");
const RESPONDER = join(import.meta.dir, "fixtures", "http-responder.mjs");
const nativeAvailable = isNativeAvailable();
const IO_KEY = "MAD_DOM_BUN_IO_DISABLED";

// --- helpers ----------------------------------------------------------------

function ioEnv(mode) {
  if (mode === "fallback") return { ...process.env, [IO_KEY]: "1" };
  const env = { ...process.env };
  delete env[IO_KEY];
  return env;
}

// Synchronous body (XHR / syncFetch / child transport): the transport select
// happens during the call, so the override is scoped around the sync call.
function withIO(mode, fn) {
  const prev = process.env[IO_KEY];
  if (mode === "fallback") process.env[IO_KEY] = "1";
  else delete process.env[IO_KEY];
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[IO_KEY];
    else process.env[IO_KEY] = prev;
  }
}

// Asynchronous body (virtual-server reads): keep the override live until the
// awaited work has actually finished.
async function withIOAsync(mode, fn) {
  const prev = process.env[IO_KEY];
  if (mode === "fallback") process.env[IO_KEY] = "1";
  else delete process.env[IO_KEY];
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[IO_KEY];
    else process.env[IO_KEY] = prev;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBody(response) {
  return Buffer.from(await response.arrayBuffer());
}

async function readBodyStream(response) {
  const reader = response.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function syncFetchStub({ disableStrictSSL = false } = {}) {
  return {
    DOMException: globalThis.DOMException,
    happyDOM: { settings: { fetch: { disableStrictSSL } } },
  };
}

function runChecksums(bin, args, extraEnv = {}) {
  return spawnSync(bin, [CHECKSUMS, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
}

async function startResponder({ tls } = {}) {
  const args = tls ? [RESPONDER, "--tls", tls.cert, tls.key] : [RESPONDER];
  const child = Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  const chunk = await new Promise((resolve, reject) => {
    child.stdout.getReader().read().then(({ value }) => resolve(new TextDecoder().decode(value)), reject);
  });
  const match = /^READY (\S+)/.exec(chunk);
  if (!match) {
    child.kill();
    throw new Error(`responder failed to start: ${chunk}`);
  }
  return {
    base: match[1].replace(/\/$/, ""),
    exited: child.exited,
    stop: async () => {
      child.kill();
      await child.exited;
    },
  };
}

function opensslAvailable() {
  return process.platform !== "win32" && spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;
}

function generateSelfSigned(dir) {
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  const proc = spawnSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
      "-days", "2", "-nodes", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (proc.status !== 0) throw new Error(`openssl failed: ${proc.stderr}`);
  return { cert, key };
}

// --- capability gate ---------------------------------------------------------

describe("bunHostIO capability gate (T5)", () => {
  test("reports the Bun APIs this runtime exposes and nothing else", () => {
    expect(typeof globalThis.Bun?.file).toBe("function");
    expect(typeof globalThis.Bun?.write).toBe("function");
    expect(typeof globalThis.Bun?.spawnSync).toBe("function");
    expect(typeof globalThis.Bun?.CryptoHasher).toBe("function");
    expect(bunHostIO("file")).toBe(true);
    expect(bunHostIO("write")).toBe(true);
    expect(bunHostIO("spawnSync")).toBe(true);
    expect(bunHostIO("CryptoHasher")).toBe(true);
    expect(bunHostIO("not-a-real-bun-api")).toBe(false);
  });

  test("the override env forces the Node-compatible fallback per call", () => {
    for (const truthy of ["1", "true", "yes"]) {
      expect(bunHostIO("file", { MAD_DOM_BUN_IO_DISABLED: truthy })).toBe(false);
      expect(bunHostIO("spawnSync", { MAD_DOM_BUN_IO_DISABLED: truthy })).toBe(false);
      expect(bunHostIO("write", { MAD_DOM_BUN_IO_DISABLED: truthy })).toBe(false);
    }
    for (const falsy of ["0", "false", "no", ""]) {
      expect(bunHostIO("file", { MAD_DOM_BUN_IO_DISABLED: falsy })).toBe(true);
    }
    expect(bunHostIO("file", {})).toBe(true);
  });
});

// --- virtual server file IO --------------------------------------------------

describe("virtual server file IO (T5)", () => {
  let directory = "";
  const FILES = {};

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "mad-dom-vs-t5-"));
    const rootIndex = Buffer.from('<html><head><title>Root</title></head><body>root-index</body></html>', "utf8");
    const subIndex = Buffer.from('<html><head><title>Sub</title></head><body>sub-index</body></html>', "utf8");
    writeFileSync(join(directory, "index.html"), rootIndex);
    mkdirSync(join(directory, "sub"));
    writeFileSync(join(directory, "sub", "index.html"), subIndex);
    const large = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < large.length; i++) large[i] = (i * 29 + 11) & 0xff;
    writeFileSync(join(directory, "large.bin"), large);
    FILES["/"] = { bytes: rootIndex };
    FILES["/sub/"] = { bytes: subIndex };
    FILES["/large.bin"] = { bytes: large };
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  async function snapshot(mode, requestURL) {
    return withIOAsync(mode, async () => {
      const response = await virtualServerResponse(
        [{ url: "https://vs.local", directory }],
        requestURL,
        "https://vs.local/",
      );
      const bytes = await readBody(response);
      return {
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type"),
        bytes: bytes.length,
        sha: sha256(bytes),
        first: bytes[0],
        last: bytes[bytes.length - 1],
      };
    });
  }

  test("Bun.file#stat exposes the directory probe this runtime relies on", async () => {
    const file = Bun.file(directory);
    expect(typeof file.stat).toBe("function");
    expect((await file.stat()).isDirectory()).toBe(true);
    expect((await Bun.file(join(directory, "index.html")).stat()).isDirectory()).toBe(false);
    await expect(Bun.file(join(directory, "does-not-exist")).stat()).rejects.toThrow();
  });

  // Static path list so these cases are registered at module scope; FILES is
  // populated in beforeAll and read inside each test body.
  for (const path of ["/", "/sub/", "/large.bin"]) {
    test(`file/directory serving is identical on the Bun and Node paths: ${path}`, async () => {
      const { bytes } = FILES[path];
      const bun = await snapshot("bun", `https://vs.local${path}`);
      const fallback = await snapshot("fallback", `https://vs.local${path}`);
      expect(fallback).toEqual(bun);
      expect(bun.status).toBe(200);
      expect(bun.url).toBe(`https://vs.local${path}`);
      expect(bun.bytes).toBe(bytes.length);
      expect(bun.sha).toBe(sha256(bytes));
    });
  }

  test("virtual server file IO fixtures cover root index, sub-directory index and a large binary file", () => {
    expect(Object.keys(FILES).sort()).toEqual(["/", "/large.bin", "/sub/"]);
  });

  test("404 keeps the happy-dom page, status, content type and request URL on both paths", async () => {
    const bun = await snapshot("bun", "https://vs.local/missing.html");
    const fallback = await snapshot("fallback", "https://vs.local/missing.html");
    expect(fallback).toEqual(bun);
    expect(bun.status).toBe(404);
    expect(bun.url).toBe("https://vs.local/missing.html");
    expect(bun.contentType).toBe("text/html");
    expect(new TextDecoder().decode(await readBody(await withIOAsync("bun", async () => (
      virtualServerResponse([{ url: "https://vs.local", directory }], "https://vs.local/missing.html", "https://vs.local/")
    ))))).toContain("Happy DOM Virtual Server - 404 Not Found");
  });

  test("large-file bytes arrive intact through the Response body stream", async () => {
    const large = FILES["/large.bin"].bytes;
    const bun = await withIOAsync("bun", () =>
      virtualServerResponse([{ url: "https://vs.local", directory }], "https://vs.local/large.bin", "https://vs.local/"));
    const fallback = await withIOAsync("fallback", () =>
      virtualServerResponse([{ url: "https://vs.local", directory }], "https://vs.local/large.bin", "https://vs.local/"));
    const streamed = await readBodyStream(bun);
    const buffered = await readBody(fallback);
    expect(streamed.length).toBe(large.length);
    expect(buffered.length).toBe(large.length);
    expect(sha256(streamed)).toBe(sha256(large));
    expect(sha256(buffered)).toBe(sha256(large));
  });
});

// --- sync fetch child transport ----------------------------------------------

describe("sync fetch child transport (T5)", () => {
  test("a clean child round-trips identically on the Bun and Node transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "console.log('{\"ok\":1}')"], { env: ioEnv(mode) }));
      expect(proc.error).toBeNull();
      expect(proc.exitCode).toBe(0);
      expect(proc.signal).toBeNull();
      expect(JSON.parse(proc.stdout)).toEqual({ ok: 1 });
    }
  });

  test("a nonzero exit surfaces as a normalized exitCode on both transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "process.exit(7)"], { env: ioEnv(mode) }));
      expect(proc.error).toBeNull();
      expect(proc.exitCode).toBe(7);
      expect(proc.signal).toBeNull();
      expect(proc.stdout).toBe("");
    }
  });

  test("a fatal signal surfaces as exitCode null + the signal name on both transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "process.kill(process.pid, 'SIGKILL')"], { env: ioEnv(mode) }));
      expect(proc.exitCode).toBeNull();
      expect(proc.signal).toBe("SIGKILL");
    }
  });

  test("output over the shared ceiling is an error on both transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "console.log('x'.repeat(4096))"], {
          env: ioEnv(mode),
          maxOutputBytes: 128,
        }));
      expect(proc.error).toBeInstanceOf(Error);
      expect(proc.stdout).toBe("");
    }
  });

  test("an oversized stderr also caps the child early on both transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "console.error('e'.repeat(4096))"], {
          env: ioEnv(mode),
          maxOutputBytes: 128,
        }));
      // maxBuffer applies to stderr too: Bun kills the child and the node
      // fallback returns ENOBUFS. Either way the caller sees a clean error.
      expect(proc.error).toBeInstanceOf(Error);
      expect(proc.stdout).toBe("");
      expect(proc.stderr).toBe("");
    }
  });

  test("the child inherits the caller's environment on both transports", () => {
    for (const mode of ["bun", "fallback"]) {
      const proc = withIO(mode, () =>
        runSyncFetchChild(["-e", "console.log(process.env.T5_ENV_INHERIT ?? 'missing')"], {
          env: { ...ioEnv(mode), T5_ENV_INHERIT: "passed" },
        }));
      expect(proc.error).toBeNull();
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.trim()).toBe("passed");
    }
  });

  test("the Bun transport applies the same ceiling node uses for maxBuffer", () => {
    expect(SYNC_FETCH_MAX_OUTPUT_BYTES).toBe(128 * 1024 * 1024);
    const big = withIO("bun", () =>
      runSyncFetchChild(["-e", "console.log(JSON.stringify({ ok: true, body: 'y'.repeat(1024 * 1024) }))"], { env: ioEnv("bun") }));
    expect(big.error).toBeNull();
    expect(big.exitCode).toBe(0);
    expect(JSON.parse(big.stdout).body.length).toBe(1024 * 1024);
  });
});

// --- sync fetch over loopback (responder in a separate process) -------------

describe("sync fetch over loopback (T5)", () => {
  let responder;

  beforeAll(async () => {
    responder = await startResponder();
  });

  afterAll(async () => {
    await responder.stop();
  });

  test("GET round-trips method, headers and body identically on both transports", () => {
    const run = (mode) =>
      withIO(mode, () => {
        const result = syncFetch(syncFetchStub(), "GET", `${responder.base}/echo`, [["x-custom", "v1"]], null);
        return {
          ok: result.ok,
          status: result.status,
          url: result.url,
          text: Buffer.from(result.body, "base64").toString("utf8"),
        };
      });
    const bun = run("bun");
    const fallback = run("fallback");
    expect(fallback).toEqual(bun);
    expect(bun).toEqual({ ok: true, status: 200, url: `${responder.base}/echo`, text: "GET||v1" });
  });

  test("POST carries the base64-decoded body to the server on both transports", () => {
    const run = (mode) =>
      withIO(mode, () => {
        const result = syncFetch(syncFetchStub(), "POST", `${responder.base}/echo`, [], Buffer.from("hello-sync"));
        return { ok: result.ok, status: result.status, text: Buffer.from(result.body, "base64").toString("utf8") };
      });
    const bun = run("bun");
    const fallback = run("fallback");
    expect(fallback).toEqual(bun);
    expect(bun.text).toBe("POST|hello-sync|");
  });

  test("a binary 64 KiB payload survives the base64 envelope unchanged", () => {
    const run = (mode) =>
      withIO(mode, () => {
        const result = syncFetch(syncFetchStub(), "GET", `${responder.base}/bin`, [], null);
        return { ok: result.ok, bytes: Buffer.from(result.body, "base64").length };
      });
    const bun = run("bun");
    const fallback = run("fallback");
    expect(fallback).toEqual(bun);
    expect(bun.ok).toBe(true);
    expect(bun.bytes).toBe(64 * 1024);
  });

  test("a failed request throws the diagnostic NetworkError on both transports", async () => {
    // A freshly released port refuses connections deterministically.
    const dead = await startResponder();
    const refused = `${dead.base}/echo`;
    await dead.stop();
    const run = (mode) => {
      let error;
      try {
        withIO(mode, () => syncFetch(syncFetchStub(), "GET", refused, [], null));
      } catch (caught) {
        error = caught;
      }
      return { name: error?.name, prefix: error?.message?.slice(0, 'Failed to execute "send()"'.length) };
    };
    const bun = run("bun");
    const fallback = run("fallback");
    expect(bun.name).toBe("NetworkError");
    expect(bun.prefix).toBe('Failed to execute "send()"');
    expect(fallback).toEqual(bun);
  });
});

// --- sync XMLHttpRequest over loopback ---------------------------------------

describe.skipIf(!nativeAvailable)("sync XMLHttpRequest over loopback (T5)", () => {
  let responder;
  let base;

  beforeAll(async () => {
    responder = await startResponder();
    base = responder.base;
  });

  afterAll(async () => {
    await responder.stop();
  });

  function syncXHR(mode, { method = "GET", path = "/echo", body = null, headers = [] } = {}) {
    return withIO(mode, () => {
      const win = new Window({ url: base });
      try {
        const xhr = new win.XMLHttpRequest();
        const events = [];
        for (const type of ["readystatechange", "error", "load", "loadend"]) {
          xhr.addEventListener(type, () => events.push(type));
        }
        xhr.open(method, `${base}${path}`, false);
        for (const [name, value] of headers) xhr.setRequestHeader(name, value);
        xhr.send(body);
        return {
          status: xhr.status,
          responseText: xhr.responseText,
          responseURL: xhr.responseURL,
          events,
        };
      } finally {
        win.destroy();
      }
    });
  }

  test("GET round-trips the request headers and body through the sync transport", () => {
    const result = syncXHR("bun", { path: "/echo", headers: [["x-custom", "v1"]] });
    expect(result.status).toBe(200);
    expect(result.responseText).toBe("GET||v1");
    expect(result.responseURL).toBe(`${base}/echo`);
    expect(result.events).toContain("load");
    expect(result.events).toContain("loadend");
  });

  test("the disabled (Node child_process) lane returns the identical XHR snapshot", () => {
    const bun = syncXHR("bun", { path: "/echo", headers: [["x-custom", "same"]] });
    const fallback = syncXHR("fallback", { path: "/echo", headers: [["x-custom", "same"]] });
    expect(fallback).toEqual(bun);
  });

  test("POST body reaches the server and the response text is exposed", () => {
    const result = syncXHR("bun", { method: "POST", path: "/echo", body: "posted-data" });
    expect(result.status).toBe(200);
    expect(result.responseText).toBe("POST|posted-data|");
  });

  test("redirects are followed and responseURL reports the final URL", () => {
    const result = syncXHR("bun", { path: "/redir" });
    expect(result.status).toBe(200);
    expect(result.responseText).toBe("landed");
    expect(result.responseURL).toBe(`${base}/landed`);
  });

  test("a large response body (2 MiB) round-trips through the sync transport", () => {
    const result = syncXHR("bun", { path: "/large" });
    expect(result.status).toBe(200);
    expect(result.responseText.length).toBe(2 * 1024 * 1024);
    expect(result.responseText[0]).toBe("L");
    expect(result.responseText[result.responseText.length - 1]).toBe("L");
  });

  test("a refused connection fires error + loadend and leaves the request DONE", async () => {
    // A freshly released port refuses connections deterministically.
    const dead = await startResponder();
    const refusedURL = `${dead.base}/echo`;
    await dead.stop();
    const win = new Window({ url: base });
    try {
      const xhr = new win.XMLHttpRequest();
      const events = [];
      xhr.addEventListener("readystatechange", () => events.push(`ready:${xhr.readyState}`));
      xhr.addEventListener("error", () => events.push("error"));
      xhr.addEventListener("load", () => events.push("load"));
      xhr.addEventListener("loadend", () => events.push("loadend"));
      xhr.open("GET", refusedURL, false);
      expect(() => xhr.send()).not.toThrow();
      expect(events).toEqual(["error", "loadend"]);
    } finally {
      win.destroy();
    }
  });
});

// --- TLS option threading -----------------------------------------------------

describe.skipIf(!nativeAvailable || !opensslAvailable())("TLS option threading (T5)", () => {
  let responder;
  let base;
  let certDir;

  beforeAll(async () => {
    certDir = mkdtempSync(join(tmpdir(), "mad-dom-tls-t5-"));
    const tls = generateSelfSigned(certDir);
    responder = await startResponder({ tls });
    base = responder.base;
  });

  afterAll(async () => {
    await responder.stop();
    rmSync(certDir, { recursive: true, force: true });
  });

  test("async window.fetch rejects a self-signed cert by default and honors disableStrictSSL", async () => {
    const strict = new Window({ url: base });
    try {
      const error = await strict.fetch(`${base}/echo`).then(() => null, (caught) => caught);
      expect(error).toBeInstanceOf(strict.DOMException);
      expect(error.name).toBe("NetworkError");
    } finally {
      strict.destroy();
    }

    const relaxed = new Window({ url: base, settings: { fetch: { disableStrictSSL: true } } });
    try {
      const response = await relaxed.fetch(`${base}/echo`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("GET||");
    } finally {
      relaxed.destroy();
    }
  });

  test("sync XMLHttpRequest honors disableStrictSSL through the sync transport", () => {
    const strict = new Window({ url: base });
    try {
      const xhr = new strict.XMLHttpRequest();
      let errorEvent = false;
      xhr.addEventListener("error", () => {
        errorEvent = true;
      });
      xhr.open("GET", `${base}/echo`, false);
      xhr.send();
      expect(errorEvent).toBe(true);
      expect(xhr.status).toBe(0);
    } finally {
      strict.destroy();
    }

    const relaxed = new Window({ url: base, settings: { fetch: { disableStrictSSL: true } } });
    try {
      const xhr = new relaxed.XMLHttpRequest();
      xhr.open("GET", `${base}/echo`, false);
      xhr.send();
      expect(xhr.status).toBe(200);
      expect(xhr.responseText).toBe("GET||");
    } finally {
      relaxed.destroy();
    }
  });
});

// --- server lifecycle cleanup -------------------------------------------------

describe("server lifecycle cleanup (T5)", () => {
  test("stopping the responder releases its port and its process exits cleanly", async () => {
    const responder = await startResponder();
    const url = `${responder.base}/echo`;
    const before = await fetch(url);
    expect(before.status).toBe(200);
    await responder.stop();
    expect(await responder.exited).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });
});

// --- checksums CLI host IO ----------------------------------------------------

describe("checksums CLI host IO (T5)", () => {
  let dir;
  let manifestBun;
  let manifestFallback;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mad-dom-checksums-t5-"));
    writeFileSync(join(dir, "mad-dom-0.0.1.tgz"), Buffer.from("main-tarball-bytes"));
    writeFileSync(join(dir, "mad-dom-platform-darwin-arm64-0.0.1.tgz"), Buffer.from("platform-tarball-bytes"));
    manifestBun = join(dir, "SHASUMS.bun.txt");
    manifestFallback = join(dir, "SHASUMS.fallback.txt");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("generate writes byte-identical manifests on the Bun and Node paths", () => {
    const bun = runChecksums(process.execPath, ["generate", dir, "--out", manifestBun]);
    const fallback = runChecksums(process.execPath, ["generate", dir, "--out", manifestFallback], { MAD_DOM_BUN_IO_DISABLED: "1" });
    expect(bun.status).toBe(0);
    expect(fallback.status).toBe(0);
    expect(bun.stdout).toContain("wrote 2 entry(ies)");
    expect(fallback.stdout).toContain("wrote 2 entry(ies)");
    expect(readFileSync(manifestBun)).toEqual(readFileSync(manifestFallback));
    const lines = readFileSync(manifestBun, "utf8").trim().split("\n").sort();
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64}  .+\.tgz$/);
  });

  const nodeBin = Bun.which("node");
  test.skipIf(!nodeBin)("the whole node path (no Bun global) produces the same manifest", () => {
    const node = runChecksums(nodeBin, ["generate", dir, "--out", join(dir, "SHASUMS.node.txt")]);
    expect(node.status).toBe(0);
    expect(readFileSync(join(dir, "SHASUMS.node.txt"))).toEqual(readFileSync(manifestBun));
  });

  test("verify recomputes every entry on both paths", () => {
    const bun = runChecksums(process.execPath, ["verify", dir, "--manifest", manifestBun]);
    const fallback = runChecksums(process.execPath, ["verify", dir, "--manifest", manifestFallback], { MAD_DOM_BUN_IO_DISABLED: "1" });
    expect(bun.status).toBe(0);
    expect(fallback.status).toBe(0);
    expect(fallback.stdout).toBe(bun.stdout);
    expect(bun.stdout).toContain("OK");
  });

  test("a tampered tarball fails verification with exit code 1 on both paths", () => {
    writeFileSync(join(dir, "mad-dom-0.0.1.tgz"), Buffer.from("tampered"));
    const bun = runChecksums(process.execPath, ["verify", dir, "--manifest", manifestBun]);
    const fallback = runChecksums(process.execPath, ["verify", dir, "--manifest", manifestFallback], { MAD_DOM_BUN_IO_DISABLED: "1" });
    expect(bun.status).toBe(1);
    expect(fallback.status).toBe(1);
    expect(bun.stderr).toContain("checksum mismatch for mad-dom-0.0.1.tgz");
    expect(fallback.stderr).toContain("checksum mismatch for mad-dom-0.0.1.tgz");
  });
});

// --- Bun host IO benchmark ----------------------------------------------------

describe("Bun host IO benchmark (T5)", () => {
  test("reports machine-readable Bun-vs-fallback rows over identical workloads", async () => {
    const report = await runBunIOBenchmark({ iterations: 1, fileSizeBytes: 64 * 1024 });
    expect(report.schema).toBe(IO_BENCH_SCHEMA);
    expect(() => assertBunIOReport(report)).not.toThrow();
    for (const id of ["read.file", "write.file", "spawn.child", "virtual-server.file", "sync-fetch.child"]) {
      expect(report.workloads[id].sameInput).toBe(true);
      expect(report.workloads[id].bun.status).toBe("measured");
      expect(report.workloads[id].fallback.status).toBe("measured");
      expect(report.workloads[id].bun.validation.passed).toBe(true);
      expect(report.workloads[id].fallback.validation.passed).toBe(true);
    }
    expect(report.validation.sameWorkloadBothPaths).toBe(true);
  });

  test("assert rejects a measured row whose result validation failed", async () => {
    const report = await runBunIOBenchmark({ iterations: 1, fileSizeBytes: 64 * 1024 });
    const invalid = structuredClone(report);
    invalid.workloads["read.file"].bun.validation = { passed: false, bytes: -1 };
    expect(() => assertBunIOReport(invalid)).toThrow(/failed result validation/);
  });

  test("assert rejects an available-path execution failure", async () => {
    const report = await runBunIOBenchmark({ iterations: 1, fileSizeBytes: 64 * 1024 });
    const failed = structuredClone(report);
    failed.workloads["spawn.child"].fallback = { status: "error", reason: "forced execution failure" };
    expect(() => assertBunIOReport(failed)).toThrow(/execution failure/);
  });

  test("assert rejects comparable rows that are not valid on both sides", async () => {
    const report = await runBunIOBenchmark({ iterations: 1, fileSizeBytes: 64 * 1024 });
    const notComparable = structuredClone(report);
    notComparable.workloads["write.file"].comparable = true;
    notComparable.workloads["write.file"].bun = { status: "unavailable", reason: "forced" };
    expect(() => assertBunIOReport(notComparable)).toThrow(/not a valid measurement/);
  });
});
