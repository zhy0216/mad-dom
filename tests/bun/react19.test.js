import { expect, test } from "bun:test";

test("React 19 mounts navigation and handles controlled form input without DOM patches", () => {
  // React caches DOM capability detection at import time. A separate process
  // gives it a fresh Window without leaking globals into other Bun tests.
  const fixture = new URL("./fixtures/react19.mjs", import.meta.url).pathname;
  const result = Bun.spawnSync([process.execPath, fixture], {
    env: { ...process.env, NODE_ENV: "development" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10000,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("React 19 navigation and form interactions passed");
}, 15000);
