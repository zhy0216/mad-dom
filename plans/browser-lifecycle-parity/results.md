# Browser lifecycle parity results

Baseline: the locked `happy-dom` 20.11.11 dependency. Runtime: Bun 1.4.0.

## First failing observations

Before implementation, all nine initial black-box scenarios failed. The same
scenario function ran against both engines; HTTP requests used local servers
with explicit header/body gates.

| Finding | Baseline | Original mad-dom |
| --- | --- | --- |
| L1: close A, then mutate B | B's observer delivered | No delivery |
| L2: abort queued callbacks | Only subsequently scheduled reuse callback | Microtask and animation callback also ran |
| L3: overlapping waits | first, nested, wait1, wait2 | wait2 returned before first |
| L3: frame/page/context/browser waits | 0 waiters finished before headers/body | All 4 finished before headers |
| L5: timer defaults/caps | All limits -1; configured interval ran 3 callbacks and capped timeout completed | Browser defaults differed; configured timers did not run before guard |
| L6: before-request mock | Hook saw configured header; zero server requests | Hook never called; one real request |
| L6: context cookies | Sibling page saw cookie; incognito did not | Sibling page and context container were empty |
| L4: content/navigation scripts | Inline script ran; option callback then settings callback; fresh Window | No scripts/callbacks; reused Window |
| L7: invalid Browser settings | Baseline validation errors | Accepted |

## Implemented behavior

One task owner now coordinates timers, animation callbacks, Window microtasks,
fetch transport/body work, script loading and navigation. Idle checkpoints
include nested Promise-created tasks and concurrent waiters. Abort cancels
existing work and permits reuse. Close clears owned observers/listeners/logs,
leaves retained Windows with empty readable documents, and releases the frame's
Window reference. Explicit `destroy()` still invalidates the native arena.

Real navigation creates a fresh realm and closes the previous Window. Classic
scripts use the same pipeline across document.write, content and navigation.
Parser-blocking resources use the existing synchronous Bun transport;
async/defer resources use owned fetch. Script globals are visible on their
Window, and VM bindings use weak Window references so closed realms do not pin
native documents. Fetch constructors are cached by the Window itself rather
than the native handle, breaking the native wrapper/cache reference cycle.
The isolated teardown test exercises both timer and external-script errors
before checking process listeners and native document reclamation.

Fetch hooks/default headers are applied, context cookies feed document and
request access, and incognito stores remain separate. The
[settings inventory](settings-inventory.md) identifies each consumer and
deferred setting individually.

The previous CI failure assumed that GC ran before queued microtasks and
animation callbacks. GC is not an explicit cancellation boundary. The revised
test checks long-lived timers and native reclamation; separate differential
tests prove synchronous cancellation of microtasks/animation callbacks.

## Baseline details and bounded differences

- A detached `window.close()` is a no-op. `happyDOM.close()` performs teardown.
- Idle waiting does not report operation success. Fetch/body promises retain
  errors and script errors remain observable via error events/console.
- In the pinned runtime, task-manager cancellation of HTTP requests before
  headers reports NetworkError; cancellation while reading the body reports
  AbortError. Request AbortController reasons remain distinct.
- `maxIntervalIterations: N` permits N + 1 callbacks, including N = 0.
- A before-request mocked Response bypasses the after-response hook upstream.
- Rejected before-request hooks leak a task in 20.11.11. mad-dom preserves the
  rejection and releases its task, so waiting and teardown remain usable.
- Complete module/iframe/subresource loading remains L8. Direct-fetch CORS,
  per-redirect cookie processing, full popup behavior and synchronous transport
  TLS customization remain separately scoped limitations.
- Retained closed Window/node wrappers keep their native arena alive until
  discarded or explicitly destroyed. Browser.close cannot invalidate them
  without breaking baseline post-close access.

## Verification

The regression suite is `tests/bun/browser-lifecycle-parity.test.js`, including
isolated process error/listener/native-GC checks. BrowserContext's nine vendored
tests are promoted through triage, ledger and provenance records. Browser's
vendored file still needs an import mapping for DefaultBrowserSettings; its
public behavior is covered by the differential suite.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed at repository root |
| `bun run dev:build` | Passed |
| `MAD_DOM_NATIVE_PATH=... bun run validate` | Passed: Rust fmt/Clippy/tests, types, 1014 Bun tests, ledger, hdunit triage and WPT |
| Final focused lifecycle/browser/timer/GlobalWindow/fetch checks | 97 passed; includes 24 lifecycle regressions |
| `bun run compat:differential` | 184 scenarios equal; strict script-eval recheck also passed |
| Integration suite | 10 tests plus three isolated BrowserExceptionObserver cases passed |
| `bun run docs:build` | Passed |
| `check-core-safety.sh scan` | Passed |
| `npm pack --dry-run` | Passed |
| Host platform build + packed install smoke | Passed; smoke verifies operation without Cargo and loader failure cases |
| `bun run bench:check` | Passed; no metric exceeded its degradation threshold |

The integration checkout's pre-existing `file:../..` installation recursively
copied its own dependency tree on macOS. A local symlink to the source checkout
was used for that run. The existing CI workflow still tests a frozen install
from a clean Linux checkout.

## New lifecycle measurement

[Raw samples](lifecycle-bench.json) retain all nine rounds, correctness results
and fingerprints. Both engines passed every measured phase. Host: darwin/arm64,
Bun 1.4.0; happy-dom 20.11.11; size 1. The 25-Window lifecycle workload took
29.842 ms in mad-dom and 34.385 ms in happy-dom (1.15×). The 16 DOM-phase
geometric mean was 2.878× and the 13 workflow-phase geometric mean was 1.252×.
These are measurements, not new performance-gate thresholds. The original
2026-09-05 2.83×/1.57× report remains historical and is not overwritten.
