# ADR-0009：Bun FFI memory and GC protocol

- Status: accepted for T4 (`04-memory-gc-and-external-buffers.md`)
- Date: 2026-09-08
- Scope: `plans/bun-native-runtime/todos/04-memory-gc-and-external-buffers.md`

## Context

The additive Bun FFI fast path (ADR-0008, T2/T3) writes every output into
caller-owned typed arrays. The FFI ABI is experimental and does not manage
native memory, so T4 must fix the ownership/lifecycle rules for every byte
that crosses the channel, decide whether an external (native-owned)
ArrayBuffer + deallocator can ever ship, prove that GC/finalizer delays do not
make correctness GC-dependent, and produce leak evidence that does not rest on
a few RSS samples.

## Decision

### Ownership classes

- **Document/node native state**: owned by Rust `Arc`, released by explicit
  `destroy()` *or* the last wrapper finalizer. `destroy()` is the
  deterministic, GC-independent free path: it drops the Core document/arena
  immediately, clears the weak wrapper cache and marks the FFI generation
  terminal. GC-driven release of *abandoned* documents is best-effort and is
  never required for correctness.
- **FFI inputs**: caller-owned, borrowed only for the synchronous call, never
  retained natively.
- **FFI outputs**: caller-owned copies into JS typed arrays. **No external
  (native-owned) ArrayBuffer crosses the FFI ABI in v1.**

### External ArrayBuffer / deallocator: rejected for v1 (spike result)

Empirical probe on Bun 1.4.2 and baseline 1.4.0:

- `bun:ffi.toArrayBuffer(ptr, byteOffset?, byteLength?)` returns a zero-copy
  *view* over caller memory. The bun-types contract documents that passing an
  invalid pointer or reading past the allocation "can crash the program or
  cause undefined behavior"; there is no ownership-transfer argument, no
  deallocator, and no detach hook. An ArrayBuffer obtained this way keeps
  pointing at freed memory after the native allocation is released (observed:
  it stays readable after `free()` with garbage contents) — a use-after-free
  hazard, not a stable contract.
- The library-handle lifetime is the other half of the same hazard: raw
  `library.symbols` pointers are only valid while their shared object stays
  mapped. The loader therefore pins every opened dlopen handle on the adapter
  for the process lifetime (it never calls `.close()`; the image is the same
  `.node` Node-API keeps loaded) and never exposes `toArrayBuffer`-style views.

Consequence: a caller-owned copy is the default and only FFI output. If a
zero-copy external buffer is ever required it must be created on the Node-API
side (`napi_create_external_arraybuffer`, whose finalizer is the deferred
Node-API finalizer this ADR measures), guarded by a deallocator that runs at
most once, and bound to the document owner/generation credential. That path
remains out of v1.

### Mutating FFI entries are single-shot

`mad_dom_ffi_create_elements` mints a batch of detached nodes. Native already
orders its capacity check before any creation (a `BUFFER_TOO_SMALL` is side
effect free), and the loader additionally serves createElements with a
single-shot, exactly-sized buffer (`outputWordsExact`) so a mutating C entry is
never re-invoked by a retry loop. A repeated successful call would mint a
second batch and leak it; both layers prevent that.

### Deterministic lifecycle counters

RSS/heap deltas fluctuate without meaning a leak, so release is proven with
process/thread-scoped counters that must return *exactly* to baseline after a
bounded churn. They are read with `DocumentHandle.memoryDiagnostics()`, which
returns `[liveDocuments, ffiRegistrations, wrapperCacheEntries]` for the
calling thread/isolate and works even on a destroyed handle:

- `liveDocuments` — live Core documents.
- `ffiRegistrations` — documents registered in the *calling thread's* FFI
  owner registry (lazily minted by the first `ffiContext()`, released when the
  document's last ownership `Arc` drops). The registry is thread-local and
  holds only `Weak` references, which is also the cross-thread/isolate guard
  for the FFI channel (see below).
- `wrapperCacheEntries` — total live entries across every per-document weak
  wrapper cache (incremented only on a fresh mint, decremented on wrapper
  eviction and destroy). `destroy()` clears its document's cache eagerly, so
  even a never-collected wrapper cannot linger as a cache entry.

These three are the acceptance "native allocation/lifecycle counter" evidence
in `tests/bun/ffi-memory.test.js`, `tests/bun/gc.test.js` and
`scripts/bench-ffi-gc.mjs`; RSS remains corroborating only.

### Cross-thread / Worker isolation is not bypassed by FFI

The FFI owner registry is a per-thread `thread_local`, mirroring the Node-API
affinity guard (`crate::affinity`). Replaying a context minted on another
thread/isolate resolves to no owner and fails with `INVALID_DOCUMENT` (3). The
safety suite replays a Worker-minted context on the main thread and a
main-thread context in a Worker and asserts both are rejected.

### GC/finalizer timing is a recorded matrix result, not a dependency

Node-API finalizers are deferred by Bun to a later event-loop turn. T4 measures
the timing (synchronous vs deferred after `Bun.gc(true)`) on the current
runtime and records it as data (`finalizerTiming` in the memory fixture). The
tests assert only the monotonic/eventual facts — release happens after a
bounded GC + macrotask drain, and explicit `destroy()` never needs GC — so
business correctness does not depend on `Bun.gc()`.

### Direct JavaScriptCore objects: not a production path

No stable public Bun contract exists to wrap a Rust-owned object or buffer with
a JSC-side finalizer outside Node-API, and version-pinned private JSC entry
points contradict the follow-latest policy (ADR-0008). The capability record
keeps `jscPrivateApi.defaultPath: false`. No default production path uses it.

## Consequences

- v1 FFI outputs stay caller-owned copies; deallocator-once logic is not
  runtime-reachable and is specified (in `crates/mad-dom-bun/src/ffi/ABI.md`)
  for any future external buffer rather than implemented untested.
- The loader pins dlopen handles and never repeats mutating entries.
- Tests and the benchmark assert counter baselines, not RSS noise.
- Rejected-feature reasons and the upgrade boundary are recorded here and in
  `docs/ffi-memory-protocol.md`.
