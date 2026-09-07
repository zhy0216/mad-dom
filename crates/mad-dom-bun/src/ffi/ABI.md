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
