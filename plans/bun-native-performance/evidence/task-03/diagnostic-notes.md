# Independent path and allocation observations

The unmodified 01 runner completed separate reference/candidate path audits
before each formal hotspot suite. The table below reads diagnostic round 2 at
size 1 from [reference](baseline-source-on/audit-A-facade.json) and
[candidate](baseline-source-on/audit-B-facade.json). Each audit round performs
one complete public operation; diagnostics are not formal latency samples.

| Public operation | Reference observations | Candidate observations |
| --- | --- | --- |
| `innerHTML.unicode` | Two byte output constructions, 40,228 bytes; two length words, 8 bytes; one owned slice of 39,204 bytes; one decoder construction and full decode | One fresh 39,204-byte output; no output slice or in-operation length/decoder construction; the same 39,204-byte full decode |
| `query.large.cold` | One encoder construction and 16 encoded bytes; four word array constructions, 5,132 bytes; one owned slice of 4,100 bytes | The same 16 encoded bytes; one fresh 4,100-byte word output; no output slice or in-operation encoder/length construction |
| `preorder.cold` | Four word constructions, 17,428 bytes; one owned slice of 16,396 bytes; 512 `NodeAPI.materializeNodeToken` calls | One fresh 16,396-byte word output; the same 512 materialization calls |
| `create.256` | One encoder construction, four encoded bytes, two word constructions totalling 1,028 bytes | The same encoded bytes; one 1,024-byte word output; no output slice in either endpoint |

Both endpoints still advertise FFI available, ABI 1 and capabilities 31. The
actual public paths remain `adapter.serialize`, `adapter.querySnapshot`,
`adapter.preorderSnapshot` plus materialization, and `adapter.createElements`
for the larger creation tiers. Public `create.1` uses `NodeAPI.createElementToken`
in both endpoints. The later FFI on/off comparison uses the runner's existing
Node-API scalar range for batch creation. Capability and actual selection have
not been conflated.

These counters cover the constructors/copies and methods instrumented by 01;
they are not a complete JS/native allocator ledger. Fixed encoder, decoder and
length scratch are created outside the operation and remain within the declared
budget. An absent constructor counter does not mean zero retained allocation.
The native C calls inside the adapter are not hooked by this audit. The real-C
[reuse fixture](../../../../tests/bun/fixtures/ffi-adapter-reuse.mjs) separately
observes initial growth followed by one native call at the next exact capacity,
same-operation reentry on another document, independent length storage, faults,
and recovery. That explains the retry mechanism without claiming that the audit
directly counts adapter-internal C calls.

The original `b` nodes and unknown-descriptor classification remain in the
fixture. Candidate preorder still pays all 512 materializations. Arrays returned
by the adapter own their whole backing store; the optimization returns the fresh
exact-size allocation directly or makes an exact owned copy for a smaller result.
No output buffer is retained or borrowed by a caller.

Initial regression investigation: Core `queryCold` calls document-root
`querySelectorAll`, whose unchanged implied-skeleton branch uses Node-API;
it does not execute the changed FFI query output helper. Raw on-mode operations
call the unchanged C symbols with preallocated storage and do not execute the
changed adapter outputs. Core traversal can use the changed preorder adapter,
and small adapter queries do execute it, so their distributions require the
declared supplemental samples. These source observations identify controls and
possible affected paths; they do not by themselves dismiss a measured regression.
All initial and supplemental rows remain in the tables, including noise and
opposite directions. Final conclusions require both runtimes and the complete
public facade comparisons.

Latest source-on's declared supplement completed at 2026-09-08T15:29:11Z.
All 80 initial/supplemental processes passed; both inventories report unchanged
production source and image. The four size-1 HTML getters improve in every ABBA
group, as does the large cold scoped query. These complete public measurements
include decoding, wrapper hydration and consumption; see the existing
`latest-source-on` entry in [combined.json](combined.json) for every sample.

The initial small-operation regressions did not keep one direction through the
supplement. Latest small cold query at size 1 has group changes
`[+13.93%, +9.46%, +0.00%, -20.61%]`; at size 2 they are
`[+45.40%, +27.42%, -26.10%, +11.35%]`. Child grow/shrink at size 1 has
`[+13.27%, +16.84%, +0.54%, -10.23%]`. Combined changes remain -1.6%, +15.1%
and +7.6%, respectively. Opposite directions and the query supplement's noise
flags are retained; neither a combined median nor a favorable supplemental
median establishes a cause or a fix.

Latest facade `create.8` at size 2 still has four positive groups
`[+12.7%, +30.9%, +13.1%, +8.2%]` (combined +19.0%, supplement noisy).
The tier count and public creation work are identical across the three size
labels, but their preceding process workload differs; size 1 has mixed groups.
The unchanged-image raw `create.1` size 0.1 control also has four positive
groups and noise flags in both batches. These observations require the queued
FFI-mode and source-off controls, rather than an attribution to a particular
allocation branch. Candidate v1 remains frozen, with its exact bytes preserved
in [candidate-v1-source.json](candidate-v1-source.json).

The first candidate FFI-mode batch completed at 2026-09-08T16:38:46Z; its
declared supplement is still running. Separate [off audit](baseline-ffi/audit-A-facade.json)
and [on audit](baseline-ffi/audit-B-facade.json) confirm the creation comparison:
`create.8` and `create.256` use one `NodeAPI.createElementTokenRange` refill when
off, and one `adapter.createElements` refill when on. The on audit observes
four encoded UTF-8 name bytes and a fresh exact 32/1,024-byte token output,
respectively. `create.1` uses `NodeAPI.createElementToken` on both sides.
All public wrappers are consumed and checked in both modes. This is the existing
scalar range comparison, not the legacy Node-API array batch.

This batch survived the session interruption; its early Core processes overlap
an uncertifiable reservation window. The raw, adapter and facade processes all
started after the coordinator acquired both orphan-guard locks. Runner validity
and reservation coverage remain separate, as documented in the
[recovery evidence](recovery-20260908/README.md). Initial mode timing alone does
not settle path selection; the original supplement and restored mode/source-off
campaigns remain pending.

The baseline mode supplement is now complete. Its four size-1 `create.8`
groups are `[+11.5%, +7.2%, +18.9%, +18.2%]` (combined +9.9%; the initial
batch is noisy). Size 2 reverses direction in the supplement. ASCII HTML and
preorder also retain opposite group results. All rows remain in the ordinary
tables; no raw or adapter-only result determines the public path decision.

One size-dependent limitation is visible in the complete Core workload.
`runSerialize` reads the full `document.body.innerHTML`; the recorded fixture
contains 326,405 input bytes at size 1 and 656,281 at size 2, while size 0.1
has 31,946 bytes. The ASCII generator and full serialized-content oracle are
unchanged. The larger serialized body exceeds candidate v1's 131,072-byte hint
ceiling, so successful large reads reset the numeric hint to 1,024. Source
inspection therefore predicts another capacity retry on the next such call.
This explains why the predeclared bound does not remove repeated traversal at
that scale; it is not an independent count of those Core C calls.

Source-on Core serialization at size 1 remains near reference (-1.5% on each
runtime), while size 0.1 improves -32.0% / -34.8%. In the protected baseline
FFI-mode supplement, Core serialization still favors Node-API. This remaining
large-output cost will be considered with the pending latest/source-off results;
no ceiling or path has been changed, and no new budget has been declared.

Creation size labels require a separate interpretation. In the unchanged 01
`hotWorkload`, every `create.N` fixes `count` to N at all three size labels;
`prepare` drains preceding tiers according to that same count. For example,
`create.8` at size 0.1, 1 and 2 always measures the same eight public creations
per context and the same pool refill. Those rows are repeated observations at
different positions in the worker's workload and process history, not different
creation scales. The position labeled size 2 reversing direction cannot support
a size-dependent creation policy or a creation-scale claim.

The final creation decision must consider all three positions, every initial
and supplemental ABBA group, and their noise flags for each tier. Any static
selection may use the existing trusted pool tier/count, never the benchmark's
size label. This clarification changes neither the runner nor the sampling
protocol, and requires no extra resampling. Core and non-creation hotspots have
their own actual scaled workloads, as recorded in their metadata.

The restored latest mode campaign finished at 18:59:21Z. Its initial 40 processes
and declared 32-process supplement are valid; both integrity records show
unchanged source, image and drivers. Testing did not trigger supplementation;
its original two complete ABBA groups remain included. Core serialization at
size 1 has four group changes `[+94.67%, +74.38%, +79.22%, +97.96%]`, combined
+83.01%; size 2 has `[+86.68%, +81.30%, +98.08%, +45.57%]`, combined +84.02%.
Both initial and supplemental noise flags are false for these rows. This is a
remaining cost of the selected FFI route relative to Node-API, distinct from
the frozen source comparison and its v1 improvements.

Latest mode `create.8` combines to +10.69%, +4.97% and +3.81% at the positions
labeled 1, 0.1 and 2. Each still creates eight nodes; their complete group changes
and noise flags remain in [combined.json](combined.json). Other tiers and the
unchanged scalar `create.1` control also show position-dependent reversals.
The data does not justify a benchmark-size policy. The two restored source-off
reservations remain pending, and candidate v1 remains frozen through them.

Baseline source-off's initial 40 processes completed at 19:51:57Z. The original
rule selected Core/raw/adapter/facade for one 32-process supplement; Testing's
two complete groups remain included without supplementation. In this initial
disabled-FFI control, facade small cold query at size 2 changes +36.01%, with
groups `[+37.20%, +15.94%]` and a noise flag. The `create.8` position labeled 1
changes +34.72%, with groups `[+18.81%, +38.85%]` and a noise flag; its other
positions include the opposite direction. The changed FFI output helper does
not execute on these disabled paths. These observations constrain attribution
of the small-operation results; they do not prove that every difference is
noise or that a production regression has been fixed. The supplement and latest
source-off control are still pending at this checkpoint.

The source-off [reference audit](baseline-source-off-resumed/audit-A-facade.json)
and [candidate audit](baseline-source-off-resumed/audit-B-facade.json) independently
observe `NodeAPI.querySelectorAllTokens`, `NodeAPI.childNodesTokens`,
`NodeAPI.innerHTML` and `NodeAPI.createElementTokenRange` for the corresponding
small-query, child grow/shrink, Unicode HTML and eight-node creation operations.
Each endpoint uses its own recorded image path. This verifies the control paths
without relying on the mode label alone.

The baseline source-off supplement completed at 20:37:51Z, with all 32 processes
valid and both initial/supplemental inventories unchanged. Small cold query at
size 2 reverses from initial +36.01% to supplemental -21.83%; its complete group
changes are `[+37.20%, +15.94%, -31.82%, -15.54%]`, combined +5.41%. The
`create.8` position labeled 1 changes from initial +34.72% to supplemental
+1.74%, with groups `[+18.81%, +38.85%, -5.99%, +8.06%]`; both batches are
noisy. The other creation positions and unchanged scalar controls also retain
mixed directions. These controls reinforce the limits on attributing initial
small-operation changes to the FFI output helper. They do not turn the retained
initial regressions into a claimed fix. Latest source-off now runs under its
original restored reservation; production v1 remains frozen.

Latest source-off's initial 40 processes completed at 21:26:53Z; command 046 and
the following analysis 047 both exited 0. All five suites triggered the original
once-only supplemental rule, so the same driver continues under the same
exclusive reservation with another 40 processes. The source remains v1.

In this initial off control, facade small cold query at size 1 changes +12.95%
with groups `[+30.95%, +16.01%]`; size 2 changes +23.60% with
`[+20.11%, +25.44%]`. Both rows are noisy. Child grow/shrink at size 1 changes
-18.22%, with opposite groups `[-33.18%, +48.94%]`; size 2 is approximately
unchanged, with `[-23.35%, +22.16%]`. Core operations at size 1 change -0.22%
and Testing operations +2.45%. Creation tier 8 changes +0.18%, -1.46% and
-3.38% at the positions labeled 1, 0.1 and 2; all three still create eight nodes.
These are initial observations, not final attribution or a regression fix.

The latest off [reference audit](latest-source-off-resumed/audit-A-facade.json)
and [candidate audit](latest-source-off-resumed/audit-B-facade.json) both observe
Node-API `querySelectorAllTokens`, `childNodesTokens`, `innerHTML` and
`createElementTokenRange` for these corresponding operations, with the correct
separate reference/candidate image paths. Thus the FFI helper does not execute
on either endpoint of these controls. The full supplement remains required.

The behavior-only [HTML state probe](html-state-probe.mjs) was prepared while v1
remained frozen and queued through a normal build-test reservation by
[its driver](html-state-checks.mjs). It checks archived v1 source hashes before
running four explicit-runtime processes (baseline/latest, FFI on/off), and logs
real boundary calls, strings and errors in a separate `commands/semantic/`
ledger. At this checkpoint it has not executed and makes no performance claim.
The [path review](runner-path-review.md) records the coordinator's equivalent
input-domain and borrowed-getter constraints for any later production selection.

The latest source-off supplement and its final analysis completed at 22:15:17Z.
Initial and supplemental batches each contain 40 valid processes; both integrity
records confirm unchanged v1 source, images, runtime, harness and original drivers.
The complete v1 matrix now contains 464 runner-valid worker records. Its results
and separate reservation-coverage limitation are indexed in
[findings-v1.md](findings-v1.md).

Latest off facade small cold query at size 1 changes from initial +12.95% to
supplemental -11.56%, combining to +7.06%, with groups
`[+30.95%, +16.01%, +21.30%, -16.72%]`; both batches are noisy. Size 2 remains
positive in every group: initial +23.60%, supplemental +35.57%, combined +24.00%,
with `[+20.11%, +25.44%, +53.54%, +22.36%]`; both batches are noisy. Child
grow/shrink at primary size combines to -22.22% with mixed directions. Core
operations at primary size combine to -1.16%, and Testing operations to +3.12%.

Several adapter-labeled off rows also have four groups above +5%, while the
audits observe actual Node-API operations: primary large cold query +19.45%,
large hot query +20.57%, child cold +39.85%, and child grow/shrink +42.17%.
The latter three have no noise flag in either batch. Unchanged-image raw
`create.32` at position 0.1 is +13.36% with four groups above +5% and both batches
noisy. Every creation position still has the tier's same count. All raw rows,
group directions, memory observations and noise flags remain in the tables.

The completed controls rule out a direct invocation of the changed FFI helper
as an explanation for those off-path calls. They do not establish a root cause,
justify dismissing every difference as noise, or demonstrate a repair. The
coordinator authorized the new [empty-difference control](method-null-control.md)
with full original workloads and protocol after the queued v1 semantic probe.
It restores only this task's production bytes temporarily, verifies every
production file against the frozen reference, retains independent images and
truthful roots/HEADs, and restores v1 afterward. No new production route is
selected before this control. Cross-period comparisons alone cannot establish
allocation, path/image or shared-VM causality.
