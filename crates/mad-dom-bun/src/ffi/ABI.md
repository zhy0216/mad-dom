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
elements. Null pointers are valid only with a zero count. Input, output and `written`
must be mutually disjoint and correctly aligned (overlap is rejected before
creating any Rust borrow). The caller must keep all allocations mapped and
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

- Core state belongs to the document Arc and its Core NodeId generations.
  Explicit destroy drops the arena and wrapper/token/epoch-container capacities
  synchronously, without GC. Retained handles own an inert document shell.
- FFI input is borrowed for one synchronous call only. The JS adapter reads
  intrinsic TypedArray lengths, validates u32 scalars without coercion, and
  rejects shared, resizable or detached backing stores. Direct C callers must
  provide valid allocation sizes and forbid concurrent mutation/detach/free.
- Every FFI output is copied into caller-owned storage. Returned bytes remain
  readable after document destroy, further FFI calls, transfer or GC; tokens
  within that storage still require live owner/generation validation for use.
  Rust temporary Vec/String values drop on every return/unwind path.
- Node-API typed-array outputs can use napi-rs's external ArrayBuffer finalizer;
  they own separate Vec allocations and never point into the document arena.

`written` is defined on OK and BUFFER_TOO_SMALL, and must be ignored on other
errors. It contains the exact number of produced/required elements (bytes for
byte outputs), never capacity. Insufficient capacity produces no output and no
creation/token-registry mutation. Read-only calls can retry within the loader's
4,000,000-word / 64,000,000-byte budgets. Read protocol anomalies return the
Node-API fallback signal. Creation uses an exact, single-shot allocation of
0..4096 token words; a success reporting any other length throws, since a
fallback after successful mutation would create a second batch.

### External-buffer capability boundary

ABI v1 exports **no FFI external allocator/deallocator capability**. Bun does
have a public `toArrayBuffer(bytes, offset, length, context, callback)` API (and
a fourth-argument callback overload), as documented in its
[FFI memory management contract](https://bun.com/docs/runtime/ffi#memory-management).
The native callback spike passed on Bun 1.4.0 and 1.4.2; see
[ADR-0009](../../../../adr/0009-bun-ffi-memory-and-gc-protocol.md).

Any future external output needs a distinct allocation lease carrying owner,
lifetime generation, original base pointer, length, capacity, offset and
exactly-once release state. Reject stale credentials for access, but **do not
skip cleanup because the document has been destroyed**. A live JS view must
retain its allocation independently of the document. The measured callback
pointer includes the byte offset; free the original base from the lease.
An atomic release guard is insufficient if its metadata is already freed or
its slot reused. Context metadata and callback library lifetime need their own
reclamation protocol. The test-only static tombstones are not production ABI.
No GC callback may enter JS, touch a thread-affine DOM, or depend on Bun.gc().

### Lifecycle diagnostics

`DocumentHandle.memoryDiagnostics()` returns a fresh JS `number[]`:
`[liveDocuments, ffiRegistrations, wrapperCacheEntries]`. The first and third
are **process-wide** atomic lifecycle counts, including Workers; the second
counts the **calling thread's** FFI registrations. The snapshot is not atomic
across fields/threads and is not an allocation-byte counter. Values are JS
numbers (exact integers up to Number.MAX_SAFE_INTEGER), without u32 truncation.
The affinity-checked method works after destroy. Registrations are lazy on
first `ffiContext()` and remain until the last ownership Arc drops; wrapper
entries include pending finalizers and are cleared eagerly at destroy. These
diagnostics never determine business correctness.
