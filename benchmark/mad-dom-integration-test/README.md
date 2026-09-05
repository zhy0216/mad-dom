# mad-dom integration tests

This private package runs the vendored happy-dom integration tests against
the local mad-dom checkout (`file:../..`).
Both copies keep matching assertions; their engine imports differ.
See the [benchmark guide](../README.md#integration-test-benchmark) for shared
upstream adaptations, timing methodology and comparison commands.

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:build
bun install --frozen-lockfile --cwd benchmark/mad-dom-integration-test
bun run --cwd benchmark/mad-dom-integration-test test:ci
```

`test:ci` excludes `Browser.test.js` and runs the exception observer as a
standalone script. XMLHttpRequest and WebSocket tests still use external
services. Use the package's `test` script to include Browser tests too.

To check only the benchmark's local group, run inside this package directory:

```sh
bun test test/CommonJS.test.cjs test/Fetch.test.js test/WindowGlobals.test.js
bun test/browser-exception-observer/BrowserExceptionObserver.test.js
```

The observer captures process-level errors and must run outside `bun test`.
It is included in both `local` and `full` benchmark wall times.
