# T2 final path-selection decision: no new static route

Decision date 2026-09-09, made only after the complete six-campaign v1 matrix
(464 runner-valid workers), the four queued v1 semantic probes (completed
2026-09-09T05:04Z, all four exit 0, verified in
[null-control.mjs](null-control.mjs) `semanticControls`), and the authorized
empty-difference control ([null-control-results.md](null-control-results.md)).
The archived v1 candidate keeps only the T1 bounded-reuse changes; no additional
route branch exists, so nothing new is retracted beyond stating the decision.

## Options examined and evidence

1. State-dependent facade HTML (route already-materialized wrappers to Node-API
   via `hasMaterializedNodeHandle`, guarded only by the private kind stamp).
   Rejected. The probes trace both states of the same real wrapper:
   - Leading-U+FEFF equivalence fails. In FFI-on v1, `element1.before.inner`
     and `element1.after.inner` both return `'leading mark'` (the shared
     TextDecoder consumes the leading BOM), while the Node-API
     `nodeHandle.innerHTML()` on the same materialized wrapper returns
     `'\ufeffleading mark'`. Routing by materialization state would change the
     public string of one wrapper across an invisible transition.
   - Receiver equivalence fails. With FFI on, `outer` getters on Text, Comment
     and DocumentFragment receivers return values (FFI serialize mode 0 accepts
     non-Elements); the Node-API `outerHTML` path throws
     `ERR_MAD_DOM_HIERARCHY` for the same receivers (visible in the FFI-off
     column and in `element1/text/comment` native-phase calls). A switch after
     explicit materialization would flip public errors for the identical input.
   - The borrowed-`outerHTML`-getter condition the coordinator made blocking is
     therefore not satisfied; public strings and error taxonomy must agree
     before and after the transition, and they do not.
2. Size- or tier-based static creation selection. Rejected for lack of stable
   evidence: `create.N` tiers repeat identical per-tier node counts at different
   positions, mode comparisons reverse direction across positions, and no
   pool-tier gain survived both batches with same-signed groups
   ([findings-v1.md](findings-v1.md) creation section). The null control shows
   the same family of zero-source-byte positional drift
   (`raw|0.1|create.32`-style repeats), confirming small creation rows are not
   decision-grade. The existing exact-capacity single-shot contract is retained.
3. Routing Core serialization away from FFI when the mode is on. Not available:
   raw/adapter workloads require actual FFI calls when FFI is on, audits enforce
   it, and the +83-84% small-size mode delta measures channel cost under the
   user-selected mode, not a facade route. Forced-disabled, partial-symbol and
   oversized-output fallbacks remain in place and reported separately from
   capability.

## Consequences for the record

- Production paths are exactly those of v1: public facade HTML/creation still
  use the same channel chosen by capability and configured mode; only the
  encoder/decoder reuse and bounded hint machinery changed (T1).
- No trace oracle needed a change, and no assertion was weakened. The
  actual-path audits remain as recorded per batch; the shared runner's nominal
  labels were not touched (no rewrite of old manifests). The coordinator-owned
  01-metadata followup independently addresses the descriptive
  capability/facade labels; this task adopts nothing from it and reports no
  dependency, because no new path was selected.
- The repeated v1 source-off regression rows are retained with their original
  values; the control attributes them to nothing more than root/path/image/process-history
  and shared-VM position effects, within the predeclared no-causality limit.
