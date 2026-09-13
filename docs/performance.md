# Performance

**3.24× faster core DOM work. 1.40× faster test workflows.** These are the
aggregate results of the source-build run below, with matching workload checks
for both engines. Parsing was 3.64× faster, serialization 3.01×, and mutation
churn 17.57× in the same run. The full tables include every measured phase.

mad-dom is compared with **happy-dom 20.11.11** using the same deterministic
DOM workloads through each engine's public API. The benchmark covers
**16 core phases** and **13 test workflows**, including actual
`@testing-library/dom@10.4.1` queries and events.

## Recorded results

The **2026-09-12 source-build run** produced matching workload checks for both
engines and passed all 13 test scenarios (`valid: true`).

| Timed workload | mad-dom | happy-dom | Speedup |
| --- | ---: | ---: | ---: |
| Core operations, 16 phases | **407.14 ms** | 1321.15 ms | **3.24×** |
| Test workflows, 13 scenarios | **294.31 ms** | 412.66 ms | **1.40×** |

Environment: AMD EPYC Processor (8 vCPUs, shared KVM host), 15.6 GiB RAM,
Ubuntu 24.04 Linux x64, glibc 2.39, Bun 1.4.2 (`744846f84`), Rust 1.93.1;
size 1×, 2 warmup rounds followed by 9 measured rounds per engine.
The report date uses America/Los_Angeles; the environment record includes UTC
timestamps. Bun 1.4.2 was verified as the latest stable release before sampling
by `bun upgrade` and the official
[release API](https://api.github.com/repos/oven-sh/bun/releases/latest).
The code measured was revision
[`1733855`](https://github.com/zhy0216/mad-dom/commit/173385575039d41181e80b45c2933323ce0f5db8),
whose package manifest is `0.0.1-alpha.3`. The native artifact was built from
that checkout and explicitly selected with `MAD_DOM_NATIVE_PATH`; these are
source-build measurements, not measurements of a downloaded npm binary.
Node-API ABI 1 and FFI ABI 1 were available, with FFI capability bitset 31 and
both loaders pointing to the same image. The run uses the default public API
routing with FFI enabled; availability does not force every operation onto FFI.

[Download the raw report](https://github.com/zhy0216/mad-dom/blob/main/benchmark/results/2026-09-12-dom.json)
for all samples, medians, min/p90/MAD, workload metadata, result checks and RSS
readings. [Benchmark methodology](https://github.com/zhy0216/mad-dom/blob/main/benchmark/README.md)
documents each workload and how to derive the workflow aggregate.
The [environment record](https://github.com/zhy0216/mad-dom/blob/main/benchmark/results/2026-09-12-dom-environment.json)
contains the command, complete Bun revision, host and capability reports, and
SHA-256 hashes of the runtime, native image, lockfiles and raw report.

The earlier [2026-09-05 macOS/Bun 1.4.0 samples](https://github.com/zhy0216/mad-dom/blob/main/benchmark/results/2026-09-05-dom.json)
remain available as historical evidence. Hardware, source and runtime differ;
the two records do not isolate a Bun upgrade or a code change.

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
| `parse` | 25.700 | 93.445 | 3.64× |
| `buildMixed` | 93.757 | 143.667 | 1.53× |
| `queryHot` | 0.004519 | 0.009578 | 2.12× |
| `queryCold` | 12.881 | 24.103 | 1.87× |
| `getById` | 2.755 | 195.432 | 70.94× |
| `getByTag` | 0.775 | 5.094 | 6.58× |
| `serialize` | 4.152 | 12.491 | 3.01× |
| `traverseWarm` | 1.161 | 4.099 | 3.53× |
| `traverseCold` | 12.511 | 5.632 | 0.45× |
| `buildCreate` | 17.823 | 16.775 | 0.94× |
| `buildAttr` | 56.801 | 78.476 | 1.38× |
| `buildAppend` | 29.349 | 39.820 | 1.36× |
| `buildText` | 17.420 | 13.017 | 0.75× |
| `buildBulk` | 71.319 | 279.270 | 3.92× |
| `readHeavy` | 17.848 | 12.631 | 0.71× |
| `mutationChurn` | 21.629 | 379.921 | 17.57× |

mad-dom had lower medians in 12 of 16 core phases. `traverseCold`,
`buildCreate`, `buildText` and `readHeavy` were slower. mad-dom's `traverseCold`
samples exceeded the report's instability threshold (MAD > 20% of the median).
`queryHot` takes only a few microseconds. Small differences and unstable
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
| `fixtureLifecycle` | 100 | 8.882 | 10.393 | 1.17× |
| `windowLifecycle` | 25 | 30.650 | 45.725 | 1.49× |
| `testingLibraryText` | 50 | 45.796 | 54.624 | 1.19× |
| `testingLibraryEvents` | 50 | 6.576 | 6.615 | 1.01× |
| `testingLibraryRole` | 25 | 47.720 | 57.575 | 1.21× |
| `testingLibraryLabel` | 25 | 19.183 | 23.796 | 1.24× |
| `todoInteractions` | 50 | 54.613 | 91.961 | 1.68× |
| `formSubmission` | 50 | 13.118 | 20.493 | 1.56× |
| `templateClone` | 50 | 37.829 | 60.408 | 1.60× |
| `keyedReconcile` | 50 | 18.056 | 21.092 | 1.17× |
| `asyncObserver` | 25 | 2.695 | 2.412 | 0.90× |
| `shadowComponent` | 50 | 5.359 | 7.509 | 1.40× |
| `snapshotRoundTrip` | 50 | 5.257 | 8.025 | 1.53× |

These exercise fixture/window lifecycle, text/role/label queries, event
dispatch, Todo updates, forms, template cloning, keyed reconciliation,
MutationObserver, Shadow DOM and snapshot round trips. Both engines passed
every scenario with matching case counts and SHA-256 result fingerprints.

mad-dom had lower medians in 12 of 13 scenarios. `asyncObserver` was slower
and remains in the aggregate. `testingLibraryEvents` differed by only about
0.6%, so its 1.01× ratio is effectively a near tie in this single run.

The `windowLifecycle` row measures the current `happyDOM.close()` implementation,
including task cancellation, scoped cleanup and an idle checkpoint. It
supersedes the partial-close timing in the historical September 5 snapshot;
[lifecycle implementation evidence](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/results.md)
is retained separately.

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
shared KVM host's run in that order, without an alternating-order audit or
confidence intervals. Repeat on comparable hardware and inspect variability when a
decision depends on a small difference.

Core `total` is pipeline wall time, including fixture preparation, validation,
explicit GC and event-loop drains. Its medians here were 969.86 ms for mad-dom
and 7,833.87 ms for happy-dom. The latter was unstable (MAD > 20% of median);
the headline comparison uses the timed `operations` field instead.

The workers reported these RSS changes from their own pre-measurement baselines
at the end of the last measured round:

| Last measured round, after GC/drain | mad-dom | happy-dom |
| --- | ---: | ---: |
| Core worker RSS change | +15.8 MiB | +3362.1 MiB |
| Testing worker RSS change | +28.1 MiB | +9.0 MiB |

RSS includes accumulated worker state, native allocations, wrappers, caches,
JIT and runtime GC behavior across the run. It is neither a per-document
allocation count nor a leak test. JSON `rss.perPhase.*.peak` is a point sample
before explicit GC; `after` is sampled after GC/drain. Both retain only the
last measured round and `peak` is not an OS high-water mark.

## Reproduce from source

Always use the **latest stable Bun** for new measurements: run `bun upgrade`
before sampling, then record the actual version and revision. This run used
Bun `1.4.2` and Rust `1.93.1`. `.bun-version` (`1.4.0`) is reserved for dedicated
baseline checks and historical reproduction; the support floor remains
`engines.bun >=1.4.0`. Reproducing a dated record requires its source revision,
dependencies, runtime, hardware and capability settings.

From a repository checkout:

```sh
bun upgrade
bun --version
bun --revision
bun install --frozen-lockfile
bun run dev:build
export MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"
export MAD_DOM_FFI_PATH="$PWD/build/mad-dom.node"
export MAD_DOM_FFI_DISABLED=0
bun run report:runtime --require-native > dom-runtime.json
bun run bench:dom --runs 9 --sizes 1 --json > dom-bench.json
```

The last command performs one measurement and retains its raw JSON; omit
`--json` and the redirection to print tables instead. The environment variables
select the freshly built native artifact for both loaders even if an npm
platform package is installed. To explore a group or workload size:

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

The [Bun-native integration measurements](./bun-native-runtime-results.md)
record Linux Bun 1.4.0/1.4.2 with FFI enabled and disabled, cold/warm boundary
and host IO samples, GC/heap/RSS pressure, and the corrected signed-RSS gate.
They are separate historical measurements from the September 12 comparison above.

## Bun-native boundary comparison (2026-09-10, plan bun-native-performance)

A separate frozen-source program measured the Bun public API boundary with
balanced two-ABBA new-process campaigns: the frozen reference versus the
merged candidate (snapshot packing, FFI adapter scratch reuse, facade UTF-8
decoder), plus same-image FFI off/on and a Node-API fallback lane, on Bun
1.4.0 and 1.4.2 (dated observation) on Linux x86_64. On the default public
configuration the facade HTML getters are 36–44% faster and large cold queries
27–31% faster than the reference, stable on both runtimes; Core/Testing
aggregates show no regression. The internal FFI serializer remains slower for
large serialization (mode-comparison only), which is why it is not the default
there; a disclosed ±6–16% binary-layout drift band on untouched Node-API
micro paths persists on the shared VM. All 472 formal processes, noise flags,
regression dispositions and limits are recorded in
[results.md](https://github.com/zhy0216/mad-dom/blob/main/plans/bun-native-performance/results.md),
[the final conclusions](https://github.com/zhy0216/mad-dom/blob/main/plans/bun-native-performance/evidence/final/conclusion.md)
and the raw
[phase tables](https://github.com/zhy0216/mad-dom/blob/main/plans/bun-native-performance/evidence/final/combined-tables.md).
Reproduce with `bun run bench:bun-performance` (see the
[runner documentation](https://github.com/zhy0216/mad-dom/blob/main/benchmark/bun-performance/README.md));
these Linux boundary numbers are separate from every other record above.

## Implementation

The Rust arena stores the DOM tree; a JavaScript facade and native binding
provide the public API. Native parsing, selector matching and serialization
handle bulk work. Lazy node tokens, bounded query caches and mutation-aware
navigation/style/label caches reduce repeated boundary calls while retaining
JavaScript wrapper identity. The [boundary design
ADR](https://github.com/zhy0216/mad-dom/blob/main/adr/0007-facade-native-boundary-performance.md)
describes that trade-off. The phase timings and RSS above measure its effects
on this workload.
