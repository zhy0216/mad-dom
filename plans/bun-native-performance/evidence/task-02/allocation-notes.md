# Packing allocation and copy accounting

This is a source-level accounting, not a runtime Rust allocator counter. The
independent 01 JS CPU profiles do not resolve Rust allocator internals, so no
id/class read_batch change is justified. The native collectors, selector cost,
token maps, missing-index Vec and JS adapter/wrapper allocations are retained.

In the frozen implementation, each successful query/child/preorder entry first
checks capacity, calls `SharedDocument::token_snapshot` (one packed Vec of
`(2 * nodes + 1) * 4` bytes), then `Output::write` copies all those bytes to the
caller. In this candidate the same collectors and registry algorithm invoke
`Output::fill`/`fill_token_snapshot` directly on the checked caller prefix.
There is no packed Vec to allocate/free and no copy from such a Vec. The helper
writes header/pairs and updates newly minted token/descriptor slots in place.

| Size-1 fixture | Nodes | Required words | Removed packed allocation / output copy per successful FFI call |
| --- | ---: | ---: | ---: |
| query.large.cold | 512 | 1,025 | 4,100 bytes each |
| child.cold | 512 | 1,025 | 4,100 bytes each |
| preorder.cold | 2,049 | 4,099 | 16,396 bytes each |

The allocator can round capacity; these are requested payload bytes, not RSS or
total process allocation. Failed capacity probes already avoided packed Vec
allocation/registration and continue to do so. The old JS adapter still retries
growth and returns an owned slice: its copies are unchanged and not counted as
removed native copies. The facade still materializes unknown `b` descriptors;
01 observed 512 such materializations per size-1 preorder operation.

Node-API continues to allocate its one independently owned Vec/Uint32Array.
The common helper initializes valid u32 storage there, so fallback timing is
checked separately with FFI disabled. No external FFI buffer, lease, retained
scratch, cache, allocator hook or callback is added. Only full facade ABBA
results can establish a public speedup; this source accounting alone cannot.
