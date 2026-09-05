# Browser lifecycle and settings parity

## Intent

The English documentation review exposed public happy-dom-shaped methods and
settings whose implementations do less than their names or TypeScript comments
promise. Fix these behavioral gaps against the pinned **happy-dom 20.11.11**
baseline, with particular attention to script execution, waiting, cancellation,
and resource ownership. The bounded L1–L7 implementation is recorded in [results.md](results.md),
with per-key status in [settings-inventory.md](settings-inventory.md). L8 remains
roadmap work. The original findings below are retained as pre-fix evidence.

## Goals and scope

- Make detached Window and Browser/page/frame task lifecycles consistent with
  the locked baseline, including aliases, errors, repeated calls, and cleanup.
- Make closing one Window affect only its own resources.
- Connect supported settings to actual behavior, and document intentionally
  deferred settings without implying implementation from type presence.
- Preserve native DOM correctness, wrapper identity, and the measured speed
  advantage. Re-measure lifecycle workloads after adding the missing work.

Non-goals: a rendering engine, complete browser security isolation, a Node.js
support claim, framework adapters, or an unbounded implementation of the entire
happy-dom API. Child frames, module loading, and automatic subresource loading
need separately scoped follow-up work where full parity requires them.

## Evidence and confirmed findings

Source inspection on 2026-09-05 found the following. These findings are based on
executable code, not just comments; some module comments and `index.d.ts`
descriptions already overstate or understate implementation. The local
`/Users/yang/workspace/happy-dom/packages/happy-dom/src/` checkout supplies
reference design and tests; its manifest version is `0.0.0`, so **use the root
project's locked 20.11.11 dependency for differential acceptance**.

| ID | Priority / difficulty | Location | Finding and impact |
| --- | --- | --- | --- |
| L1 | P0 / medium | `js/facade/extensions/window-platform.js:createHappyDOMApi`, `mutation-observer.js:disconnectAllObservers` | `happyDOM.close()` calls a process-wide observer disconnect routine. Closing Window A can stop Window B's observers. Fix ownership before expanding cleanup. |
| L2 | P1 / hard | `window-platform.js:createHappyDOMApi`, `browser.js:BrowserFrame/BrowserPage/BrowserContext/Browser` | `abort()` and detached `cancelAsync()` are empty. Detached `close()` only disconnects observers; frame/page/browser close updates bookkeeping without implementing full task cancellation or deterministic native release. Outstanding timers/requests can outlive close. |
| L3 | P1 / hard | `window-platform.js:waitUntilComplete`, `timers.js`, `fetch.js:fetchImpl`, `browser.js:BrowserFrame.waitUntilComplete` | Detached waiting drains an array of registered promises; direct fetch is not registered. Frame waiting tracks navigation only. Browser/page waiting can resolve before window timers or fetch finish. Overlapping waits, microtasks creating new tasks, and rejection behavior need explicit baseline cases. |
| L4 | P1 / hard | `browser.js:#writeHTML/#navigate/evaluate`, `document-write.js:evaluateWrittenScripts`, `timers.js:ensureWindowEval` | `goto()` and `page.content` parse HTML without the `document.write()` script path. Enabling evaluation does not make navigation scripts execute. Explicit `eval()`/`evaluate()` is a separate path. The different entry points need a baseline-derived execution and settings matrix. |
| L5 | P1 / medium | `timers.js:scheduleTimeout/scheduleInterval`, defaults in `window-platform.js` and `browser.js` | `timer.maxTimeout`, `maxIntervalTime`, `maxIntervalIterations`, and loop settings are stored but unused by scheduling. Detached and Browser defaults also differ. Consumers can hang when relying on configured limits. |
| L6 | P1 / hard | `fetch.js:fetchImpl`, settings in `window-platform.js` and `browser.js` | Fetch interceptors and default request headers are accepted but not consumed by the fetch path; CookieContainer is not integrated with navigation/fetch. Interceptor-based mocks can unexpectedly reach the network. Request, response-body, and abort ownership must be designed together. |
| L7 | P2 / medium | `browser.js:mergeSettings`, `window-platform.js:validateBrowserSettings`, `index.d.ts` | Browser merges settings while detached Window validates them. Several settings and navigation options have no consumer. Inventory each key against the baseline and remove misleading comments. CSS/device settings must be checked individually: there are real consumers in `cssom.js`. |
| L8 | P2 / hard, roadmap | `browser.js:childFrames/frames`, module settings | Only one frame per page; no complete module/subresource lifecycle. Track separately from the bounded lifecycle fixes, and avoid implying full page rendering in docs. |

`window.close()` on a detached Window is a deliberate baseline-compatible
no-op; **do not “fix” it into `destroy()`**. `GlobalWindow` using the host eval
context is also intentional. The gaps are in the stronger `happyDOM` and Browser
lifecycle contracts, settings wiring, and navigation behavior.

Reference paths upstream include `window/DetachedWindowAPI.ts`,
`async-task-manager/AsyncTaskManager.ts`, `browser/BrowserFrame.ts`,
`browser/BrowserPage.ts`, `browser/BrowserContext.ts`,
`browser/BrowserSettingsFactory.ts`, `browser/DefaultBrowserSettings.ts`, and
`fetch/Fetch.ts`, plus their unit tests.

## Design

### Establish observable behavior first

Add deterministic black-box scenarios for each gap against both engines using
the pinned dependency. Use local HTTP endpoints, deferred response gates, and
recorded callback sequences; do not use external websites or timing-only
assertions. Preserve the first failing observation as evidence. Distinguish
settings accepted by upstream from settings actually honored upstream.

### Give each Window one task owner

Introduce one internal owner for timers, animation callbacks, fetch/body work,
script loads, and navigation. Register completion and cancellation exactly once.
Use the same owner through detached APIs and BrowserFrame; page/context/browser
operations compose their owned children. Keep native tree mutation in Rust and
host scheduling in Bun. Avoid process-wide state for per-window resources.

Define open, aborting, closing, and closed transitions from baseline behavior.
Abort cancels existing work while preserving the ability to use the window if
upstream does; close terminates its owned work and releases references. Decide
the native invalidation point from observable post-close behavior, rather than
blindly replacing every close with the mad-dom-specific `destroy()`.

Waiting must handle concurrent callers and work scheduled by other tasks or
microtasks before the owner becomes idle. Match upstream error and cancellation
settlement. Awaiting completion must not silently turn a failed request or
script into evidence of a successful operation.

### Unify settings and execution decisions

Build a table of each setting, detached/Browser defaults, type validation,
consuming path, tests, and status. Consolidate defaults and merge logic where
the baseline agrees. Wire timer limits, fetch interceptors/headers, and
navigation callbacks in bounded increments. Keep unrelated module/iframe work
as roadmap items.

Route opted-in navigation/content scripts through a shared execution pipeline
only after task ownership is reliable. Test inline and external scripts,
disabled evaluation/loading, order, errors, and scripts that create new async
work. Explicit eval, Window VM scope, and GlobalWindow host scope need separate
cases. Script execution must remain opt-in where the baseline requires it;
VM contexts must not be described as a security boundary.

## Implementation sequence

| Step | Work | Depends on | Acceptance |
| --- | --- | --- | --- |
| 1 | Capture L1–L7 as pinned differential cases and a settings inventory | — | Each confirmed gap has a failing current observation and expected baseline result; intentional differences are identified. |
| 2 | Scope observer ownership and cleanup (L1) | 1 | Closing A leaves B's observer delivering; repeated close and disconnect are harmless; no retained observer registry entries. |
| 3 | Implement task ownership, waiting, abort, close, aliases (L2–L3) | 1, 2 | Timers, fetch, navigation, nested tasks, simultaneous waits, cancellation, and post-close access match pinned behavior. Local request gates verify that waits cannot resolve early. |
| 4 | Wire timer limits and normalize verified settings (L5, part of L7) | 3 | Test limit boundaries, defaults, invalid types/keys, recursive scheduling, intervals, and cancellation without leaving live timers. |
| 5 | Connect fetch settings and cookie ownership (L6, part of L7) | 3 | Interceptors prevent intended requests from reaching the local server; request/response hooks, headers, credentials, bodies, cancellation, and context isolation match baseline. |
| 6 | Implement the opted-in script/navigation matrix (L4) | 3, 5 | Inline/external scripts, callback order, errors, explicit eval, and wait completion pass for each supported entry point. |
| 7 | Expand compatibility coverage, correct types/docs, re-measure | 2–6 | No unexplained new skips; docs describe implemented behavior; benchmark correctness and lifecycle cost are reported. |

L8 remains roadmap work and is not part of this execution sequence. This plan
does not create a todo queue or launch implementation agents.

## Validation

Use Bun for dependency management and JavaScript checks. Start with focused
tests in `tests/bun/window-detached-api.test.js`, `global-window.test.js`,
`browser.test.js`, timer/fetch/observer suites, and new differential scenarios.
Promote applicable vendored tests through the existing triage process.

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run validate
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run compat:differential
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1 --json > lifecycle-bench.json
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:check
bun run docs:build
```

Acceptance includes no callbacks after cancellation/close where upstream
forbids them; no interference between windows; no unresolved waiters after
errors; stable listener counts; and native release checks using existing
`liveDocumentCount()`/GC helpers. Do not replace functional evidence with a
benchmark passing or a schema/type match.

The 2026-09-05 `windowLifecycle` benchmark timed the current lightweight close
path. After real cleanup is implemented, retain the old dated result and publish
a new measurement with the revised semantics. The 2.83×/1.57× aggregates remain
historical measurements, not performance acceptance thresholds for this fix.

## Risks and assumptions

- Baseline behavior wins over intuitions about browser semantics. The adjacent
  happy-dom checkout may differ from the pinned dependency.
- Async task tracking adds work to fast paths. Profile bounded ownership and
  settle costs; do not preserve a speedup by omitting required behavior.
- Cross-window observers and process-level error listeners require isolation
  tests. Keep process-level exception scenarios outside the shared test runner.
- Host Promises/timers must not be mistaken for Window-owned work. Fake timers
  require an explicit scheduling policy rather than copying every global.
- New script loading can change network access and execution scope. Keep the
  documented opt-in and validate each supported path before broadening claims.
- Scope assumes lifecycle/settings fixes first; complete subresource, iframe,
  and module support can be planned after the shared task model is proven.
