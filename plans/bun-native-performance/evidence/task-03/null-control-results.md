# Empty-production-difference source control: results

This document records the coordinator-authorized null control only. It does not
modify [findings-v1.md](findings-v1.md), any v1 campaign directory, any v1
integrity record, the pre-control inventory [v1-complete-records.json](v1-complete-records.json),
or any raw sample. The [predeclared method](method-null-control.md) was fixed
before any restoration or sampling.

## Execution and integrity

- Gate: one ordinary `activity.py --task 03-null-control --kind sampling`
  reservation. Requested and granted 2026-09-09T14:48:08Z (load 5.25/4.54/3.21;
  shared-VM load peaked near 12 mid-campaign and is reflected in the per-row
  noise flags below). Released 2026-09-09T16:31:42Z with exit 0. The coordinator's
  own queued `coordinator-01-metadata` validation was granted immediately after
  the release (16:31:42Z) and released exit 0; no queue was bypassed and no
  reservation overlapped.
- Prerequisite guards, all enforced inside [null-control.mjs](null-control.mjs)
  before any timed process started (driver hash
  `738e58fd421b31f207ab3c4f5ac62d64b2a5b1048e57064121a44e0210fd3ae0`, probe
  driver hash `40aaf33c2e9c614c77768416ee0f44ccbaedec7a5fe2715dd9cf6bf50262afa4`,
  both matching the coordinator's 23:00Z verification note):
  the four queued v1 semantic probe records passed byte-length, SHA256, exit,
  runtime revision/executable, native image, frozen-reference cross-checks and
  the `publicKindReads = 0` check; the v1 archive decoded to the current
  production bytes; the latest source-off campaign integrity remained
  `unchanged: true`.
- v1 -> v0 transition: both changed files were restored from the immutable
  reference; the journal shows requested+written for each path with the archived
  v0 SHA256s. After restore, the complete 188-path production manifest matched
  the frozen reference file-for-file byte-for-byte and the candidate production
  digest equaled the original digest
  `119652fe7235e5116a21adbb547e288ba6e31768e34c7ce59cb306936ad65fda`.
  Roots, HEAD anchors, the two images (identical bytes
  `2d1f85d4…`, independent inodes), the fixed latest 1.4.2 executable
  `a83d2637…`, and the frozen harness/driver inventory were checked unchanged
  before, during and after.
- Campaign `latest-v0-source-off-control`: mode `source`, FFI off at both
  endpoints, A = frozen reference root/image, B = this worktree's temporarily
  v0-restored root/image. Initial 40/40 runner-valid processes; all five suites
  were flagged by the predeclared rules, so exactly one complete supplemental
  batch ran with 40/40 valid processes; initial and supplemental integrity
  records are `unchanged: true`. Leaf commands 050-053 and the outer launch
  ledger are in `commands/null-control/` and `commands/null-control-launch/`;
  the shared `commands/commands.json` ledger only gained these append-only
  control entries.
- v0 -> v1 restore: ran in the finally path after the campaign and both
  analyses, journal complete, and the after-restore inventory again matched the
  before-V1 inventory exactly (digest `74ef5e3ca7a102422aeffd26280c4c743462de6230ca83cadfa977e6aeaf6aa7`,
  all 188 per-file bytes). No unknown production bytes were ever encountered:
  `null-control-unexpected-source/` does not exist. Driver report:
  `failure: null, restoreFailure: null, restoredV1: true, campaignUnchanged: true`.
- The regenerated derived indexes (`analysis.json`, `combined.json`,
  `tables.md`, `combined-tables.md`, `sample-files.json`) now include this
  separately labeled batch; every pre-control raw result, noise flag and
  failure remains at its original path, pinned by the pre-control inventory.

## What the control shows

Positive percent means B (this worktree) takes longer. Comparing the repeated
v1 source-off rows against the null control (production bytes byte-identical
to A):

| Row (combined) | v1 source-off | null control (v0) | null groups | null noise |
| --- | ---: | ---: | --- | --- |
| adapter \| 1 \| query.large.cold | +19.45% | -2.31% | [-0.4, 2.9, 0.4, -0.2] | false / false |
| adapter \| 1 \| query.large.hot | +20.57% | -0.27% | [-15.5, 19.9, -10.4, 20.7] | true / true |
| adapter \| 1 \| child.cold | +39.85% | +0.47% | [-6.5, 14.0, -14.7, 24.1] | true / true |
| adapter \| 1 \| child.grow-shrink | +42.17% | -5.25% | [-26.3, -5.4, -14.5, 22.6] | true / true |
| facade \| 2 \| query.small.cold | +24.00% (4 groups positive) | -12.10% (all groups negative) | [-25.2, -1.3, -7.1, -15.3] | false / false |
| facade \| 1 \| query.small.cold | +7.06% | -6.67% | [5.0, -19.3, -4.5, -5.9] | true / true |
| core \| 1 \| operations | -1.16% | -3.44% | [-12.3, -3.0, 5.3, 2.9] | false / false |
| testing \| 1 \| operations | +3.12% | -0.59% | [-4.9, -1.3, 3.8, -1.4] | false / false |

The v1 source-off repeated-regression set did not reproduce with byte-identical
production: every primary-size row above lands within a few percent of zero
with mixed group directions, and the facade small-cold-size-2 row reverses to a
stable negative with neither batch noisy.

But the control is not "all clear" either. With production bytes exactly equal
to the reference, the B side still shows its own repeated >+5% rows at other
positions: `adapter|0.1|query.large.cold` +13.98% (four groups positive, no
noise flag), `raw|0.1|outerHTML.unicode` +18.27% (no noise flag),
`facade|0.1|child.grow-shrink` +13.33% and `facade|0.1|preorder.cold` +13.78%
(no noise flags), `core|0.1|queryHot` +13.73% (no noise flag), plus several
noisy-flagged repeats (`adapter|0.1|child.cold` +20.35%,
`raw|0.1|innerHTML.ascii` +20.87%), and one stable negative
(`core|1|traverseWarm` -11.32%, no noise flag). In source-off mode the raw and
adapter suites execute identical Node-API operations at both endpoints, so
these differences cannot come from production bytes.

## Conclusion (bounded by the predeclared limits)

1. The repeated v1 source-off regressions are not attributable to the two
   changed v1 files: with byte-identical production they vanish at the
   primary-size positions and reappear, at comparable magnitude, elsewhere.
   Which rows repeat differs between campaigns and between endpoints'
   process histories. This is consistent with the residual root/path/image
   inode/process-history and shared-VM position effects the method reserved
   for, and the predeclared limit stands: cross-period campaigns alone cannot
   assign a causal mechanism, so no causal label is claimed here.
2. Because those off-path rows are source-independent, they neither justify a
   new production route nor indicate a v1 defect to fix. Every original row,
   group direction and noise flag remains in the v1 tables.
3. The v1 source-on improvements (facade HTML -37.1..-44.1% and large cold
   query -28..-29% versus the same frozen reference, all groups same-signed,
   both runtimes, mostly unflagged) are several times larger than the worst
   zero-difference drift the control produced in the same suite families, and
   point the opposite way to the control's B-side-positive rows. They remain
   the accepted, evidence-backed gain of this task's production change.
4. No new static path is selected. See the T2 decision note in the README and
   [runner-path-review.md](runner-path-review.md): the state-dependent HTML
   route fails its blocking equivalence precondition in the queued probes
   (leading U+FEFF content and non-Element receivers change public strings or
   error taxonomy across the materialization transition), and creation tiers
   have no stable evidence-backed selection. The restored bytes are again the
   archived v1 candidate; the v1 archive remains untouched.
