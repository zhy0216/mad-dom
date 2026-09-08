# Independent operation diagnostics

These observations come from the separate baseline path-audit processes at size
1, one operation per round (two warmups and one measured diagnostic round). They
are call/constructor/copy evidence, not formal timing samples or a total allocator
ledger. The complete rounds and all sizes remain in the linked JSON records.

| Operation | Direct FFI audit | Adapter audit: selected JS costs | Public facade audit |
| --- | --- | --- | --- |
| `innerHTML.unicode` | One `mad_dom_ffi_serialize` call | Two Uint8Array output buffers, 40,228 bytes total; two length words, 8 bytes; one owned `slice` copy of 39,204 bytes; one TextDecoder and full decode | The same adapter, copy and decode calls are observed |
| `preorder.cold` | One `mad_dom_ffi_preorder_snapshot` call | Four Uint32Array constructions, 17,428 bytes; one owned copy of 16,396 bytes | Adapter snapshot plus 512 observed `NodeAPI.materializeNodeToken` calls |
| `query.large.cold` | One `mad_dom_ffi_query_snapshot` call | One TextEncoder, 16 encoded selector bytes; four Uint32Array constructions, 5,132 bytes; one owned copy of 4,100 bytes | Adapter query snapshot; no materialization call appears in this audit |
| `create.256` | One `mad_dom_ffi_create_elements` call | One TextEncoder, four encoded tag bytes; two Uint32Array constructions, 1,028 bytes; no output `slice` | One adapter refill supplies the complete public pool tier |

Sources: [raw audit](baseline-formal/audit-B-raw.json),
[adapter audit](baseline-formal/audit-B-adapter.json),
[facade audit](baseline-formal/audit-B-facade.json). Values above use diagnostic
round index 2; the two warmups are retained beside it. Each record binds the
source root/digest, image, executable/revision, FFI capability and exact workload.

The Unicode HTML is 39,204 UTF-8 bytes. The large query returns 512 tokens, whose
packed output is 1,025 words. Preorder returns 2,049 nodes, whose packed output is
4,099 words. These byte counts include the existing snapshot header and pairs.
The fixture deliberately retains non-ASCII text, comments, and `b` elements.

Source inspection explains the buffer counts: `outputWords` starts with 256
words, `outputBytes` with 1,024 bytes, and each growth attempt allocates another
output and length word before the final owned `slice`. The raw worker supplies
adequate storage before timing. The adapter-internal C-call count is not directly
hooked; a growth retry is a source-supported explanation, not a directly measured
native-call counter. See [the unchanged loader](../../../../js/native-loader.js).

The facade materialization count has a separate semantic explanation. The
[snapshot wrapper](../../../../js/facade/extensions/snapshot-node.js) has no compact
HTML-name entry for `b` and retains ordinary native classification for unknown
descriptors. There are 512 such elements in this fixture. That source inspection
supports the attribution; the diagnostic itself records the calls, not each
materialized node's tag. This cost must not be silently removed from the workload
or attributed solely to Rust packing or FFI transport.

Capability also does not select the first creation path: the public `create.1`
audit observes `NodeAPI.createElementToken` while FFI remains available; higher
tiers currently use the adapter. Expected descriptions and observed channels
remain separate, including independently audited reference/candidate endpoints.

Instrumentation covers the constructors, copies and selected boundary methods
listed in [diagnostics.mjs](../../../../benchmark/bun-performance/diagnostics.mjs).
It does not count all wrapper allocations, native-produced arrays, native
classification calls or Rust allocations. Absence of a counter is not proof of
zero allocation. Formal workers never install these hooks. Latency conclusions
must additionally use the complete ABBA samples, prescribed repeats and separate
CPU profiles; this note alone establishes no public speedup.
