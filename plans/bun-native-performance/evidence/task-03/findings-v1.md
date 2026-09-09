# Frozen candidate v1: complete formal matrix

The original matrix completed on 2026-09-08 at 22:15:17 UTC. This document
describes v1, not a final candidate or a completed todo. Its exact production
changes are preserved in [candidate-v1-source.json](candidate-v1-source.json),
SHA256 `666d9e02c74a06ba0b9aaccde92d4c8502b36c2ae665a49fa360e2595dd24b1c`.
The production digest is
`74ef5e3ca7a102422aeffd26280c4c743462de6230ca83cadfa977e6aeaf6aa7`;
the actual Git HEAD anchor is `fe77b7e28ba1ca24e40ce9272bc6a504cb32c191`.
The coordinator's later main commits are not these measured production bytes.

[method.md](method.md) was declared before implementation and sampling.
[runtimes.json](runtimes.json) records baseline 1.4.0 from `.bun-version` and
latest 1.4.2 independently resolved from the official release API at
2026-09-08T11:24:54Z, with exact executable hashes and revisions. This is a
dated latest observation, not a permanent latest-version assumption.

| Comparison | Baseline initial + supplement | Latest initial + supplement |
| --- | ---: | ---: |
| Frozen reference versus v1, FFI on | 40 + 40 | 40 + 40 |
| Same v1 source/image, FFI off versus on | 40 + 40 | 40 + 32 |
| Frozen reference versus v1, FFI off | 40 + 32 | 40 + 40 |

All 464 formal worker records are runner-valid. Each included suite has two
complete ABBA groups per batch, each letter a fresh process with two warmups
and nine measured rounds. Supplements repeat every workload and size in the
originally flagged suites exactly once. There are 116 complete runner-valid
ABBA groups. The [recovery audit](recovery-20260908/README.md) separately records
the lock-coverage limitation: the first five baseline FFI Core processes cannot
be certified throughout, so both initial Core groups lack complete reservation
coverage. The remaining 114 groups are covered; the two protected supplemental
Core groups supply the reservation-qualified baseline mode evidence. The
unqualified initial samples remain in the raw and pooled data, with this limit.

Every completed campaign's integrity record confirms unchanged production
source, images, runtime, shared harness and frozen drivers throughout that
campaign. The reference remains the read-only efaa64b checkout and its own
image. The candidate image belongs to this task's independent build; the two
images have identical bytes/SHA256 and distinct inodes. Source comparisons
never substitute the candidate image for the reference image. The mode
comparisons explicitly use the same candidate endpoint for both FFI settings.

The complete per-round samples, medians, p90, MAD, process medians, group
directions and memory observations remain in [analysis.json](analysis.json),
[tables.md](tables.md), [combined.json](combined.json) and
[combined-tables.md](combined-tables.md). Independent per-endpoint path audits
are stored inside each batch; every timed hotspot record binds its observed
path to its audit. Positive percentages below mean B takes longer.
The [completed-record inventory](v1-complete-records.json) fixes the hashes of
these derived indexes before any null control, all twelve campaign integrity
records, and the 106 original main/additional command logs. Later indexes may
append a separately labeled control; original raw results and failures remain.

| Frozen source comparison, FFI on, primary size 1 | Baseline | Latest |
| --- | ---: | ---: |
| Facade innerHTML ASCII | -42.36% | -44.08% |
| Facade innerHTML Unicode | -39.19% | -37.08% |
| Facade outerHTML ASCII | -42.77% | -41.45% |
| Facade outerHTML Unicode | -41.49% | -37.49% |
| Facade large cold query | -28.07% | -29.05% |
| Core operations aggregate | -0.88% | +0.01% |
| Testing operations aggregate | -0.30% | -0.87% |

All four HTML group directions are negative in both runtimes, with neither
batch flagged noisy. The large-query directions are also negative in all four
groups in both runtimes; its baseline supplement is noisy, while both latest
batches are not. These are complete public operations, including string decode,
output ownership, wrapper hydration and public return consumption. They do not
establish a general Core/Testing aggregate gain.

The source-on independent audits show the same selected channels in v1 and the
reference. Available FFI capability is ABI v1 / bits 31 / six operation symbols.
The allocation audit records fewer output/copy/encoder/decoder constructions;
for example, the repeated Unicode getter still decodes all 39,204 bytes, with
v1 using a fresh exact-size output rather than the reference's retry and slice.
The preorder workload still materializes its 512 B-node wrappers. No workload,
descriptor, final decode or materialization was removed to obtain these rows.
Fixed scratch allocation occurs outside an individual operation's audit window;
the audit is not a claim of zero allocation or of universal RSS improvement.

The mode comparison still identifies costs in the selected FFI serializer.
Latest Core serialization is +83.01% at size 1 and +84.02% at size 2, with all
four groups positive and neither batch noisy. The protected baseline Core
supplement has size-1 groups +37.32% and +70.25%. The large Core result exceeds
the v1 byte-hint ceiling and resets the hint, so the existing capacity retry
remains relevant; this source mechanism is not a direct C-call count for Core.
Facade outerHTML ASCII at primary size is +21.66% in baseline mode comparison
and +11.64% in latest. Unicode and other positions retain mixed directions.
These mode results are distinct from the reference-versus-v1 improvements.

Creation is compared with the existing Node-API scalar range, as independently
observed by the audits. `create.N` always creates N nodes at all three benchmark
size labels: these are different measurement positions/process histories, not
different creation scales. Latest mode `create.8` combines to +10.69%, +4.97%
and +3.81% at positions labeled 1, 0.1 and 2; other groups/tiers and the unchanged
scalar `create.1` control reverse direction. No benchmark-size strategy or
stable general creation gain is established. Any later selection must use
trusted pool metadata and must preserve the original exact-capacity,
single-shot, independently owned adapter result contract.

Small-operation regressions are retained rather than explained away. Latest
source-on small cold query at size 2 combines to +15.13%, with group changes
`[+45.40%, +27.42%, -26.10%, +11.35%]`. Child grow/shrink at primary size combines
to +7.62%, with `[+13.27%, +16.84%, +0.54%, -10.23%]`. The initial and supplemental
directions are different. Latest source-on `create.8` at the position labeled 2
has four positive groups, while other positions with the same count differ.
Raw scalar creation also has repeated differences despite the unchanged image.
All these rows remain in the full tables and the chronological
[diagnostic notes](diagnostic-notes.md).

The completed source-off controls further constrain attribution. Baseline small
cold query at size 2 changes from initial +36.01% to supplemental -21.83%, with
groups `[+37.20%, +15.94%, -31.82%, -15.54%]`. Latest small cold query at size 1
changes from +12.95% to -11.56%, combining to +7.06% with mixed group directions.
However, latest small cold query at size 2 remains +24.00%, with all four groups
`[+20.11%, +25.44%, +53.54%, +22.36%]`; both batches are noisy. Its source-off
audit observes Node-API `querySelectorAllTokens` at both endpoints.

There are also repeated source-off differences in the adapter-labeled layer,
where the actual operations use Node-API: primary large cold query +19.45%,
large hot query +20.57%, child cold +39.85% and child grow/shrink +42.17% all have
four groups above +5%. The latter three have neither batch flagged noisy. Raw
`create.32` at position 0.1 is +13.36%, with four groups above +5% and both batches
noisy. Source-off Core operations at primary size combine to -1.16%, and Testing
to +3.12%. These observations do not prove a FFI-helper regression, because
that helper does not execute on these paths; they also do not justify labeling
all differences as noise or claiming a fix.

The coordinator authorized a new, predeclared empty-production-difference
source control: after the queued v1 behavior probe and archive verification,
temporarily restore the candidate's own production bytes to v0, check every
production file against the frozen reference, and run latest FFI-off using
the original full protocol and ordinary sampling reservation. Both endpoints
keep their separate images and truthful roots/HEAD anchors. The complete
v1-to-v0 and v0-to-v1 transitions will be retained. This control examines
root/path/image/process and entry-time resident-allocation effects. Separate
campaigns at different times alone cannot establish a causal explanation.

The [v1 correctness index](validation-results.md) records both runtime lanes,
the full successful checks and all original failures. The queued
[HTML behavior probe](html-state-probe.mjs) additionally records same-wrapper
state transitions, public strings/errors and real calls before any new route.
The [path review](runner-path-review.md) makes equivalent input domains and
borrowed outerHTML getter behavior prerequisites. No new path is selected here.
Native lifecycle/RSS limits, shared-VM competition and historical RSS/profile
limitations remain unchanged. Task 03 is still in progress.
