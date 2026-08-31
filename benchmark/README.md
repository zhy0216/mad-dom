# Integration-test benchmark (mad-dom vs happy-dom)

This directory vendors the happy-dom integration-test suite in two copies and
runs both under the bun test runner to compare wall-clock:

- `mad-dom-integration-test/` — imports `mad-dom` (devDependency `file:../..`)
- `happy-dom-integration-test/` — imports `happy-dom` 20.11.11 (same version the
  compat differential suite pins)

Both packages keep the upstream test files verbatim except:

1. `import ... from 'happy-dom'` → `from 'mad-dom'` in the mad-dom copy.
2. The `test` script uses `bun test` instead of `node --test` (upstream ran
   `ls | node --disallow-code-generation-from-strings --test`).
3. `Browser.test.js` sets `timer.maxIntervalTime` instead of the stale
   `timer.maxInterval` (no published happy-dom version, nor happy-dom `master`,
   defines `maxInterval`; the upstream test was already broken against it).

The `browser-exception-observer` test cannot run inside a test runner — it
captures process-level `uncaughtException`/`unhandledRejection`, which collide
with the runner — so the `test` script runs it as a standalone script, exactly
like the upstream design.

## Running

```sh
npm run bench:integration        # run both suites, print the comparison
bun benchmark/run.mjs --json     # machine-readable JSON
bun benchmark/run.mjs --iterations 5
```

The report shows two timings (median over 3 runs by default):

- **full** — every test file. The Browser / XMLHttpRequest / WebSocket cases
  hit real external endpoints (github.com, npmjs.com, echo.websocket.org), so
  their latency dominates the total and is noisy; on happy-dom those cases
  usually fail fast in this environment, which makes the full-suite number
  misleading as a performance signal.
- **local** — only the deterministic, dependency-free cases (CommonJS, Fetch
  over a local express server, WindowGlobals, exception observer). This is the
  stable DOM-workload signal and the number to compare.

`npm run test:integration` runs the mad-dom copy (`bun test`).

## Current gaps on mad-dom

The mad-dom copy reports `Browser` as a failing test file: `index.js` does not
export `Browser` yet, so `Browser.test.js` and the exception-observer test fail
to import. The other files (Fetch, WindowGlobals, XMLHttpRequest, WebSocket,
CommonJS) run.
