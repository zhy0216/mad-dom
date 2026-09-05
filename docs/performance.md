# Performance

**2.83× faster core DOM work. 1.57× faster test workflows.** These are the
aggregate results of the source-build run below, with matching workload checks
for both engines. Parsing was 3.19× faster, serialization 4.98×, and mutation
churn 8.59× in the same run. The full tables include every measured phase.

mad-dom is compared with **happy-dom 20.11.11** using the same deterministic
DOM workloads through each engine's public API. The benchmark covers
**16 core phases** and **13 test workflows**, including actual
`@testing-library/dom@10.4.1` queries and events.

## Recorded results

The **2026-09-05 source-build run** produced matching workload checks for both
engines and passed all 13 test scenarios (`valid: true`).

| Timed workload | mad-dom | happy-dom | Speedup |
| --- | ---: | ---: | ---: |
| Core operations, 16 phases | **141.70 ms** | 401.60 ms | **2.83×** |
| Test workflows, 13 scenarios | **91.10 ms** | 143.08 ms | **1.57×** |

Environment: Apple M3 Max, 48 GiB RAM, macOS 26.6.2 arm64, Bun 1.4.0, Rust
1.93.1; size 1×, 2 warmup rounds followed by 9 measured rounds per engine.
The code measured was revision
[`2fda7ea`](https://github.com/zhy0216/mad-dom/commit/2fda7eaf75572a29618f9443527011886a970e0b),
whose package manifest is `0.0.1-alpha.3`. The native artifact was built from
that checkout and explicitly selected with `MAD_DOM_NATIVE_PATH`; these are
source-build measurements, not measurements of a downloaded npm binary.

[Download the raw report](https://github.com/zhy0216/mad-dom/blob/main/benchmark/results/2026-09-05-dom.json)
for all samples, medians, min/p90/MAD, workload metadata, result checks and RSS
readings. [Benchmark methodology](https://github.com/zhy0216/mad-dom/blob/main/benchmark/README.md)
documents each workload and how to derive the workflow aggregate.

Each aggregate above is the **median of per-round sums** of timed phases,
not the sum of phase medians. Core exposes this as `operations`; the testing
aggregate is derived from all 13 passing phases because the testing runner
reports scenarios individually. Speedup is happy-dom time / mad-dom time;
values below 1 mean mad-dom took longer.

These totals weight the exact workload mix below, including the separate
construction experiments. They do not predict complete application or
test-runner speedups. Framework renderers such as React/Vue, `user-event`,
jest-dom matchers and runner startup are outside this benchmark.

## Core DOM operations

At size 1×, the parsed page contains 10,304 elements and 326,405 bytes of HTML.
Mixed construction creates 20,000 elements plus a root and 4,000 text nodes;
the separate construction phases each use 20,000 nodes. Read-heavy work
samples 5,000 nodes, and mutation churn uses 2,000.

All times below are **per-phase medians in milliseconds** for the same run.

| Phase | mad-dom (ms) | happy-dom (ms) | Speedup |
| --- | ---: | ---: | ---: |
| `parse` | 9.845 | 31.415 | 3.19× |
| `buildMixed` | 31.152 | 51.809 | 1.66× |
| `queryHot` | 0.001500 | 0.003458 | 2.31× |
| `queryCold` | 5.741 | 11.014 | 1.92× |
| `getById` | 1.029 | 52.569 | 51.10× |
| `getByTag` | 0.231 | 2.693 | 11.66× |
| `serialize` | 1.007 | 5.013 | 4.98× |
| `traverseWarm` | 0.688 | 1.732 | 2.52× |
| `traverseCold` | 3.238 | 3.460 | 1.07× |
| `buildCreate` | 6.529 | 7.477 | 1.15× |
| `buildAttr` | 20.653 | 27.810 | 1.35× |
| `buildAppend` | 11.895 | 12.700 | 1.07× |
| `buildText` | 7.293 | 10.388 | 1.42× |
| `buildBulk` | 27.461 | 99.400 | 3.62× |
| `readHeavy` | 6.564 | 6.429 | 0.98× |
| `mutationChurn` | 9.416 | 80.848 | 8.59× |

mad-dom had lower medians in 15 of 16 core phases. `readHeavy` was about 2%
slower in this run. `queryHot` takes only a few microseconds, and happy-dom's
`queryHot` and `traverseWarm` samples exceeded the report's instability
threshold (MAD > 20% of the median). Small differences and those unstable
ratios should not be treated as reliable wins.

`queryHot` reruns the exact selectors after an untimed priming batch.
`traverseWarm` measures the second complete walk of an unchanged tree.
Their cold counterparts use separate, freshly parsed documents without the
warmup traversal or element-count pass. `getById` measures 100
`document.querySelector("#id")` calls, including the initial ID index build;
`getByTag` measures 20 live-collection length reads.

## Test workflows

Each phase repeats small fixture-based cases. Size 1× determines the number
of cases below; larger sizes increase case count while keeping each component
the same size. Times are for the **whole batch**, not one case.

| Scenario | Cases / round | mad-dom (ms) | happy-dom (ms) | Speedup |
| --- | ---: | ---: | ---: | ---: |
| `fixtureLifecycle` | 100 | 3.327 | 2.956 | 0.89× |
| `windowLifecycle` | 25 | 0.900 | 35.585 | 39.53× |
| `testingLibraryText` | 50 | 14.163 | 15.953 | 1.13× |
| `testingLibraryEvents` | 50 | 2.052 | 1.844 | 0.90× |
| `testingLibraryRole` | 25 | 15.495 | 16.938 | 1.09× |
| `testingLibraryLabel` | 25 | 7.177 | 6.979 | 0.97× |
| `todoInteractions` | 50 | 20.027 | 29.661 | 1.48× |
| `formSubmission` | 50 | 4.832 | 5.701 | 1.18× |
| `templateClone` | 50 | 12.243 | 16.549 | 1.35× |
| `keyedReconcile` | 50 | 5.986 | 5.876 | 0.98× |
| `asyncObserver` | 25 | 0.914 | 0.723 | 0.79× |
| `shadowComponent` | 50 | 1.757 | 2.039 | 1.16× |
| `snapshotRoundTrip` | 50 | 1.893 | 2.338 | 1.24× |

These exercise fixture/window lifecycle, text/role/label queries, event
dispatch, Todo updates, forms, template cloning, keyed reconciliation,
MutationObserver, Shadow DOM and snapshot round trips. Both engines passed
every scenario with matching case counts and SHA-256 result fingerprints.

mad-dom had lower medians in 8 of 13 scenarios. Shared-window fixture
lifecycle, Testing Library events and labels, keyed reconciliation and async
observers were slower. The aggregate includes all five.

The `windowLifecycle` result measures the current alpha's `happyDOM.close()`
path, which performs less cleanup than happy-dom's close. The benchmark checks
the scenario's DOM results, not full cancellation or resource-release parity.
This matters to that scenario and to the 1.57× workflow aggregate, which includes
it. [Lifecycle fixes are planned](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md);
their completed implementation will need a new measurement.

Fixture mounting, querying, interaction, result reads and DOM cleanup are
timed. Only `windowLifecycle` also times Window construction and
`happyDOM.close()`; other scenarios create a shared Window outside each
round's timed cases. Prebuilt strings, final assertions, hashing, explicit GC
and event-loop drains are outside the timing windows. Normal runtime GC
inside a timed operation still contributes to its duration.

## Timing and memory limits

The runner starts separate Bun processes for each engine and suite, in fixed
order: core mad-dom, core happy-dom, testing mad-dom, testing happy-dom.
It retains all measured samples after warmup and reports median, minimum,
nearest-rank p90 and median absolute deviation (MAD). This snapshot is one
machine's run in that order, without an alternating-order audit or confidence
intervals. Repeat on comparable hardware and inspect variability when a
decision depends on a small difference.

Core `total` is pipeline wall time, including fixture preparation, validation,
explicit GC and event-loop drains. Its medians here were 374.80 ms for mad-dom
and 3,252.41 ms for happy-dom. The latter was unstable (MAD > 20% of median);
the headline comparison uses the timed `operations` field instead.

The same workers reported these pipeline-end RSS changes:

| Last measured round, after GC/drain | mad-dom | happy-dom |
| --- | ---: | ---: |
| RSS change from the pre-measurement baseline | +242.3 MiB | +3,475.1 MiB |

RSS includes accumulated worker state, native allocations, wrappers, caches,
JIT and runtime GC behavior across the run. It is neither a per-document
allocation count nor a leak test. JSON `rss.perPhase.*.peak` is a point sample
before explicit GC; `after` is sampled after GC/drain. Both retain only the
last measured round and `peak` is not an OS high-water mark.

## Reproduce from source

Use a repository checkout with Bun `1.4.0` and Rust `1.93.1`:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1 --json > dom-bench.json
```

The last command performs another measurement and retains its raw JSON.
The environment variable forces the freshly built native artifact even if
an npm platform package is installed. To explore a group or workload size:

```sh
bun run bench:dom --suite testing
bun run bench:dom --suite core --runs 9 --sizes 0.1,1,2
bun run bench:dom --runs 1 --sizes 0.01
```

Defaults are `--suite all --runs 5 --sizes 1`. Core sizes scale the tree;
testing sizes scale independent case counts. The tiny run is a correctness
smoke check, not a useful performance estimate. For source comparisons, keep
the same native-path override on these commands too.

## Other benchmark commands

| Command | What it measures |
| --- | --- |
| `bun run bench:integration` | Wall time of the vendored integration suites, including subprocess startup and a local-server workload; the full group also uses external services |
| `bun run bench:check` | mad-dom's internal Rust and raw-binding metrics against an applicable recorded baseline |

The integration runner's `local` group is CommonJS, Fetch against local
Express, WindowGlobals and a standalone exception observer. It is a different
measurement from the 29 DOM workloads above. Its `full` group can fail due to
external services or behavior differences; the runner still prints timings
and does not enforce all test exit statuses. Verify correctness before using
that output for a comparison.

The internal gate catches large regressions only when a matching baseline
exists. On a new OS/architecture it records a local baseline and passes;
a green first run alone is not evidence of no regression. See the
[gate documentation](https://github.com/zhy0216/mad-dom/blob/main/bench/README.md)
for thresholds and CI baseline behavior.

## Implementation

The Rust arena stores the DOM tree; a JavaScript facade and native binding
provide the public API. Native parsing, selector matching and serialization
handle bulk work. Lazy node tokens, bounded query caches and mutation-aware
navigation/style/label caches reduce repeated boundary calls while retaining
JavaScript wrapper identity. The [boundary design
ADR](https://github.com/zhy0216/mad-dom/blob/main/adr/0007-facade-native-boundary-performance.md)
describes that trade-off. The phase timings and RSS above measure its effects
on this workload.
