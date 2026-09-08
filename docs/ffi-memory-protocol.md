# Bun FFI memory protocol

This page is the operational description of the memory/GC protocol behind the
Bun FFI fast path. The decision record is ADR-0009; the frozen C ABI details
are in `crates/mad-dom-bun/src/ffi/ABI.md`. Runtime/CI policy lives in
`docs/platforms.md`.

## Ownership classes

| Class | Owner | Release path |
| --- | --- | --- |
| Document/node native state | Rust `Arc` + explicit `destroy()` + wrapper finalizer | `destroy()` drops the Core document/arena synchronously and clears the wrapper cache; GC/finalizer is the best-effort release for *abandoned* documents only |
| FFI inputs | caller | borrowed for one synchronous call; native never retains them |
| FFI outputs | caller | copy into a JS-owned typed array; freed by the JS heap |

There is **no external (native-owned) ArrayBuffer** on the FFI channel in v1.
`bun:ffi.toArrayBuffer` is an ownerless, GC-unsafe view over caller memory (no
deallocator, no detach, stays readable after the native free) and is not a
stable contract; see ADR-0009 for the spike result on Bun 1.4.0 / 1.4.2. If a
zero-copy external buffer is ever required it must be created on the Node-API
side (`napi_create_external_arraybuffer`) with an exactly-once deallocator
bound to the document owner/generation credential.

## Output length and capacity contract

- A call first writes the exact required size to `written`; insufficient
  capacity returns `BUFFER_TOO_SMALL` *before* any mutation, so callers may
  retry without duplicating side effects.
- On success `written` is the exact produced count (never a capacity); callers
  must not read past it.
- A success claiming more than the supplied capacity is a protocol violation:
  callers treat it as the Node-API fallback signal, never as a size to allocate
  from.
- The loader enforces fixed working budgets (`FFI_MAX_OUTPUT_WORDS`,
  `FFI_MAX_OUTPUT_BYTES`); oversized results fall back to Node-API.
- Mutating entries (`createElements`) are served single-shot with an
  exactly-sized buffer and are never re-invoked by a retry loop.

## Deterministic lifecycle counters

Leak proofs use counters, not RSS noise. After a bounded churn
(create → use → destroy → GC) these must return exactly to their baseline. They
are read with `DocumentHandle.memoryDiagnostics()`, which returns
`[liveDocuments, ffiRegistrations, wrapperCacheEntries]` for the calling
thread/isolate (the method reads only process statics, so it works even on a
destroyed handle):

- `liveDocuments` — live Core documents.
- `ffiRegistrations` — documents registered in the calling thread's FFI owner
  registry (lazily minted on the first `ffiContext()`; released when the
  document's last ownership `Arc` drops).
- `wrapperCacheEntries` — total live weak wrapper-cache entries across every
  document (fresh mints +1, wrapper eviction/destroy −1).

They are exercised by `tests/bun/ffi-memory.test.js`, `tests/bun/gc.test.js`
and reported by `bun run bench:ffi`
(`scripts/bench-ffi-gc.mjs`, schema `mad-dom-ffi-gc-bench/1`). RSS/heap deltas
are corroborating only.

## Cross-thread and cross-isolate rules

The FFI owner registry is thread-local. A context minted on another
thread/isolate resolves to no owner and fails with `INVALID_DOCUMENT`, so the
FFI channel cannot bypass the Node-API affinity guard (`crate::affinity`). See
`tests/bun/safety.test.js`.

## GC/finalizer timing

Node-API finalizers are deferred by Bun to a later event-loop turn. Explicit
`destroy()` is the deterministic release path and never depends on
`Bun.gc()`. Abandoned documents are reclaimed by GC + a macrotask drain; the
measured synchronous/deferred timing is recorded per runtime
(`finalizerTiming` in `tests/bun/fixtures/ffi-memory-digest.mjs`) and is a
capability-matrix data point, not a correctness dependency.
