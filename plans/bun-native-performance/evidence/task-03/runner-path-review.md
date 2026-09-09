# Shared path-label review, before any new production selection

This is a request specification for the coordinator and task 01 owner. Task 03
has not changed the shared runner, selected a new production route, or changed
the active v1 reservations. The current source-off campaigns must finish with
their original source and harness bytes.

`benchmark/bun-performance/protocol.mjs:operationPath` currently derives a facade
HTML channel and the creation provider for tiers above one from the FFI mode.
Those nominal strings can disagree with an independently observed static
Node-API selection while FFI remains available. The README currently describes
`expectedPath` as the reference implementation's description; new evidence must
make the difference from the candidate's actual path unambiguous.

The smallest shared change needed if a static route is selected is:

- Make facade HTML descriptions express the complete public string operation
  and direct readers to `observedPath` for the selected provider. Do not claim
  FFI or a JS decode solely because the mode enables FFI.
- For facade creation tiers above one, keep the actual tier/count and canonical
  wrapper consumption, but identify the provider through the independent audit.
  The scalar `create.1` and existing public cache-hit descriptions remain valid.
- Keep available capability, configured mode and observed per-round calls as
  separate facts. Raw/adapter operations still require actual FFI calls when
  their mode is on. No fallback, symbol, fingerprint or workload check should
  be weakened.
- Clarify the nominal/observed distinction in the shared README and add the
  owner's focused label/audit regression coverage for an FFI-enabled facade
  using Node-API HTML or scalar range.

`audit.mjs:observedPaths` already permits Node-API calls for the facade while
requiring nonempty observed calls for cold operations, zero unexpected adapter
fallback, and real raw/adapter FFI calls. `report.mjs` already checks that each
worker's `observedPath` matches its independent audit. These checks can remain.

Any updated harness must be provided and identified by the task 01 owner after
the frozen campaigns finish, with its exact path and hash recorded for new
campaigns. No old manifest, nominal label, actual-path record or sample may be
rewritten to the new interpretation. Existing v1 inventories and their original
harness digest remain authoritative for those measurements.

## State-dependent HTML review (not yet selected or tested)

The coordinator confirmed that the existing
`js/facade/extensions/classes.js:hasMaterializedNodeHandle` reads private state
without materializing a handle. If the complete controls support a policy based
on that state, task 03 must trace both states of the same real wrapper and its
explicit transition. Selection must not call `nodeHandleOf` to discover whether
a handle exists. Public strings and error taxonomy must agree before and after
the transition, including empty/Unicode output, destroyed documents and relevant
borrowed-getter receiver checks. Capability remains independent of selection.

A read-only source review on 2026-09-08 also identified a receiver edge to test:
FFI serialization mode 0 calls Core `serialize_node`, while Node-API `outerHTML`
calls Core `outer_html`, whose documented receiver contract is Element-only.
This is a test requirement for any later state policy, not a claim that a new
policy already preserves the edge. No production change or new reservation
has been made for this review. Existing v1 campaigns remain frozen.

The coordinator subsequently made the borrowed `outerHTML` getter's cross-state
behavior a blocking condition for a path change. Only an existing private,
trusted node-kind stamp may narrow selection to equivalent inputs; neither a
replaceable public `this.nodeType` property nor an extra native query may decide
the route. Inputs outside that equivalent domain must retain their prior
behavior. This task must not repair historical cross-channel differences or
change Rust/ABI as a side effect. FFI mode 1 and Node-API `innerHTML` both call
Core `inner_html`; the non-equivalence above concerns mode 0.

## Existing disabled-mode preload description

A further read-only observation was sent to the coordinator before the empty
source-difference control. `preload.mjs` always writes a handshake description
claiming a real document query and full UTF-8 serialization. Those calls are
inside its FFI-on branch; its off branch instead checks the native runtime,
creates/destroys a real document, and asserts that the FFI binding is null.
Actual off-mode query/serialization calls and fingerprints are still checked by
the timed workloads and independent audits. The fixed handshake text is not
evidence that those calls happened in the off preload. No old metadata, shared
runner code or sampling protocol is changed for this clarification.

The coordinator independently confirmed this discrepancy and resumed the
original task 01 owner in the separate metadata-followup worktree to correct
the branch-specific handshake, capability-independent facade descriptions,
README and focused regression coverage. That work does not change this task's
or task 02's frozen harness and does not rewrite old samples. Its checks use
the ordinary gate. The already declared empty-difference control continues
with this task's original harness; it neither waits for nor adopts that change.
Only a later new-path comparison may use the owner's validated harness, with
its exact external path and hash explicitly recorded at that time.
