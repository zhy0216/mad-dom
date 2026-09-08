# Bun FFI memory protocol and measured evidence

Task 04 preserves Node-API object lifetime and wrapper identity, with a
capability-gated FFI data path. Rust Core has no Bun/JSC dependency. The memory
contract is [ADR-0009](https://github.com/zhy0216/mad-dom/blob/main/adr/0009-bun-ffi-memory-and-gc-protocol.md) and the
[frozen ABI](https://github.com/zhy0216/mad-dom/blob/main/crates/mad-dom-bun/src/ffi/ABI.md). Version/CI policy is separate.

## Ownership

FFI borrows fixed, attached, unshared caller inputs for one synchronous call and
copies every output into a fresh JS-owned TypedArray. Owner/generation live in
`ffiContext()`; using copied tokens still requires those credentials. Buffers
remain readable independently of document destroy, later calls, transfer or GC.
The loader reads intrinsic view lengths, checks scalar bounds without coercion,
and bounds output growth. Native rejects overlapping input/output/length ranges
before creating a Rust borrow. Creation preallocates exactly 0..4096 token words
and never falls back after a malformed success that may already have mutated.

Explicit destroy drops the Core arena and wrapper/token/epoch-container
capacities synchronously. Retained native handles keep only destroyed shells;
GC is the best-effort fallback for abandoned objects. Node-API typed-array
snapshots may use napi-rs's external-buffer finalizer but own independent Vec
storage, never an arena pointer. See the ADR for its audited allocation/free
path and the callback/library lifetime rules.

## External buffer and private JSC capability matrix

Recorded 2026-09-08 UTC on Linux x64 / glibc 2.39, Rust 1.93.1. Baseline was
an isolated downloaded Bun 1.4.0; installed Bun was 1.4.2. The
[official latest release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
and release API both identified 1.4.2 when checked. Full revisions, archive and
native-image hashes, native callbacks, per-round samples and benchmark results
are preserved in [raw evidence](https://github.com/zhy0216/mad-dom/blob/main/docs/ffi-memory-evidence.json).

| Observation | Baseline 1.4.0 | Latest 1.4.2 |
| --- | --- | --- |
| Caller-owned FFI data operations | All 6 exercised; result checks pass | All 6 exercised; result checks pass |
| Abandoned N-API document after sync GC / next macrotask | Live / released | Live / released |
| Native `toArrayBuffer` context+callback and callback-only overloads | Both verified | Both verified |
| Retained TypedArray across GC and repeated document destroy | Bytes retained; callback withheld | Bytes retained; callback withheld |
| Released external buffer callback timing in this run | During sync GC | During sync GC |
| Native allocations / frees / callbacks | 258 / 258 / 258 | 258 / 258 / 258 |
| Deliberate repeated release attempts suppressed | 2 | 2 |
| External live bytes after each churn batch | 0 | 0 |
| offset=8 callback address | Original base + 8 | Original base + 8 |
| FinalizationRegistry on native wrapper / external buffer | Observed / observed | Observed / observed |
| Live Worker ↔ main FFI credentials | Both directions rejected | Both directions rejected |
| Three probed private JSC constructors visible via dlsym | No | No |
| Production FFI external-buffer / private JSC path | Disabled / disabled | Disabled / disabled |

Bun **does** publicly support a native deallocator callback in
[`toArrayBuffer`](https://bun.com/docs/runtime/ffi#memory-management). The
standalone spike compiles real C callbacks and malloc allocations; it does not
read freed memory or call JS from a GC callback. Stale generation, owner,
length/capacity, retain and destroy checks precede release. Free uses the
allocation's original base and capacity, even after its document was destroyed.
The test-only atomic guard lives in a bounded, non-reused static lease table;
it cannot itself be freed before a duplicate-release check. Callback code stays
mapped until process exit. This is a measured prototype, not a production lease
allocator: metadata reclamation, transfer/Worker/VM teardown and cross-platform
library lifetime need a separate contract before enabling it.

The private JSC spike records public `bun:jsc` exports and does native symbol
discovery without inventing a `JSContextRef`. The public
[JSC module](https://bun.sh/reference/bun/jsc) provides diagnostics; we found no
supported context/object-lifetime contract for attaching DOM wrappers. Symbol
absence is an observation on these binaries, not a universal platform claim.

## Counters and pressure results

`DocumentHandle.memoryDiagnostics()` returns a fresh JS `number[]` containing
`[liveDocuments, ffiRegistrations, wrapperCacheEntries]`. Documents/cache entries
are **process-wide**, including Workers; registrations are **calling-thread
local**. Entries include pending finalizers; a destroyed document stays
registered while any handle owns its Arc. The affinity-checked method works
after destroy and does not truncate u64 counts to u32. Fields are sampled
separately, not as a globally atomic snapshot, and are not malloc byte counters.

Each stress lane creates/destroys **2,000 Windows over 20 rounds**, following
10 warmup Windows. All 20 rounds return each lifecycle count to its original
baseline. The FFI lane records actual calls to every mounted operation; the
Node-API lane records none. RSS/heap below show the range of the final 10 rounds
in MiB; the JSON retains all samples. The shared host is not a controlled
performance lab, so these numbers support bounded growth in these workloads
and do not establish a universal leak or performance guarantee.

| Bun | FFI | Counter deltas (docs / registrations / cache) | Tail RSS MiB | Tail JS heap MiB |
| --- | --- | --- | --- | --- |
| 1.4.0 | enabled | 0 / 0 / 0 | 78.63–79.63 | 5.24–5.31 |
| 1.4.0 | disabled | 0 / 0 / 0 | 76.61–79.83 | 4.97–5.04 |
| 1.4.2 | enabled | 0 / 0 / 0 | 82.05–83.75 | 4.75–4.82 |
| 1.4.2 | disabled | 0 / 0 / 0 | 72.06–73.12 | 4.47–4.54 |

The native external-buffer spike additionally runs eight batches of 32
allocations and records zero live bytes after each batch. Rust tests verify
that retained destroyed handles have zero wrapper/token/epoch-container
capacity. N-API rematerialization tests retain the replacement wrapper across
a late old finalizer and check both identity and the cache counter.

The workload harness captures the ownership baseline **before** warmup,
separately from the warmed memory baseline. It ends allocation frames before
GC, uses the available `bun:jsc.noInline` diagnostic hook to keep handles out
of the sampling frame, collects from timer frames, and permits bounded extra
GC rounds while still requiring exact baseline equality. The original lone
wrapper contract runs in a child process to exclude other suites' deferred
finalizers. None of these controls is part of production lifecycle code.

## Reproduction and validation

```sh
bun install --frozen-lockfile
CARGO_BUILD_JOBS=3 bun run dev:build
export MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"
export MAD_DOM_FFI_PATH="$MAD_DOM_NATIVE_PATH"
export CARGO_BUILD_JOBS=3
bun run compat:hdunit:rewrite
bun run validate
bun run docs:build
MAD_DOM_FFI_DISABLED=0 bun scripts/probe-ffi-memory.mjs
MAD_DOM_FFI_DISABLED=0 bun scripts/bench-ffi-gc.mjs --json --require-ffi
MAD_DOM_FFI_DISABLED=0 bun scripts/bench-bun-native.mjs --json
MAD_DOM_FFI_DISABLED=0 bun tests/bun/fixtures/ffi-memory-digest.mjs --rounds 20 --windows-per-round 100
MAD_DOM_FFI_DISABLED=1 bun tests/bun/fixtures/ffi-memory-digest.mjs --rounds 20 --windows-per-round 100
```

Repeat with the isolated baseline executable (and put its directory first on
PATH for nested `bun run` scripts). The recorded executable was
`/tmp/mad-dom-task04-memory/baseline/bun-linux-x64/bun`; it does not replace the
global Bun. All real native tests and workloads point to this worktree's same
native image. The C spike requires a POSIX C compiler, pthreads and dlsym; it
builds temporary test images separately from the production addon.

Both full `validate` runs exited 0: JS check, Rust fmt, strict workspace clippy,
691 Rust tests, type compatibility, **1127 Bun tests / 0 failures**, ledger
(449 entries; 180 real-pair scenarios; zero regressions), hdunit rewrite/triage
(298 registered files), and the WPT gate. After the final benchmark baseline
sampling refinement, both runtimes passed all 9 memory tests again, both
FFI-required benchmarks and boundary benchmarks passed, and all four 2,000-
Window stress lanes passed. Benchmark metrics and per-operation validations
are in the evidence JSON. The release build emitted five existing Core
unused-variable warnings; strict dev-profile clippy passed without warnings.

`bun run docs:build` also passed with dead-link checking enabled. The generated
page links to the ADR, ABI and raw JSON in the repository: VitePress does not
copy those source files into the published site.

There is no task blocker. Remaining boundaries are the disabled production
external/private-JSC capabilities, finite stress coverage, and Linux-only
empirical results; no CI/release policy, dependency or remote branch changed.
