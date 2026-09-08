# Bun-native integration results

Task 07, measured 2026-09-07/08 (UTC), Linux x64/glibc. The final local repository,
capability, integration, package and benchmark checks pass on Bun baseline 1.4.0
and observed latest 1.4.2. The memory gate now has an explicit current-run stability
contract; its pass is **not** a pass under the historical signed-RSS threshold.
Old failures and all controlled measurements remain available below. Hosted CI,
other platforms, task 07 integration into main and resource cleanup are separate
coordinator steps; this report does not claim they occurred.

## Revisions and scope

The worktree started at `4a90f51bb6f98cbaf4ceab43579fb12da951ef35` (task 06),
whose parent is `49351d2c346bab2156ac029345f5e95995f379f2` (task 04). Its actual
history also contains loader/facade `4093c79ebe5ee25404d9f6954202af83223f39c2`,
host IO `06bb76475944529edaf634766ba26138f30c4061`, FFI ABI
`09a88c3496f3ed26d93858f567a2cc95170d464b`, and capability benchmark
`435a359af300d3003ce7560bdaf783fd5f6a5cdd`. No speculative WIP state is used.
Task 07's own eventual integration hash cannot appear inside its own commit;
the coordinator records it separately after integration.

| Lane | Measured Bun revision | Executable |
| --- | --- | --- |
| latest 1.4.2 | `744846f844374847c902b5e7fd59b4342a51ef99` | `/home/ubuntu/.bun/bin/bun` |
| baseline 1.4.0 | `34cbb9a40b4bd1bd767d134a7065e66c2432a676` | `/tmp/mad-dom-task04-memory/baseline/bun-linux-x64/bun` |

Both PATH and `process.execPath` select the same Bun. The benchmark child now
uses `process.execPath`, so the baseline parent cannot silently invoke latest.
Rust is 1.93.1; `CARGO_BUILD_JOBS=3`. The host is an 8-vCPU AMD EPYC VM, Linux
6.8.0, glibc 2.39, approximately 15.61 GiB RAM. Both Bun builds used the current
worktree's `build/mad-dom.node` for **both** `MAD_DOM_NATIVE_PATH` and
`MAD_DOM_FFI_PATH`; the `.so` convenience name is the same inode. The image SHA-256
is `2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`.
All three lockfiles and the committed macOS historical baseline are unchanged.

[Complete runtime, capability, ABI, host and same-image evidence](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/runtime.json).

The implementation changes are confined to benchmark evidence/acceptance and
the integration install: signed RSS handling, complete finite-value checks,
child runtime selection, isolated sampling, a fixed memory contract, exact
boundary result validation, and Bun's isolated file-dependency linker. No DOM
implementation, dependency version, platform matrix or production memory
ownership path changed in task 07.

## Required and additional validation

Both lanes ran a fresh `bun install --frozen-lockfile`, `bun run dev:build`, and
the following commands with the local native image. `compat:hdunit:rewrite`
was run before ledger evaluation, including before each full `validate` run.

| Command | Latest | Baseline | Evidence scope |
| --- | --- | --- | --- |
| `bun run check` | pass | pass | JS entry syntax |
| `cargo fmt --check` | pass | pass | workspace formatting |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass | pass | strict development-profile lint |
| `cargo test --workspace` | pass, 691 | pass, 691 | all workspace Rust tests |
| `bun run compat:types` | pass | pass | 24 fixtures, 22 positive / 2 negative, both targets |
| `bun run test` | pass, 1194 | pass, 1194 | complete selected repository Bun suite |
| `bun run compat:ledger` | pass | pass | 449 entries, 180 real pairs, 216 mapped ported cases, zero regressions/stale entries |
| `bun run compat:hdunit:rewrite` | pass | pass | 298 files prepared |
| `bun run compat:hdunit:validate` | pass | pass | 69 enabled, 22 expected-fail, 207 skipped terminal states |
| `bun run wpt:test` | pass, 5 | pass, 5 | WPT runner/selected contract, not all upstream WPT |
| `bun run test:native` | pass, 8 | pass, 8 | local native image |
| `bun run smoke:install` with actual main/platform tgz arguments | pass | pass | installed host packages, detailed below |
| `bun run bench:check` | pass | pass | original 06 throughput reference + new memory contract |
| `bun run test:integration` | pass, 10 + observer | pass, 10 + observer | configured `test:ci`, excludes the Browser scene |
| `bun run docs:build` and generated HTML inspection | pass | pass | source evidence links, not implicit JSON asset copying |

Both `bun run validate` commands passed the required syntax/Rust/types/Bun/
ledger/hdunit/WPT sequence (691 Rust and 1192 Bun tests at that checkpoint).
After the v2 RSS rule and its two tests were added, both final `bun run test`
runs passed 1194/0, followed by native and integration checks. No Rust or
production facade code changed between those validation points. The release-profile build still emits five existing
Core unused-variable warnings; the required strict development clippy run passes.
An initial gate-unit authoring test timed out because an empty array in
`test.each` was treated as callback arguments; explicit one-value tuples fixed
the fixture. Its failed log is retained, and the final full suites include
52 benchmark-focused tests on each Bun version. No remote hosted matrix, GitHub workflow, Miri/ASan lane or upstream vendor fetch
was initiated. A selected compatibility/integration gate pass does not mean all
upstream happy-dom or WPT tests pass.

[Every recorded command, environment, exit code, duration, raw log and artifact checksum](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/validation.json)
includes historical failures and final successes; local originals remain under
`/tmp/mad-dom-task07-evidence/`. Capability, boundary and IO selftests passed on
both runtimes, as did the DOM benchmark harness tests and actionlint 1.7.12 on
all three workflow YAML files.

## Clean installs and real packages

The earlier 06 `ENOENT` and its fresh-cache recovery are preserved in
[the original failed log](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/mad-dom-06-integrated-integration-install-clean.txt) and [the original recovery log](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/mad-dom-06-integrated-integration-install-fresh.txt). Task 07's new worktree and empty external Bun cache
reproduced a distinct problem despite install exit 0: the hoisted `file:../..`
copy included its own destination recursively (depth 286; 11,044 files). A
small baseline-1.4.0 experiment reproduced the same recursion. This is not
inferred solely from 06's contaminated cache.

The minimal fix is `[install] linker = "isolated"` in the integration directory's
`bunfig.toml`. With the unchanged frozen lockfile, the actual default
`bun install --frozen-lockfile` now succeeds from clean root/integration directories
and dedicated empty caches on both versions (219 root / 79 integration packages).
The installed mad-dom package points into Bun's local store; its 53 JS files match
the checkout by SHA-256 and neither root nor nested integration `node_modules`
recurs inside it. A file dependency is a stored snapshot, so reinstall after JS
source changes. This behavior matches Bun's documented
[isolated linker](https://bun.com/docs/pm/isolated-installs). Configuration,
source hashes and the original recursive tree observations are in
[installation.json](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/installation.json).

Real local packaging ran `platform:build`, `release:draft --no-build`, checksum
verification, then `smoke:install --main-tgz ... --platform-tgz ...` for enabled,
build-disabled and unavailable-symbol fixtures. The draft command uses `npm pack`
locally; nothing was published. Main tarballs contain 59 files and platform
packages four, with exactly one native image; tests, benchmarks, compatibility
data, build scripts and Cargo sources are excluded. The same main tarball SHA is
`bf19965124746c08048a46150a96b3c8f88d7da3ca0248b564ead8fc9c96ace7`.

| Platform package observation | Platform tgz SHA-256 | Install checks |
| --- | --- | --- |
| latest enabled | `b10437ac3aaf1c39f2301057703d4179a290405e25935682694e7dfd7eae3705` | latest |
| baseline enabled | `c7ef7a5bfd8d652d9f07bdd377602e92a146c554d5103bff1167c52aa1ae9d2c` | baseline |
| build-disabled | `e0269166f9c970b29be293159d2b849885fa2a8e4d524df239367479eef2ec32` | latest |
| unavailable-symbol fixture | `b6c83122fdff2929cf117b87eb3a097535806a52d8ae8867f98a01905424fcce` | both |

The unavailable fixture masks FFI export names in a test-only copy of the current
Linux binary and retains Node-API in that same image; it is never publish input.
Build-disabled metadata is an observation, not a runtime switch: compatible
exports can still mount automatically, while explicit `MAD_DOM_FFI_DISABLED=1`
forces fallback. Installed smoke checks also cover absent FFI path, mismatched
FFI ABI, partial symbols, required platform missing/unsupported, Node-API ABI
mismatch, package version/ABI/u32/capability tampering and extra-image rejection.
[Package contents, build metadata, actual checksums and all five installed smoke reports](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/release.json).

## Capability, facade and memory ownership

Both runtimes report Node-API ABI 1, FFI ABI 1, bitset 31 and all six mounted FFI
operations. Enabled, disabled and unavailable-path public DOM digests match
exactly; each process records its actual fallback state. Tests cover error codes,
wrapper identity, destroy/stale handles, cross-document and Worker affinity,
partial capability, ABI mismatch, platform choice and the single-image registry.
IO-disabled integration also passes on both runtimes.

Caller-owned copies remain the default FFI buffer protocol. Bun's deallocator
API **exists**: a real C callback spike on each runtime reports 258 allocations,
258 frees/callbacks, zero live bytes and zero invalid/foreign-thread callbacks;
two deliberate duplicates are suppressed. A retained parent buffer remains
usable across GC/destroy, including an offset-8 view whose callback observes base
+ 8. The generic capability probe's `api-present-unverified` means presence only;
it is distinct from this measured spike and from production ownership safety.

The experimental lease uses bounded, non-reused tombstone metadata; the no-context
callback variant has a single slot and the library stays mapped for process
lifetime. It does not prove safe metadata reclamation, VM rooting/affinity across
transfer/Workers/VM teardown, or safe library unload. No production external FFI
ArrayBuffer capability was added. Existing Node-API arrays own independent Vec
storage. Three private JSC constructors were not visible via `dlsym`; the private
JSC path remains disabled. See the [memory protocol](./ffi-memory-protocol.md) and
[both measured C spike reports](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/runtime.json).

## Why the RSS gate changed

The original 06 Linux baseline is preserved byte-for-byte as
[06-baseline.linux-x64.json](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/06-baseline.linux-x64.json). Its `gc_memory_growth_mb` is
-18.5703125 MiB. Multiplying this signed delta by two demanded reclamation of
37.14 MiB and rejected -22.44 MiB; the
[original 06 failure](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/mad-dom-06-baseline-bench-check.txt)
is not evidence of a demonstrated leak. The
[06 first-host recording](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/mad-dom-06-first-host-baseline.txt)
was initialization, not a regression comparison. Only OS/architecture selects
a baseline; matching Linux/x64 is not a complete CPU/VM identity check.

Task 07 initially used `2 * max(0, baseline)`, then found latest +0.38 MiB failed
its zero ceiling. Isolating churn in a non-inlined timer frame still produced
+0.34 MiB and failed. Both failures remain:
[initial zero-ceiling failure](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-latest.txt), [frame-isolated failure](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-latest-frame-fixed.txt).
This initial zero ceiling was a flawed trial definition, not a user memory
budget. It is not retained as an artificial integration blocker.

The fixed experiment used both runtimes, legacy vs isolated churn, three fresh
processes per combination, and one cold + two warmup + eight measured rounds per
process: 132 rounds, always the same 200 documents × 100 children. Finalizers show
the legacy document wrapper released only after the sampling frame ended; the
isolated document and parent were both released by sampling. This establishes
an activation-lifetime difference, not the cause of all RSS variation. Latest
isolated pooled warm RSS median was +0.359375 MiB (max +4.25), versus legacy
+0.125. All lifecycle counters remained zero.

A further six fixed fresh processes used task 04's complete three shallow timer
GC/drain passes, retaining the same cold/warmup/eight-round protocol. RSS still
varied: per-process warm medians ranged +0.013672 to +0.429688 MiB; one-round
values ranged -4.980469 to +5.101563 MiB. This did not eliminate RSS bias or prove
persistent ownership growth. Raw absolute levels, deltas, heap samples, counters,
finalizer records and exact diagnostic source are retained in
[rss-diagnostics.json](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/rss-diagnostics.json).

The final contract `mad-dom/memory-stability/2` retains the raw single-round
`gc_memory_growth_mb` as **info** and adds an independent fixed memory gate:

1. Preserve 200 documents × 100 children per round. Use eight warmup rounds and
   24 measured rounds, preallocate sample storage, end churn before exactly three
   shallow GC/drain passes, and never retry until a memory value looks better.
2. Every measured post-GC RSS/heap value must be at most twice the median of the
   last four warmup values. This is a positive-stock budget allowing one warm
   footprint of retained capacity; it is explicitly a new bound.
3. Split measurements into three consecutive blocks of eight. Reject sustained
   growth when all blocks have positive lower-quartile pairwise slopes (at least
   75% of pairs rise) and strictly increasing block medians. Flat/oscillating
   levels, a bounded plateau and an isolated spike are not automatically trends.
   **RSS additionally fails** when all three block medians rise and its
   full-curve lower-quartile pairwise slope × 8 exceeds the median of the three
   within-block IQRs. This requires projected growth over a whole block to exceed
   typical within-block spread, with no fitted absolute-byte tolerance. The
   lower-quartile slope is the sorted pairwise-slope element at floor(n/4);
   an IQR is sorted-value[6] minus sorted-value[2] for each eight-value block.
   Heap retains the local-block rule; globally positive heap drift alone is not
   enough, as all six retained normal heap curves had small positive global
   slopes (about 480–539 B/round). This is a deterministic signal/spread rule,
   not an independence assumption or a statistical confidence interval.
4. All document/registration/cache counters must be zero in all warmup/measured
   samples and the independent facade/FFI digest. Missing or non-finite data,
   missing counters or an incomplete workload cannot pass.

No absolute MiB allowance was fitted to +0.34. Tests cover negative/zero/positive
historical deltas, missing evidence on either/both sides, NaN/infinities/strings,
positive-stock exact boundaries, bounded oscillation/steps/spikes, sustained
increases as small as one byte per round in synthetic series, and lifecycle
failures. First-host and explicit baseline recording share the validation path:
invalid current metrics or growing/invalid memory evidence cannot create or
replace a baseline. `--json` remains raw collection without gate/record semantics.

Under the earlier v1 prototype, six fixed normal-process repetitions passed. Real per-round retention of 1 MiB
of TypedArray bytes or JS numeric-array storage is rejected by the heap bound
and trend on both runtimes, while owners/caches remain zero. Bun counts those
TypedArray backing bytes in `heapUsed`; the initial RSS-specific control assertion
failed even though the overall gate rejected the retained memory. Those failed
assertions are preserved and the control is accurately named `buffer`. RSS alone
can still fall while other pages are reclaimed. This is not an independent
native-malloc-only negative control, and it does not establish sensitivity to
every hidden native leak. The Buffer/heap control runs themselves did not change thresholds.

The coordinator independently added a **native-only** control: C `malloc` plus
one write per 4 KiB page, 1 MiB per measured round, 24 MiB total retained by a
native static pointer table. No ArrayBuffer holds or accounts for those bytes.
On both runtimes, only the RSS trend gate rejects it; heap and owner checks
pass, and the native helper frees all 24 blocks. This supplies an independent RSS-branch sensitivity observation that the Buffer
control alone could not supply; it is not a guarantee of rejection on every run.
Latest block RSS medians were 74.848 / 83.004 / 92.309 MiB; baseline
66.662 / 71.730 / 82.396 MiB. Both remained below their positive-stock bounds,
so the trend rule catches growth before the coarse bound is crossed.
The original [latest result](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-native-rss-latest.json),
[baseline result](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-native-rss-baseline.json)
and [source provenance](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-provenance.json)
are preserved. The tiny helper has no DOM registry; mad-dom still uses the one
worktree image for Node-API/FFI. This Linux diagnostic does not expand platform
support or prove sensitivity to every smaller/slower/native leak.

Portable source copies remove the coordinator's absolute imports:
[C helper](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-control.c)
and [Bun control](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-control.mjs).
Task 07 also compiled and ran the portable copy once per runtime. Baseline
correctly rejected native growth, but the extra latest run **missed it** and
failed the sensitivity assertion. That first portable script emitted JSON only
after the assertion, so its curve was lost; the
[failed assertion log](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-portable-latest.txt)
is preserved and does not support attribution to a particular RSS dip. Moving
reporting into `finally` preserves samples on either outcome. One subsequent
latest run with that logging correction rejected growth and freed all 24 blocks;
its success does not erase the earlier miss. That run changed no gate thresholds
or sampling counts. The later v2 validation uses a separately predeclared fixed
set of new normal and native-growth controls, with every curve emitted. The
[baseline portable report](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-portable-baseline.json)
and [latest report after logging correction](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/native-rss-portable-latest-with-log.json)
include `releasedBlocks: 24`. This observed miss is a concrete limit of the
earlier fixed all-three-block trend rule: even 1 MiB/round of retained native allocation
can escape RSS detection in an individual finite run. The independent controls
validate sensitivity, not guaranteed completeness. This prompted the bounded v2 correction above, preserving the original
local/stock/counter checks while adding the RSS full-curve condition. A noisy
block interrupting local trend is a plausible rule-level mechanism, not a
verified explanation of the lost curve. The lost run cannot be retroactively
claimed fixed or regraded. All outcomes remain explicit.

Run from the repository root with the selected Bun first on PATH and both
native overrides pointing to `build/mad-dom.node`:

```sh
mkdir -p build/07-integration
cc -shared -fPIC docs/bun-native-runtime-evidence/native-rss-control.c -o build/07-integration/native-rss-control.so
bun docs/bun-native-runtime-evidence/native-rss-control.mjs ./build/07-integration/native-rss-control.so
```

[All stability repetitions, real negative controls and final raw reports](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/memory-policy.json).

| Earlier v1 comparison (retained) | Raw single-cycle RSS (info) | Post-GC RSS peak / warm stock | Heap peak / warm stock | Result |
| --- | --- | --- | --- | --- |
| latest vs original 06 reference | -10.16 MiB | 101.961 / 100.449 MiB | 3.410 / 3.387 MiB | 18 historical metrics + 5 current memory checks pass |
| baseline vs original 06 reference | -15.97 MiB | 105.508 / 104.436 MiB | 3.903 / 3.880 MiB | 18 historical metrics + 5 current memory checks pass |

[Earlier v1 latest gate](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-latest-policy-final.txt); [earlier v1 baseline gate](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-baseline-policy-final.txt).
The v2 rule was checked against every retained comparable curve without editing
its samples: eight earlier normal curves passed and ten earlier growth curves
were rejected. Earlier schema tags were translated only in memory for explicit
re-evaluation, not written back or misrepresented as new measurements. Legacy
activation diagnostics and Window workloads have different contracts and are
listed as ineligible; missing curves are never counted as a pass.

The first fixed v2 set ran both versions × three normal/native repetitions. All
six normal runs passed, and five native runs rejected RSS growth. The remaining
latest native repetition **did not reach the memory gate**: the subsequent
same-process `memoryDigest` raised `ffiRegistrations=1` in round 7 (documents and
cache entries were zero). Its stdout contains only `releasedBlocks: 24`, so
this is neither a saved RSS curve nor evidence of an RSS miss. The
[original lifecycle failure](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/memory-policy-v2-latest-native-3.txt)
is retained. No RSS rule changed in response to that failure.

The native-only control now saves its completed curve before calling any later
diagnostic and runs the independent FFI digest in a fresh same-Bun child with the
same native-image overrides, matching the isolation used by task 04's strict
counter tests. Parent counts still must be zero in every RSS sample, and child
FFI counts must be zero independently. This separates C pressure from the FFI
finalizer activation; it does **not** determine the original GC/JIT root cause
or prove a production lifecycle defect fixed. The observed same-process
pressure/FFI-registration failure remains a limitation of that combined
experiment. Production ownership code and counter tolerances are unchanged.

A second, final fixed set used two versions × three normal/native repetitions,
with the RSS rule and counts unchanged. All six normal runs passed; all six
native controls were rejected by RSS trend alone, with heap checks passing,
parent/child lifecycle counts zero and `releasedBlocks: 24`. Every final run
emitted its complete curve. There were no retries within that set. Its 12 curves
and the first set, including the incomplete lifecycle run, are in
[fixed v2 experiments](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/memory-policy-v2.json).
[Re-evaluation source](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/review-memory-curves.mjs)
and [results](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/memory-policy-v2-retained-review.json)
apply the final rule to all 43 retained complete fixed-workload curves: 22
normal curves pass and 21 growth curves are rejected. Incomplete/incompatible
evidence is listed explicitly.

The final formal `bench:check` runs use the original 06 Linux reference for the
18 historical metrics and the v2 current-run memory contract. Both exit 0:
[latest final v2 gate](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-latest-v2-final.txt),
[baseline final v2 gate](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/bench-check-baseline-v2-final.txt).
| Final v2 formal run | Raw RSS delta (info) | RSS peak / warm stock (MiB) | Heap peak / warm stock (MiB) |
| --- | --- | --- | --- |
| latest 1.4.2 | +0.47 MiB | 145.762 / 145.527 | 3.411 / 3.388 |
| baseline 1.4.0 | +0.25 MiB | 145.195 / 144.545 | 3.914 / 3.892 |

The raw RSS delta remains informational, not a recreated historical memory pass.
The higher warm RSS than the earlier v1 observations is visible here: the warm
stock contract does not bound cold/allocator footprint across processes or
versions, and zero lifecycle counters do not account for every allocated byte.
The accompanying v2 JSON collection is a separate process and is also retained
in `memory-policy-v2.json`.

The separate raw JSON collection is a different process and has different RSS
samples. Neither a first-host green initialization nor an old/new RSS delta is
represented as the same historical threshold pass. The new deterministic smoke
contract has a finite horizon; slow/staircase/native-only growth masked by RSS
reclamation, a high cold footprint or memory retained before the warm reference
can escape it. It is not a statistical confidence interval or universal leak
proof. Core retained-capacity tests and strict owner counts remain independent.

## Performance methodology

Measurements ran serially without other plan agents. All raw rounds, cold
observations, warmups, result checks and allocation/RSS observations are in
[measurements.json](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/measurements.json); [per-phase medians and aggregate samples](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/performance-summary.json)
are separately available. Fixed engine/path/mode ordering was not randomized or
ABBA-balanced. VM scheduling, JIT and allocator state remain confounders; even the
unchanged happy-dom comparator varied across runs. These observations do not
isolate Bun-version or FFI causality and are not speed guarantees.

`bench:dom --runs 9 --sizes 1 --json` ran in both FFI modes on both Bun versions,
with two warmups and nine recorded rounds, covering 16 Core and 13 testing
scenarios. All workload/result fingerprints agree across rounds and engines.
Cold/hot DOM labels refer to query/navigation caches, not fresh-process startup.
The aggregates below are medians of per-round sums, not sums of phase medians.

| Bun / FFI | Core mad-dom / happy-dom (ms) | Testing mad-dom / happy-dom (ms) |
| --- | --- | --- |
| latest-enabled | 442.86 / 1452.27 | 318.42 / 421.55 |
| latest-disabled | 375.87 / 1345.37 | 287.76 / 402.51 |
| baseline-enabled | 385.91 / 1666.71 | 285.84 / 381.82 |
| baseline-disabled | 421.80 / 1591.92 | 285.76 / 415.77 |

On latest, FFI-enabled aggregate time was 17.8% higher for Core and 10.7% higher
for testing than disabled; baseline Core was 8.5% lower and testing effectively
unchanged. These regressions are reported, not hidden behind faster raw boundary
calls. All mad-dom phase medians follow (milliseconds, the same nine rounds).

| Scenario | latest on | latest off | baseline on | baseline off |
| --- | --- | --- | --- | --- |
| parse | 26.4825 | 24.8384 | 26.0389 | 25.5768 |
| buildMixed | 104.6361 | 86.5003 | 98.8610 | 102.3930 |
| queryHot | 0.0043 | 0.0032 | 0.0049 | 0.0057 |
| queryCold | 15.8308 | 12.8653 | 11.9671 | 14.5113 |
| getById | 3.5890 | 2.6343 | 2.6040 | 3.2191 |
| getByTag | 1.2088 | 0.7941 | 0.8165 | 1.1125 |
| serialize | 4.6638 | 2.2286 | 3.9078 | 2.3988 |
| traverseWarm | 1.0727 | 1.1095 | 1.1137 | 1.2105 |
| traverseCold | 15.3058 | 9.0457 | 10.2825 | 13.2225 |
| buildCreate | 22.0884 | 17.8588 | 17.6242 | 19.0840 |
| buildAttr | 63.1481 | 52.5801 | 55.6317 | 61.8785 |
| buildAppend | 37.1387 | 28.7344 | 28.0142 | 32.5478 |
| buildText | 23.9636 | 18.3399 | 19.2554 | 20.9029 |
| buildBulk | 75.6273 | 69.7455 | 69.6004 | 71.5209 |
| readHeavy | 21.9239 | 16.0424 | 16.8383 | 19.7438 |
| mutationChurn | 25.5423 | 21.1544 | 21.2459 | 23.3955 |
| fixtureLifecycle | 9.4678 | 8.9332 | 8.7287 | 8.5267 |
| windowLifecycle | 30.7098 | 30.2680 | 30.2571 | 30.1982 |
| testingLibraryText | 49.4544 | 41.8687 | 43.8330 | 39.0389 |
| testingLibraryEvents | 7.1150 | 6.6280 | 6.3956 | 6.4787 |
| testingLibraryRole | 51.0062 | 49.0821 | 47.6568 | 46.7002 |
| testingLibraryLabel | 20.0006 | 18.6496 | 18.0425 | 18.8532 |
| todoInteractions | 55.8176 | 52.6855 | 52.5009 | 51.3605 |
| formSubmission | 13.6259 | 12.7583 | 12.8696 | 12.9317 |
| templateClone | 40.5555 | 36.8948 | 36.3022 | 38.0527 |
| keyedReconcile | 18.3433 | 16.4516 | 16.5831 | 17.5735 |
| asyncObserver | 2.9237 | 2.5323 | 2.5491 | 2.6431 |
| shadowComponent | 5.7841 | 5.2341 | 4.9065 | 5.5688 |
| snapshotRoundTrip | 6.4474 | 4.9189 | 5.2959 | 4.9106 |

### Native boundary

Each runtime used one first complete invocation, two warmups and five measured
invocations: 10,000 calls, batch size 32, and a 4,096-node query fixture (large
queries cap iterations at 128). Cold here excludes import timing and does not
flush OS caches. Every result validates exact counts/shape/serialized output.
The initial snapshot comparison incorrectly used 67 Node-API words versus 131
FFI words; it is preserved as
[boundary-initial-sanity.json](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/boundary-initial-sanity.json)
and excluded from formal results. Both paths now use the same detached main plus
32 empty spans (67 packed words), ignoring only opaque token ids in shape checks.
Serialization checks exact output instead of substring presence. Tests reject
mismatched snapshot shapes and invalid serialized output.

Raw FFI uses reusable caller buffers and packed bytes; decoding/materializing
wrappers or strings is outside that timer. Boundary advantages do not measure
the entire public facade operation. The table reports Node-API / FFI nanoseconds
per call, with first invocation and warm median separated.

| Workload | latest cold | latest warm | baseline cold | baseline warm |
| --- | --- | --- | --- | --- |
| boundary.single-call | 868.2 / 462.3 | 674.0 / 445.0 | 886.4 / 451.6 | 710.6 / 490.7 |
| token.batch | 13243.1 / 10095.4 | 11956.0 / 10448.2 | 13733.4 / 10566.8 | 15415.2 / 13324.3 |
| query.snapshot | 13581.0 / 6593.5 | 12807.1 / 6761.7 | 12564.5 / 6952.2 | 13954.2 / 7387.2 |
| serialize.string | 5963.5 / 4810.0 | 5995.2 / 4833.1 | 5983.3 / 4972.5 | 6448.0 / 5120.3 |
| snapshot.bytes | 2503.0 / 970.6 | 2645.9 / 959.0 | 2436.6 / 958.6 | 2742.9 / 1030.4 |
| large-document.snapshot | 1417646.8 / 692870.3 | 1494368.7 / 694216.7 | 1417091.8 / 703697.4 | 1679949.3 / 756633.5 |

### Host IO

The same cold/two-warmup/five-measurement protocol uses 1 MiB inputs, 300 file
reads, 200 writes, 40 spawns, 300 virtual-file reads and 20 synchronous fetches
per invocation. Body bytes, hashes and exit/status semantics match both paths.
The following milliseconds per operation are Bun / fallback; they include the
whole operation defined by the IO harness.

| Workload | latest cold | latest warm | baseline cold | baseline warm |
| --- | --- | --- | --- | --- |
| read.file | 0.4499 / 0.4832 | 0.5290 / 0.5099 | 0.6125 / 0.5469 | 0.5030 / 0.4869 |
| write.file | 1.4003 / 0.3634 | 1.3894 / 0.3399 | 1.4718 / 0.3408 | 1.3868 / 0.3449 |
| spawn.child | 4.7400 / 4.7420 | 5.0981 / 5.0121 | 6.6885 / 6.5488 | 5.9638 / 5.7685 |
| virtual-server.file | 0.8132 / 1.0222 | 0.9302 / 0.9282 | 1.1889 / 1.0504 | 0.9781 / 0.9624 |
| sync-fetch.child | 8.4173 / 8.1489 | 7.9236 / 7.9408 | 9.9004 / 9.6459 | 8.9322 / 9.2602 |

Bun writes were about four times slower than fallback on this host in both
versions. Reads and spawn did not show a consistent benefit; virtual serving and
sync fetch were close. Sync fetch still starts a Bun child per request, so its
fixed process cost has not been eliminated. No incidental IO optimization was
introduced to hide these results. The reproducible sampling script is
[measure.mjs](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/measure.mjs).

### Facade/FFI GC, RSS and heap

Each of four runtime/mode groups used ten warmup Windows, then 20 rounds of 100
Windows (query/snapshot/serialize/batch/mutation/destroy). All three counters were
zero every round; enabled runs actually called all six FFI methods, disabled
runs called none. The table preserves whole-run growth and the final-ten-round
range; the warm tail alone must not hide the initial increase.

| Bun / FFI | whole-run RSS / heap growth (MiB) | tail RSS range (MiB) | tail heap range (MiB) |
| --- | --- | --- | --- |
| latest-enabled | 23.027 / 0.831 | 72.852–74.270 | 4.751–4.820 |
| latest-disabled | 30.668 / 0.705 | 80.477–81.574 | 4.473–4.542 |
| baseline-enabled | 30.090 / 0.824 | 82.965–84.965 | 5.243–5.311 |
| baseline-disabled | 23.645 / 0.706 | 74.363–76.641 | 4.970–5.037 |

These finite workloads and exact owner counts support the documented lifecycle
contract, not a complete native malloc ledger or every possible DOM workload.
Cross-mode RSS differences include allocator/process state and are not clean
attribution of FFI overhead or savings.

## Documentation and remaining boundaries

Evidence links deliberately use GitHub **source URLs**. VitePress does not copy
ordinary linked JSON files into `dist`; final HTML inspection checks that those
URLs are emitted and map to evidence files in this source tree. The new report
is reachable from the generated performance page. JSON assets are not assumed to
exist at `/mad-dom/bun-native-runtime-evidence/`. Source URLs become public with
the corresponding repository publication; this local task does not push or
publish them. Generated-link checks and HTML hashes are retained in
[documentation verification](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/documentation.json).

The alpha platform boundary is unchanged. Only Linux x64/glibc was built and
installed locally; musl, non-host CPUs/OSes and the remote hosted matrix remain
unverified here. Future `latest` is dynamically resolved and needs its own actual
version/revision/probe evidence. Existing selected compat/WPT/integration checks
retain their scope. Production FFI still uses caller-owned copies, private JSC
integration is disabled, and experimental lease VM/rooting/library-lifetime
restrictions remain. Performance observations include regressions and the memory
contract has the finite detection limits described above.
