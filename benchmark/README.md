# Benchmarks: mad-dom vs happy-dom

This repository provides three kinds of performance measurements:

| Command | Measurement | Purpose |
| --- | --- | --- |
| `bun run bench:dom` | 16 DOM operation phases + 13 small testing workflows | Compare deterministic DOM workloads across the two engines |
| `bun run bench:integration` | Process wall-clock time for two integration test suites | Observe the combined end-to-end cost of module loading, the runner, DOM operations, and networking |
| `bun run bench:check` | Internal Rust Core + raw binding metrics | Check mad-dom for large regressions against applicable baselines; see [bench/README.md](../bench/README.md) |

## Latest results: 2026-09-05

| Timed workload | mad-dom | happy-dom 20.11.11 | happy-dom / mad-dom |
| --- | ---: | ---: | ---: |
| Core: combined operations across 16 phases | **141.70 ms** | 401.60 ms | **2.83×** |
| Testing: combined workloads across 13 scenarios | **91.10 ms** | 143.08 ms | **1.57×** |

This measurement used an Apple M3 Max, 48 GiB of memory, macOS 26.6.2 arm64, Bun 1.4.0,
and Rust 1.93.1, at size 1× with 2 warmup rounds and 9 measured rounds.
The source revision was [`2fda7ea`](https://github.com/zhy0216/mad-dom/commit/2fda7eaf75572a29618f9443527011886a970e0b)
(`package.json` version `0.0.1-alpha.3`), built with `dev:build` and explicitly loading
the local native artifact. These numbers measure a source build, not published npm binaries.

The [raw JSON](results/2026-09-05-dom.json) preserves the complete output;
the [performance page](../docs/performance.md) lists timings and RSS for all 29 phases.
Workloads and result validation matched across both engines, all 13 testing scenarios
passed, and the top-level `valid` field was `true`.
mad-dom had lower medians in 15/16 core phases and 8/13 testing scenarios.
Slower cases are included in the totals; these results do not imply that every type of test gets faster.

Each total is calculated by **summing within each round, then taking the median of those round totals**.
Core JSON provides `operations` directly; the testing runner reports only individual scenarios,
so its total is calculated from the samples of all passing scenarios.
Neither total is a sum of phase medians or the runtime of the entire test process.
The phases and their case counts form a fixed mixed workload, with no additional normalization
by scenario weight.

## Reproducing from source

Run these commands from the repository root with Bun `1.4.0` and Rust `1.93.1`:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1 --json > dom-bench.json
```

`MAD_DOM_NATIVE_PATH` ensures that the newly built native module is used, even when a
platform npm package is installed. When comparing source revisions, rebuild each time
and use the same path override. Other common commands:

```sh
bun run bench:dom                                     # all; defaults to 5 rounds, size 1×
bun run bench:dom --suite testing                     # unit-test workflows only
bun run bench:dom --suite core                        # the 16 operation phases only
bun run bench:dom --suite core --runs 9 --sizes 0.1,1,2 # scaling curve
bun run bench:dom --runs 1 --sizes 0.01                # minimal smoke run for both suites
bun test benchmark/dom-bench                          # fixture, timing, and report validation
```

These commands also accept the same native-path prefix. Omitting `--json` prints comparison tables.
`--runs` must be an integer ≥ 1; `--sizes` is a comma-separated list of finite positive numbers.
Invalid arguments return exit code 2. Smoke-scale workloads and single-round samples are
suitable only for checking that the benchmark runs.

### Recalculating totals from raw samples

The following command uses the statistics function shared by the runners. Change the filename
to `dom-bench.json` to summarize your own results:

```sh
bun -e '
import { summarizeOperations } from "./benchmark/dom-bench/stats.mjs";
const report = await Bun.file("benchmark/results/2026-09-05-dom.json").json();
if (!report.valid || !report.testing?.valid) throw new Error("Invalid comparison");
for (const [suite, reports] of [["core", report.reports], ["testing", report.testing.reports]]) {
  for (const engine of reports) {
    for (const result of engine.results) {
      if (suite === "testing" && Object.values(result.phases).some(p => p.status !== "passed")) {
        throw new Error("Incomplete testing workload");
      }
      console.log(suite, engine.engine, result.size, summarizeOperations(result.phases));
    }
  }
}
'
```

## DOM benchmark measurement and validity

`dom-bench/run.mjs` starts separate Bun workers in a fixed order:
core mad-dom → core happy-dom → testing mad-dom → testing happy-dom.
Each suite uses a separate process; multiple sizes run in the specified order within the same worker.
This run did not use an alternating ABBA order or calculate confidence intervals. To assess
small differences, repeat measurements on the target machine and inspect all samples
without selecting only favorable rounds.

- Each size discards 2 warmup rounds and retains all measured samples. Tables show
  `median [min-p90] MAD`, using nearest-rank p90 and median absolute deviation (MAD).
  A warning appears when MAD exceeds 20% of the median; `[min-p90]` is not a confidence interval.
- After each phase, `Bun.gc(true)` runs, followed by two event-loop drains to allow deferred
  Node-API finalizers to execute. These explicit GC calls and waits are outside individual
  operation timing windows; normal runtime GC occurring inside a window is still included.
- Core checks complete workload metadata, per-selector hit counts, actual tree node counts,
  ID spot checks, serialization hashes, traversal counts, and read/mutation fingerprints.
  Measured rounds must be consistent, and both engines must match. Invalid sizes show no core speedup.
- Testing checks explicit expected values after timing each case, including an empty body after
  cleanup; warmup cases are checked too. Fingerprints must remain consistent across rounds for
  each engine, and case counts and SHA-256 result fingerprints must match across engines.
- A failed testing scenario is marked `FAIL`; its samples are cleared, and its first failing
  round and reason are retained while other scenarios continue. Failed scenarios are not retried,
  show no speedup, and are excluded from totals.
- Any workload failure, result mismatch, or inconsistency across core rounds causes the runner
  to print diagnostics and return exit code 1. Worker startup failures, signal exits, and invalid
  JSON/schema also terminate the comparison.
- For core-only runs, the comparison schema is `mad-dom-dom-bench-comparison/1` and the core
  worker schema is `mad-dom-dom-bench/3`. When testing is included, the comparison schema is
  `mad-dom-dom-bench-comparison/2`: core data remains in `reports`, testing data is in
  `testing: { phases, reports, valid }`, and the testing worker schema is `mad-dom-testing-bench/1`.
  With `--suite testing`, the top-level core `reports` / `phases` are empty.

## Large trees and low-level operations: core

`dom-bench/worker.mjs` uses rounds as its outer loop, running the complete pipeline in each round.
The workloads below are for size 1×; `--sizes` scales sections and build/read/mutation node counts.
Each phase is timed independently. The isolated build phases are separate experiments,
not timing breakdowns extracted from `buildMixed`.

| Phase | Workload and timing window |
| --- | --- |
| `parse` | `document.write` of a generated page with ~10.3k elements / ~320 KB (a fresh window each time; only the write is timed) |
| `buildMixed` | Build a tree of 20k elements using `createElement` + `setAttribute` + `appendChild` (plus 4k text nodes; only the construction loop is timed) |
| `queryHot` | Run the same batch of class / compound descendant selectors on a shared document before timing, then measure the second query pass |
| `queryCold` | First query pass for the same batch on a freshly parsed document each round (new wrappers, selector cache misses) |
| `getById` | 100 single-match document `querySelector("#id")` calls for distinct IDs (the first query includes building Core's ID-only index; the stride spans the full ID range) |
| `getByTag` | 20 calls to `getElementsByTagName("li").length` (live-collection cost measured separately) |
| `serialize` | Read all of `body.innerHTML` (only the read is timed; the content hash is calculated outside the window) |
| `traverseWarm` | Second full-tree traversal via `firstChild` / `nextSibling` on a shared document (resident wrappers + navigation memo hits) |
| `traverseCold` | First full-tree traversal of a freshly parsed document (new wrappers, memo misses) |
| `buildCreate` | 20k `createElement` calls, without attributes or mounting (creation cost only) |
| `buildAttr` | `createElement` + id/class `setAttribute` on each node, without mounting (attribute FFI) |
| `buildAppend` | `createElement` + `appendChild` to a shallow root, without attributes (isolating mounting cost) |
| `buildText` | 20k `createTextNode` calls, without mounting |
| `buildBulk` | Parse a 20k-element fragment with one `div.innerHTML` assignment, then mount it (native parsing path, without per-node FFI) |
| `readHeavy` | Read `nodeName` / `id` / `className` / `getAttribute` / first-child `textContent` for each of 5000 sampled nodes |
| `mutationChurn` | 2000 sampled nodes × (`setAttribute` overwrite, `removeAttribute`, remove+append, and a `replaceChild` swap-out/swap-back pair; a separate fresh document each round) |
| `operations` | Median of each round's sum of the 16 timing windows, excluding fixture preparation, validation, forced GC, and event-loop waits |
| `total` | Median measured wall-clock time of each round's entire pipeline, including preparation, validation, inter-phase GC, and waits (retaining the original measurement definition) |

The selector warmup for `queryHot` and the first complete traversal for `traverseWarm`
are outside the timing windows. Cold phases use a separately created and parsed document
without a preliminary element-count read. `traverseCold` runs after `queryCold`, so cold
means the first traversal, not the absence of all prior queries.
Wrapper/token and navigation-cache residency while a document is alive is part of the
implementation cost and should be considered alongside RSS.

`getById` refers to single-match ID queries, but the actual API is `querySelector("#id")`,
not `getElementById()`. The first query builds Core's ID-only index, and the next 99 use it;
this does not enable a full query index for general class/descendant selectors.

## Small unit-test workflows: testing

Scenarios are defined in `dom-bench/testing-scenarios.mjs`. They execute
setup → mount → query/interact → inspect → cleanup using deterministic data and small components.
`--sizes` scales only the number of independent cases (rounded, with a minimum of 1),
not the size of an individual component. Each timing sample covers the scenario's
**entire batch of cases**, so it cannot directly compare per-operation speed across scenarios.

| Phase | Cases per round at 1× | Scenario and validation |
| --- | ---: | --- |
| `fixtureLifecycle` | 100 | Repeatedly mount a counter in a shared Window, click to update, read the result, unmount, and remove listeners; verify that listeners no longer update the component after unmounting |
| `windowLifecycle` | 25 | Create a separate Window per case, mount/query, write to localStorage, clean up, and close; verify that initial DOM/storage contains no residue from previous cases |
| `testingLibraryText` | 50 | A 20-row item list with real `within` / `getByTestId` / `getByText` / `queryByText` queries and missing-element checks |
| `testingLibraryEvents` | 50 | Dispatch two real `fireEvent.click` calls and verify that a `{ once: true }` listener runs only once |
| `testingLibraryRole` | 25 | Real `getByRole` / `getAllByRole` queries, including heading level, button accessible name, and default visibility checks |
| `testingLibraryLabel` | 25 | Use real `getByLabelText` to find an input associated via `<label for>`, then query it with `getByDisplayValue` after `fireEvent.input` |
| `todoInteractions` | 50 | Create 12 todos, mount them in a Fragment, delegate nested click events, complete/delete items, update class/dataset/aria, and invalidate live collections |
| `formSubmission` | 50 | Fill input/textarea/select/checkbox controls; exercise bubbling events, `requestSubmit`, FormData successful-control filtering, and reset to default values |
| `templateClone` | 50 | Deep-clone `template.content`, populate 20 cards, mount via a Fragment, and verify that the template is unchanged and all card contents are correct |
| `keyedReconcile` | 50 | Remove even-numbered items from a 20-row list, move retained nodes into reverse order, and update text; verify order, node identity, live collections, and static NodeLists |
| `asyncObserver` | 25 | Simulate a request response with a Promise, update a loading component, wait for MutationObserver notifications, and verify final text and attribute/child-node records |
| `shadowComponent` | 50 | Mount a Shadow DOM counter, assign slots, query internally, bubble composed events, update state, and verify light/shadow query isolation |
| `snapshotRoundTrip` | 50 | Clone a component, modify the copy, snapshot `outerHTML`, and reparse; verify that the original tree is unchanged and entities, attributes, and comments retain their full contents |

Testing Library scenarios use the actual APIs of the pinned `@testing-library/dom@10.4.1`,
with default visibility checks enabled. They do not include React/Vue renderers, `user-event`,
jest-dom matchers, or test-runner startup, so they do not establish full framework test performance.

Each case's fixture parsing, queries, interactions, result reads, and `body.replaceChildren()`
cleanup are timed. Only `windowLifecycle` includes Window creation and `happyDOM.close()`
in the timing window; other scenarios share one Window per round, with creation and final
closure outside the window. Pregenerated fixture strings, final assertions, SHA-256,
explicit GC, and event-loop drains are excluded.
Async scenarios use Promises + MutationObserver; a 2-second timer serves only as a failure
watchdog. The normal path has no fixed waits or external network requests.

## RSS and pipeline total

JSON `rss.baseline` is the RSS before the first measured round.
`rss.perPhase.<phase>.peak` is sampled before GC, and `after` is sampled after GC and
event-loop drains. Only the last measured round is retained; `peak` is a point-in-time
reading, not the OS high-water mark. Core comparison tables show `after - baseline`;
testing RSS is retained only in JSON.

In this run, the final core phase's after-baseline was **+242.3 MiB** for mad-dom and
**+3,475.1 MiB** for happy-dom. This is accumulated worker residency across multiple rounds,
including native allocations, wrappers/caches, JIT, and GC state. It is not the object size
of an individual document or a leak check.

Core `total` is the wall-clock time of each round's complete pipeline, including preparation,
validation, and inter-phase GC/waits. Its medians in this run were 374.80 / 3,252.41 ms,
but happy-dom's total MAD exceeded 20% of its median, so the main table uses `operations`.
happy-dom's `queryHot` and `traverseWarm` also exceeded the instability threshold;
microsecond-scale hot queries and small differences should not be treated as stable wins or losses.

## Integration-test benchmark

`run.mjs` runs tests for two private packages:

- `mad-dom-integration-test/` imports local mad-dom via `file:../..`.
- `happy-dom-integration-test/` imports the pinned happy-dom `20.11.11`.

The two test suites differ only in engine import/require statements; assertions are identical.
Shared adaptations from upstream include the Bun runner and `timer.maxIntervalTime` in
`Browser.test.js`. The exception observer captures process-level `uncaughtException` /
`unhandledRejection` events, so it runs as a separate script to avoid conflicts with the test runner.

First install root dependencies and build the native module, then install dependencies for
both private packages:

```sh
bun install --frozen-lockfile --cwd benchmark/mad-dom-integration-test
bun install --frozen-lockfile --cwd benchmark/happy-dom-integration-test
bun run bench:integration
bun run bench:integration --iterations 5 --json
```

By default, each engine runs 3 times, reporting two median wall-clock times:

| Field | Workload and interpretation |
| --- | --- |
| `local` | CommonJS, Fetch using local Express, WindowGlobals, and the separate exception observer; no external network dependency, but includes process startup, module loading, and local HTTP costs |
| `full` | All tests plus the exception observer; Browser and some XMLHttpRequest and WebSocket cases depend on external networks and are affected by service availability and live page contents |

The current runner outputs timings and speed comparisons even when tests fail, without checking
all subprocess exit statuses. The JSON summary retains only the last round's full main-test
results and does not include per-round local pass status.
**Successful report generation does not mean the tests passed.** Confirm the correctness of
the selected cases separately before using timing comparisons.
Prefer the workload-validated `bench:dom` for DOM performance conclusions.

`bun run test:integration` is CI's functional check for the mad-dom package and runs its `test:ci`:
it excludes only `Browser.test.js` and runs the exception observer separately.
**It still includes external-network XMLHttpRequest and WebSocket cases and is not the purely local group.**
Full Browser cases can also expose navigation or script-behavior differences; failures
cannot all be attributed to the network.

## Relationship to compatibility gates

| Check | Focus |
| --- | --- |
| `bench:dom` | Validity and timing comparisons for the current DOM workloads |
| `test:integration` | Passing status of mad-dom integration cases |
| `bench:check` | Large regressions in internal performance/memory metrics against baselines |
| `compat:hdunit:validate` | Triage and regression checks for vendored happy-dom unit-test files |

Integration tests come from upstream `integration-test/`, while hdunit comes from upstream `test/`.
Both are pinned to happy-dom 20.11.11, but they cover different areas.
Performance ratios do not establish compatibility; see the
[compatibility report](../docs/compat-report.md) and [hdunit coverage notes](../tests/happy-dom/COVERAGE.md)
for the full scope.
