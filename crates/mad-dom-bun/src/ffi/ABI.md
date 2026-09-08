# MAD DOM Bun FFI ABI v1

The C ABI is exported by the same `mad-dom-bun` `cdylib` as Node-API. Load the
exact file that Node-API loaded (the dev artifact is `build/mad-dom.node`) with
`bun:ffi`; loading a second copy creates a separate thread-local registry.
`DocumentHandle.ffiContext()` returns a `Uint32Array` containing
`[owner, generation, documentRootToken]`.

The ABI is additive. Node-API remains responsible for `Window`/`Document`
objects, wrapper identity, finalizers, lifecycle, callbacks and fallback when
`bun:ffi` is unavailable or disabled. FFI calls are synchronous and never
retain a JavaScript pointer, buffer, string, or token table beyond the owning
Node-API document.

## Symbols

| Symbol | Signature (C) | Result |
| --- | --- | --- |
| `mad_dom_ffi_abi_version` | `u32(void)` | `1` |
| `mad_dom_ffi_capabilities` | `u32(void)` | bitset `0b11111` |
| `mad_dom_ffi_query_snapshot` | `(u32,u32,u32,buffer,u32,ptr,u32,ptr) -> i32` | packed query snapshot |
| `mad_dom_ffi_preorder_snapshot` | `(u32,u32,u32,ptr,u32,ptr) -> i32` | packed preorder snapshot |
| `mad_dom_ffi_child_tokens` | `(u32,u32,u32,ptr,u32,ptr) -> i32` | packed child snapshot |
| `mad_dom_ffi_serialize` | `(u32,u32,u32,u32,ptr,u32,ptr) -> i32` | UTF-8 bytes |
| `mad_dom_ffi_create_elements` | `(u32,u32,buffer,u32,u32,ptr,u32,ptr) -> i32` | detached token batch |
| `mad_dom_ffi_read_batch` | `(u32,u32,buffer,u32,u32,ptr,u32,ptr) -> i32` | length-prefixed text/attrs |

The first two arguments are `owner` and `generation` from the context. The
third is a document-local token (zero is a valid minted token in the shared
registry); callers must use the current root token supplied by `ffiContext()`
when they want document-scoped queries.

Query, child and preorder outputs use the existing Node-API snapshot layout:
word zero is continuation depth plus one (or zero), followed by `(token,
descriptor<<16 | depth)` pairs. Serialization writes bytes without a NUL.
`read_batch` writes repeated little-endian `u32 length + bytes`; `0xffffffff`
means null. All `written` values are element/byte counts, never capacities.

## Ownership and errors

Input buffers are borrowed only for the synchronous call. Outputs are written
only into caller-owned buffers. A call first writes the required size to
`written`; if capacity is insufficient it returns `2` and writes no output
elements. Null pointers are valid only with a zero count. Output and `written`
must be disjoint and aligned. The caller must keep all allocations mapped and
unchanged for the duration of the call.

Status numbers are independent from Node-API's JavaScript error strings:

`0 OK`, `1 INVALID_ARGUMENT`, `2 BUFFER_TOO_SMALL`, `3 INVALID_DOCUMENT`,
`4 STALE_GENERATION`, `5 DESTROYED`, `6 INVALID_TOKEN`, `7 STALE_TOKEN`,
`8 WRONG_DOCUMENT`, `9 INVALID_UTF8`, `10 SYNTAX`, `11 HIERARCHY`,
`12 INVALID_CHARACTER`, `13 INDEX_OUT_OF_BOUNDS`, `14 PANIC`.

`NodeId` document ownership and arena generations are checked after token
lookup. A foreign/unregistered token is `INVALID_TOKEN`; an arena generation
failure is `STALE_TOKEN`; a destroyed document always wins precedence. Every
entry catches Rust panics and returns `PANIC`, so no unwind crosses C ABI.

## Memory protocol (task 04)

Three ownership classes, all with a provable release path:

- **Document/node native state** — Rust `Arc` + explicit `destroy()` + wrapper
  finalizer. `destroy()` is the deterministic, GC-independent free path: it
  drops the Core document/arena immediately, clears the wrapper cache, and
  marks the FFI generation terminal. GC/finalizer release of *abandoned*
  documents is best-effort and never required for correctness.
- **FFI inputs** — always caller-owned. Native borrows the pointer/typed-array
  only for the synchronous call and never retains it.
- **FFI outputs** — always written into caller-owned buffers. There is **no
  external (native-owned) ArrayBuffer across this ABI in v1**: `bun:ffi` has no
  stable deallocator/ownership contract (its `toArrayBuffer` is an ownerless
  view whose lifetime is unmanaged), so every output is a copy into a JS-owned
  typed array whose free path is the JS heap. If a zero-copy external buffer is
  ever required, it must be created on the Node-API side
  (`napi_create_external_arraybuffer`), guarded by a deallocator that runs at
  most once, and bound to the owner/generation credential from this document —
  that path stays out of v1.

Output capacity/length rules:

- A call first writes the exact required size to `written`; if the caller
  capacity is insufficient it returns `BUFFER_TOO_SMALL` *before* mutating any
  document state (element batches are only created once the size is proven to
  fit), so callers may retry without duplicating side effects.
- A successful call reports in `written` exactly the number of produced
  elements/bytes (never a capacity); callers must not read past it.
- On success a reported `written` greater than the supplied capacity is a
  protocol violation; callers must treat it as a Node-API fallback signal, not
  allocate from an untrusted count.

Deallocator exactly-once rule: any future external buffer's deallocator must be
idempotent-guarded (an atomic swap so only one caller frees), must check the
document generation before freeing, and must never free memory that a live
JS-side view still references. No such deallocator ships in v1 because no
external buffer crosses the boundary.

Lifecycle diagnostics: `DocumentHandle.memoryDiagnostics()` returns
`[liveDocuments, ffiRegistrations, wrapperCacheEntries]` for the calling
thread/isolate — live Core documents, documents registered in the calling
thread's FFI owner registry (lazily minted by the first `ffiContext()`, released
when the document's last ownership `Arc` drops), and total live weak
wrapper-cache entries. The method reads only process statics/thread-locals, so
it stays callable after `destroy()`. The memory tests and
`scripts/bench-ffi-gc.mjs` use these as the deterministic release counters for
bounded-churn assertions; RSS/heap are only corroborating evidence.
