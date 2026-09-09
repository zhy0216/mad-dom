# Task 02 final conclusion — snapshot packing, verified 2026-09-09

Acceptance data source: the `resume-1` campaign only. The interrupted original
campaign (first 24+1 of 40 processes in the old `baseline-source-on-formal`
directory) has no closing manifest, full paired matrix or after fingerprint,
stays on disk byte-frozen and is excluded from every ratio; see
[recovery audit](recovery-20260908/audit.json) and
[resume-1 method addendum](resume-1-method.md).

## Sampling validity

All commands ran serially under one activity.py task-02 sampling reservation
(`resume-1-reservation.stdout.log`, commands 052-080, every one exit 0):

- Pre-check: static inventory re-run, frozen reference untouched (1,498 tracked
  files, image `2d1f85d4…`), and all four retained smokes re-verified with the
  public runner.
- Four initial formal source comparisons, original order baseline-on, latest-on,
  baseline-off, latest-off: 4 x 40 = 160 processes, every manifest and summary
  `valid: true`, every `--verify` exit 0, every integrity record `unchanged:
  true` with equal before/after fingerprints. Suites core, testing, raw,
  adapter, facade; sizes 1, 0.1, 2; two full ABBA groups per suite, fresh
  process per letter, two warmups and nine measured rounds, 32 hotspot
  operations per round. 1,056 initial rows total.
- Predeclared supplemental batches for every flagged suite: baseline-on 32
  processes (testing unflagged), the other three 40 each = 152, same sizes and
  phases, all valid/verified.
- Separate baseline/latest source-on CPU profiles: 6 processes each, valid;
  retained under task 05 requirements. 12 profile records in `profiles.json`.
- Historical `bench:check` guard (command 079) and post-campaign static
  inventory (command 080): passed. Derived files in `combined.json`,
  `campaign.json`, `repeated-regressions.json` and `tables.md` reproduce
  byte-identically when re-run offline (re-verified at closeout; 115 repeated
  rows listed for review, matching `finish-sampling-resume-1.json`).

Shared-VM load during formal runs was mostly mild (load1 0.96-3.44) but spiked
in places (latest-off formal up to cpuSome 56.27%; supplemental batches up to
30.21%). Noise flags per the predeclared MAD policy are heavy — 84-126 rows per
initial campaign — so single positive rows carry little weight.

## Allocation and copy reduction (achieved, source-level)

Per [allocation-notes.md](allocation-notes.md) and the code: every successful
FFI query/child/preorder call now fills the checked caller prefix directly via
`SharedDocument::fill_token_snapshot` + `Output::fill`; the intermediate packed
Vec and its full copy are gone — 4,100 requested payload bytes each for
size-1 query/child (512 nodes) and 16,396 for size-1 preorder (2,049 nodes).
Failure paths still neither allocate packed output nor register tokens
(capacity/length/error priority tests in `ffi/tests.rs`,
`ffi-fast-path.test.js`, buffer canaries, true-`MaybeUninit` prefix test, ASan).
The CPU profiles cannot confirm or refute Rust allocator counts — JS sampling
loses inlined native internals — so this remains accounting plus behavioral
tests, not a measured allocator counter, and it is not public speedup evidence.

## Public performance (raw / adapter / facade)

Node-API fallback (source-off, where the candidate's owned snapshot array is
now zero-initialized then filled): the predeclared mandatory FFI-disabled
comparison shows no fallback regression attributable to zero-init. Core
queryHot/queryCold pooled medians are −5.0% (baseline) and −3.6% (latest); raw
/adapter/facade snapshot-phase rows are symmetric across zero (medians +3.0%,
−1.5%, +0.9%, −5.9%) and dominated by flagged noise; functional parity of the
Node-API owned-array path passed on both runtimes. The extra memset is not an
observable cost on this VM.

FFI-enabled source comparison (source-on): snapshot-phase pooled medians are
raw +0.1% (baseline) / +7.1% (latest), adapter −1.3% / +3.4%, facade +2.8% /
+0.6%. Sign and magnitude do not reproduce across lanes, runtimes, sizes or
suites, and the same phases swing negative in the off comparisons
(e.g. adapter size 0.1 query.small.cold/hot −29.9%/−33.2%).

**Verdict: packing has no reproducible public benefit.** No layer shows a
confirmed speedup; the 10% target was never claimed. Per method.md the
implementation is retained in its minimal form — the shared checked-fill helper
plus direct caller fill, with no read_batch change, no pool/cache/scratch and
no ABI change — justified by the deterministic allocation/copy removal and the
tighter capacity-checked boundary, not by a speed claim. Node-API keeps its
independently owned `Uint32Array`. The old JS adapter (task 03 not merged) works
unchanged: loader/facade files untouched, ABI v1, capability 31, symbols and
word layout frozen; four independent smokes and full public digests passed under
the new reservation.

## Repeated >5% regression review

The 115 mechanically listed rows were reviewed against group distributions,
batch consistency, noise flags and whether the row's workload executes the
changed code:

- Snapshot-phase rows with all four group changes >5%: five rows
  (baseline-on core queryHot +7.7, raw size-1 query.small.cold +12.2, latest-on
  adapter size-2 query.small.cold +24.0, latest-off adapter size-0.1
  query.small.cold +22.8, latest-off facade size-2 query.small.cold +26.0).
  Each is flagged unstable by the predeclared MAD policy in at least one batch,
  and the identical phases are stably negative elsewhere. None is a confirmed
  regression on the changed path.
- Rows meeting the strongest stable criteria (both batch medians >5%, all four
  groups >5%, neither batch noisy): seven rows, all on serialize or
  testing-library phases (outerHTML/innerHTML +6.7…+20.6, testingLibraryEvents
  +11.6). These workloads provably do not execute the changed code in either
  FFI mode (`adapter.serialize`/`NodeHandle.outerHTML` go straight to core
  `serialize_*`; Core crate bytes are identical). Mirror-image stable
  *improvements* of similar magnitude exist on other untouched paths
  (baseline-on raw create.8 −26.0%, create.32 −20.3%, all groups negative, not
  noisy). Bidirectional stable swings on unmodified code after a binary swap
  attribute to build/code-layout sensitivity of these microbenchmarks on this
  shared VM, not to an algorithmic regression from snapshot packing.

**Verdict: no confirmed repeated >5% regression attributable to this change.**
The layout-sensitivity artifact is real and is disclosed, not washed: task 05
integrated validation re-gates the merged image, where this effect may move
again or disappear. No workload was deleted and no gate adjusted; every initial
and repeated row remains visible in `tables.md`.

## T2 acceptance statement

Direct caller fill is kept as the minimal verified implementation; honest
conclusion per the todo: no reproducible public benefit was found, memory
semantics and ABI are unchanged, the fallback costs nothing measurable, and the
remaining open item is the layout-drift caveat above.
