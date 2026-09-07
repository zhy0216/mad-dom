# ADR-0008：Bun capability matrix and boundary benchmark

- Status: accepted for T1/T2
- Date: 2026-09-06
- Scope: `plans/bun-native-runtime/todos/01-capability-matrix-and-benchmarks.md`

## Decision

The Bun-specific channel is additive and capability-gated. The existing
Node-API binding remains the object, wrapper-identity, error and lifecycle
path. The same `mad-dom-bun` cdylib now carries packed data operations where
one call can replace many per-node crossings; it exposes an independent ABI
version and capability bitset before a Bun caller uses it.

The T1 probe is `scripts/bun-capability-probe.mjs`. It records public Bun
capabilities as `available`, `disabled` or `unavailable` data and exits
successfully for all three states. It covers `bun:ffi`, `Bun.gc`, typed arrays
and ArrayBuffers, the `bun:ffi.toArrayBuffer` deallocator entry point, file
I/O, spawn, serve, fetch, WebSocket and the runtime version. It does not call
JavaScriptCore private APIs. The private-JSC result is an explicit
`spike-only` record with `defaultPath: false`.

The proposed FFI contract is version 1 with these capability bits:

| Bit | Operation | First-phase decision |
| ---: | --- | --- |
| 0 | query result snapshot | candidate for FFI |
| 1 | preorder token snapshot | candidate for FFI |
| 2 | token creation/mutation batch | candidate after ABI/lifetime proof |
| 3 | serialize into caller-owned bytes | candidate after buffer proof |
| 4 | fixed attribute/text batch | candidate after error proof |

The contract accepts scalar values, UTF-8/byte buffers and document-local
tokens only. Inputs are caller-owned and borrowed for one synchronous call.
Outputs are written to caller-owned typed arrays first. An external
ArrayBuffer is deferred until a deallocator and document generation/owner
token are proven by T4. Raw JS pointers, `NodeId`s and long-lived native
allocations do not cross this boundary.

The following remain Node-API in the first phase: `Window` and `Document`
objects, `NodeHandle` materialization, wrapper identity and finalizers,
document destroy, error mapping, custom-element/observer callbacks, and any
operation that needs a JS object or can re-enter JavaScript. Direct JSC
objects are a feasibility spike only. If a stable public contract and a
Node-API fallback cannot be demonstrated on latest Bun, the spike stays out
of production.

## Version and fallback matrix

The probe emits these four explicit matrix rows:

| Row | Selection | Expected behavior |
| --- | --- | --- |
| latest | current `Bun.version` selected by CI | run capability probes and the full smoke lane; no exact ABI pin |
| baseline | repository `.bun-version` | reproducible regression and benchmark lane |
| FFI disabled | `MAD_DOM_FFI_DISABLED=1` | force Node-API and report `disabled` |
| FFI unavailable | missing `bun:ffi` or candidate cdylib | report `unavailable`, use Node-API |

`package.json.engines.bun` remains the minimum support declaration. The
baseline is a reproducibility aid; it is not the latest-runtime policy.

## Measurement protocol

`scripts/bench-bun-native.mjs` runs the same inputs through the current
Node-API path and a candidate FFI row. It measures single boundary calls,
token batches, query snapshots, string serialization, `Uint32Array`
snapshots and a 512-node large-document query (configurable with
`MAD_DOM_BENCH_LARGE_DOCUMENT_SIZE`). Each measured row includes boundary
cost, operations per second, RSS before/after/delta, a heap-used allocation
estimate and a result validation record. A missing FFI library is represented
as `unavailable` with null metrics; no FFI number is inferred from Node-API
timing.

The benchmark emits schema `mad-dom/bun-native-boundary-bench/1`, while the
probe emits `mad-dom/bun-capabilities/1`. Both have self-test entry points and
are exercised by `tests/bun/bun-native-runtime-probe.test.js`.

## Commands

```sh
bun run probe:bun
bun run probe:bun:selftest
bun run bench:bun-native
bun run bench:bun-native:selftest
```

Build the Node-API artifact first when measured native rows are desired:
`bun run dev:build`. T2's C ABI symbols are exported by that same image; the
ABI details and pointer contract are in
`crates/mad-dom-bun/src/ffi/ABI.md`, with no change to these schemas or the
Node-API fallback semantics.
