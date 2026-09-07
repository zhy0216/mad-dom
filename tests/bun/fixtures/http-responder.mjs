// T5 host-IO responder fixture.
//
// A tiny HTTP/TLS server that runs in its OWN process so that a
// `Bun.spawnSync`/node `spawnSync` caller in the parent process can reach it:
// a synchronous spawn blocks the parent's event loop, so a request back into a
// server hosted by the same process would deadlock. Tests start this fixture
// with `Bun.spawn`, read the `READY <url>` line from stdout, and drive their
// synchronous requests against that URL.
//
// Usage:
//   bun tests/bun/fixtures/http-responder.mjs [--tls <cert.pem> <key.pem>]
//
// Routes (relative to the served origin):
//   /echo         -> `<method>|<request body>|<x-custom header>`
//   /redir        -> 302 -> /landed
//   /landed       -> 200 "landed"
//   /large        -> 200 2 MiB repeated payload
//   /bin          -> 200 deterministic 64 KiB binary payload
//   /cookie       -> 200 "cookie=<Cookie header>", sets `sid=abc; Path=/`
//   anything else -> 404 "nf"

import { readFileSync } from "node:fs";

const LARGE_PAYLOAD = "L".repeat(2 * 1024 * 1024);
const BIN_PAYLOAD = Buffer.alloc(64 * 1024);
for (let i = 0; i < BIN_PAYLOAD.length; i++) BIN_PAYLOAD[i] = i & 0xff;

async function route(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  switch (url.pathname) {
    case "/redir":
      return new Response(null, { status: 302, headers: { Location: `${origin}/landed` } });
    case "/landed":
      return new Response("landed");
    case "/large":
      return new Response(LARGE_PAYLOAD);
    case "/bin":
      return new Response(BIN_PAYLOAD);
    case "/cookie":
      return new Response(`cookie=${request.headers.get("cookie") ?? ""}`, {
        headers: { "Set-Cookie": "sid=abc; Path=/" },
      });
    case "/echo": {
      const body = await request.text();
      return new Response(`${request.method}|${body}|${request.headers.get("x-custom") ?? ""}`);
    }
    default:
      return new Response("nf", { status: 404 });
  }
}

const args = process.argv.slice(2);
const tlsIndex = args.indexOf("--tls");
const tls = tlsIndex >= 0 ? { cert: readFileSync(args[tlsIndex + 1], "utf8"), key: readFileSync(args[tlsIndex + 2], "utf8") } : undefined;

const server = Bun.serve({ port: 0, tls, fetch: route });
console.log(`READY ${server.url.href}`);
process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});
// Keep the fixture alive until it is killed by the parent.
setInterval(() => {}, 1 << 30);
