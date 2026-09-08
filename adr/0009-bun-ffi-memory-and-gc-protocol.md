# ADR-0009: Bun FFI memory and GC protocol

- Status: accepted for task 04
- Date: 2026-09-08 UTC
- Scope: Bun memory/GC; version and CI policy remain owned by task 06

## Decision

Keep Node-API responsible for document/object lifetime, identity and affinity.
Rust Core stays runtime-independent. The additive FFI ABI v1 returns copies in
caller-owned TypedArrays; it exports no external-buffer allocator, lease or
release symbol/capability. GC is diagnostic and best-effort cleanup, never a
prerequisite for DOM correctness or explicit destroy.

## Ownership and release

| Storage | Owner / bounds | Release |
| --- | --- | --- |
| Core document/arena | `SharedDocument` Arc, Core NodeId generation | Explicit destroy drops the arena synchronously; otherwise the last handle finalizer drops its Arc |
| Wrapper/token/epoch subscription containers | Document; actual map/vector lengths and capacities | Destroy replaces the containers with empty allocations, including capacity, even if a wrapper retains the destroyed document shell |
| FFI registration | Calling-thread map of Weak references; non-reused process-unique owner and terminal document generation | Last ownership Arc removes its entry; destroy retains the credential while a handle lives so calls report DESTROYED |
| FFI input | Caller; checked actual view length and fixed, attached, unshared backing store | Borrow ends on synchronous return; native retains no input pointer |
| FFI output | Fresh JS TypedArray; supplied capacity and returned exact length | Native copies bytes/words; JS owns the result independently of the document |
| Native temporary Vec/String | Rust allocation with its own length/capacity | RAII on success, error or caught panic; never returned by pointer through FFI |
| Node-API typed-array snapshots | Independent Vec transferred to napi-rs, with length/capacity in its finalizer hint | Pinned napi-rs 3.12.2 transfers ownership once, reconstructs the Vec on finalization, and supports a copy fallback; snapshots never alias the arena |

`owner` identifies a document on its creating thread; lifetime `generation`
is separate from mutation epochs and Core arena generations. Reads first
resolve owner, reject destroyed/stale generations, then validate node tokens.
An expired owner cannot be reused. Input, output and `written` ranges must be
aligned, non-overflowing and disjoint. In particular, a creation name must not
alias `written`, which native updates while the name is still borrowed.
Native cannot prove a raw C pointer's allocation size: direct C callers retain
that obligation. The JS adapter supplies the real TypedArray length, rejects
shared/resizable/detached inputs, and validates scalars without coercion before
borrowing. A forged `.length` cannot enlarge a native read.

Read-only sizing failures write the exact required length, write no output,
and can retry within fixed budgets. Creation has an exact single-shot output
capacity. A malformed *successful* creation throws instead of falling back and
creating a second batch. Missing capabilities still select Node-API normally.
Every dlopen handle backing the adapter stays pinned for its lifetime.

## External ArrayBuffer: supported API, measured prototype, disabled production path

Bun publicly documents both
`toArrayBuffer(bytes, offset, length, context, callback)` and the fourth-argument
callback overload, with the C signature
`void callback(void *bytes, void *deallocatorContext)`.
It also states that FFI is experimental and that callers manage native memory.
[Official FFI contract](https://bun.com/docs/runtime/ffi#memory-management).
The previous claim that Bun has no deallocator API was incorrect.

The executable spike is `scripts/probe-ffi-memory.mjs`, backed by
`tests/bun/fixtures/ffi-memory-spike.c`, compiled separately with the local C
compiler. It passes real malloc storage and native C function pointers to Bun;
it does not substitute a JSCallback for a GC-safe native callback.
On Linux x64, both baseline **1.4.0** (`34cbb9a40`) and latest **1.4.2**
(`744846f84`) passed both overloads, retained TypedArray aliases across GC and
repeated document destroy, stale-owner/generation/length/capacity rejection,
FinalizationRegistry observation, and repeated GC after release. Each run
allocated/freed 258 buffers, observed 258 callbacks, suppressed two deliberate
repeat-release attempts, and ended with zero live native bytes.

The offset-8 probe observed a callback pointer at **allocation base + 8**.
Freeing that pointer directly would be incorrect; the context must retain the
original allocation base, capacity and immutable lease identity. Destroy
invalidates access credentials but cannot free a buffer while a JS alias lives.
The deallocator must still release the independent allocation after destroy;
requiring the document's *current* generation to match before freeing would
leak it. An atomic release guard must itself live long enough to be consulted:
putting the guard inside already-freed metadata does not prevent double-free.

The prototype uses a bounded static tombstone table with no slot reuse, a
single dedicated no-context-overload slot, independent malloc snapshots and
atomic counters/guards. These constraints make the spike auditable but do not
constitute a production lease allocator. Callback code stays mapped until
process exit, and callbacks never call JS or access a DOM. Production would
need bounded metadata reclamation, transfer/Worker/VM-teardown semantics and a
library lifetime protocol across all supported platforms. No measured DOM
workload needs zero-copy output yet, so caller-owned output remains the only
FFI capability. The restriction is an ownership/product decision, **not API
absence**. Ordinary Node-API external typed arrays remain supported.

## Direct private JSC integration

The same native spike calls `dlsym(RTLD_DEFAULT, ...)` for
`JSObjectMakeArrayBufferWithBytesNoCopy`, `JSObjectMake` and
`JSGlobalContextCreate`: none was visible in either tested Linux binary.
It also records all public `bun:jsc` exports. The
[public module reference](https://bun.sh/reference/bun/jsc) describes diagnostic
and profiling hooks; we found no public API handing an extension Bun's live
`JSContextRef` for constructing DOM wrappers. This is a capability-discovery
result on these binaries, not a claim that symbols are absent on every platform.
We do not fabricate a context pointer. Symbol visibility alone would not prove
VM ownership, rooting, affinity or finalizer safety. `defaultPath` remains false;
a future path requires a supported context/object-lifetime contract and fallback.

## Diagnostics and evidence

`DocumentHandle.memoryDiagnostics()` is an additive JS `number[]` method,
returning `[liveDocuments, ffiRegistrations, wrapperCacheEntries]`:

- Documents and wrapper-map entries are **process-wide atomics**, including Workers.
- FFI registrations are **calling-thread local**. They remain owned after
  destroy while handles survive, and disappear when the last Arc drops.
- The snapshot is not atomic across counters/threads. Entries include wrappers
  awaiting finalization; these are lifecycle counts, not a malloc-byte ledger.
- The affinity-checked method works on a destroyed handle and returns copies;
  it does not truncate the underlying 64-bit counters to u32.

A live-Worker handshake verifies both counter scopes and rejects foreign
credentials in both directions *before either document is torn down*.
GC tests keep the original strict identity and final-release assertions. The
lone-wrapper contract runs in a same-runtime child process so another suite's
pending finalizers cannot alter its baseline. The churn harness ends allocation
activations before GC, disables inlining only for its diagnostic workload, and
collects from fresh timer frames to avoid conservative stack roots. Business
code never calls these controls. N-API finalizers were deferred until the next
macrotask on both runtimes; the external C callback ran during synchronous GC
in these measurements. Neither timing is promised by the library.

Reproducible commands, per-round heap/RSS and lifecycle samples, spike metadata,
and benchmark results are in `docs/ffi-memory-protocol.md` and
`docs/ffi-memory-evidence.json`. Finite stress and lifecycle counters support
absence of sustained growth in these workloads, not a universal leak proof.
