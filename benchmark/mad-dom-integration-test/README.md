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

This package sets Bun's [isolated linker](https://bun.com/docs/pm/isolated-installs)
in `bunfig.toml`. On Linux Bun 1.4.0/1.4.2 the hoisted `file:../..` install can
recursively copy its own destination even with an empty cache and exit 0.
The isolated store avoids that recursion with the same frozen lockfile and
install command. It contains a source snapshot, so reinstall after changing
mad-dom JavaScript; it is not a live symlink to the repository root. For source
native checks, also set `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` to the
repository's `build/mad-dom.node` (the same image).

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
