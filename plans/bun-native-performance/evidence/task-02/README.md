# Task 02 evidence — verification complete (awaiting coordinator integration)

Task 02 is not archived; integration rebase is the coordinator's step. All 29
commands in the final gated functional check batch passed, including a fresh
build of the constructor-based helper, both Bun validate runs and ASan. The
complete source-comparison matrix ran to completion in the resume-1 campaign
(160 initial formal + 152 supplemental + 12 profile processes, all runner-valid)
and is analyzed in [conclusion.md](conclusion.md). No public performance
benefit is claimed; the minimal implementation is retained on verified
allocation/copy removal and the checked memory boundary.

[Validation results](validation.json): Rust workspace 697 passed; each Bun lane
FFI 26 passed with no skips, identity 36 passed, main validate 1,199 passed plus
the remaining validate gates. Both runtimes load the same task-local native/FFI
image, SHA256 `6b7e7398119fe255a3aead79cf81d6e68da40923359dc2c8b2595c9663331903`.
[Inventory and exported symbols](static-verification-2026-09-08T13-54-03-802Z.json)
confirm all 1,498 frozen files and the reference image remain unchanged. The
`limits` string inside `validation.json` predates the matrix; final performance
verdicts live in [conclusion.md](conclusion.md).

## Scope and predeclared evidence

- [Method and budget](method.md), declared before task 02 formal sampling.
- [Before production inventory](before.json) and [independent before image](before-image.json).
- [Runtime selection and identities](runtimes.json), including the independently
  resolved [official latest release response](latest-release.json).
- [Source-level allocation/copy accounting](allocation-notes.md); this is not a
  measured allocator count or evidence of public speedup.
- [Memory and lifetime review](safety-review.md).
- [Recovery addendum](resume-1-method.md): campaign locations only; original
  interrupted samples excluded from ratios and byte-frozen
  ([recovery audit](recovery-20260908/audit.json)).
- [Final conclusion and regression review](conclusion.md); derived complete
  matrix in [tables.md](tables.md), [combined.json](combined.json),
  [campaign.json](campaign.json), [repeated-regressions.json](repeated-regressions.json),
  [profiles.json](profiles.json) and the
  [resume-1 reservation ledger](resume-1-reservation.stdout.log).
- [Every recorded leaf command](commands/commands.json), with full stdout/stderr,
  environment overrides, times, hashes and exit codes.

## Acceptance index

| Requirement | Implementation or regression evidence | Final result |
| --- | --- | --- |
| C symbols, ABI v1, capability 31, status and word layout unchanged | `versions_and_status_codes_are_frozen`; `static-verification.mjs` compares exported C symbol names and the frozen inventory | Passed; [commands and counts](validation.json) |
| Shared checked query/child/preorder packing; Node-API owns its Uint32Array | `SharedDocument::fill_token_snapshot`; `token_snapshot`; `Output::fill`; real cross-document semantic parity in `ffi-fast-path.test.js` | Passed; [commands and counts](validation.json) |
| Exact/short/zero capacity; no output or token registration on capacity failure | `all_snapshot_capacity_failures_preserve_fresh_proof_and_existing_tokens`; `checked_snapshot_fill_rejects_lengths_before_enabling_or_registering_tokens`; buffer callback canaries | Passed; [commands and counts](validation.json) |
| True uninitialized caller storage and bounded callback lifetime | `snapshot_initializes_only_the_required_prefix_of_uninitialized_caller_storage`; [review](safety-review.md); ASan FFI run | Passed; [commands and counts](validation.json) |
| Unicode, deep/wide trees and >65,535-node continuation | Bun parity/deep/continuation tests; Rust wide continuation test retains 65,538 children | Passed; [commands and counts](validation.json) |
| Foreign/stale/destroyed tokens; overflow/overlap/error priority | Existing per-operation validation tests and `snapshot_errors_win_over_capacity_and_preserve_all_output` | Passed; [commands and counts](validation.json) |
| One packing registry lock, existing tokens and fresh proof | Shared helper retains existing reservation/map logic; tests distinguish per-document identity from cross-document topology | Passed; [commands and counts](validation.json) |
| Creation protocol, read_batch and Core unsafe prohibition unchanged | No edits to creation/read_batch or Core; core-safety script plus source inventory | Passed; [commands and counts](validation.json) |
| Old ABI v1 JS adapter and Node-API fallback work | No loader/facade changes; four re-verified smokes plus resume-1 baseline/latest source-on/off formal campaigns (160 valid processes, full public digests); FFI-disabled comparison covers the new zero-init owned array: no fallback regression ([conclusion](conclusion.md)) | Passed; [commands and counts](validation.json), [tables](tables.md) |
| Allocation/copy reduction and honest public performance | [Budget](method.md), [accounting](allocation-notes.md) (packed Vec + copy removed per successful FFI snapshot); complete raw/adapter/facade matrix and profiles show no reproducible public speedup at any layer — none is claimed; minimal implementation retained ([conclusion](conclusion.md)) | Passed with stated limit: no public benefit measured |
| No confirmed repeated >5% regression | Full matrix with predeclared supplementals; all 115 listed rows reviewed; the only all-group-positive snapshot rows are noise-flagged; the stable serialize/testing positive rows and mirror stable create-path improvements lie on code this change never executes (layout sensitivity, disclosed) | Passed with caveat: no confirmed regression from this change; layout-drift artifact reassigned to task 05 |
| Mandatory Rust/Bun checks, real native tests and validate | [Checks driver](checks.mjs), [command ledger](commands/commands.json); hdunit rewrite precedes each full validate | Passed; [commands and counts](validation.json) |

## Retained development failures

1. The first Rust compile attempt (command 007) accessed a private Core node
   field in the new test. The fixture now uses public `Document::next_sibling`.
2. The first wide-fixture run (command 009) was stopped after its per-node append
   setup repeatedly scanned the growing tree under debug invariants. The same
   65,538-child fixture now uses the existing bulk HTML loader. Assertions and
   continuation coverage were retained. The [cancellation record](test-fixture-cancellation.json)
   and all original logs remain available.
3. The corrected focused Rust FFI and checked-fill tests passed in commands 011
   and 012, followed by build 013. A subsequent simplification replaced the
   custom word trait with value constructors. Commands 014–042 then rebuilt
   and verified that final version, all exit 0.

## Continuing limits

The reservation excludes other tasks in this workflow, but cannot control other
repositories on the shared VM. Passing safety scans, ASan and lifecycle/RSS
checks do not prove arbitrary caller-pointer validity, all aliasing properties
or absence of native leaks. The historical RSS v2 miss in one of four injected
leak runs remains part of the acceptance context. Raw profiles and the frozen
reference must remain available through task 05.
