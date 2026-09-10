# Bun native performance plan — integrated results (task 05)

Status: **complete — T1/T2/T3 green on the rebased tree (parent `050a685`),
single final commit, todo archived to `todos/done/`.** Awaiting only
coordinator independent re-verification, ff-merge to main and cleanup of the
frozen reference/task resources (coordinator-owned).

## 1. Headline

- **Public facade performance goal achieved with evidence**: on the final
  merged image, vs the frozen reference with the default configuration
  (FFI available), the public HTML getters (`innerHTML`/`outerHTML`,
  ascii + unicode) are **−36…−44%** and facade `query.large.cold` **−27.6…−30.9%**,
  stable (both batches, all ABBA groups, no noise flag) on **both** Bun
  runtimes; adapter-visible `query.large`/`preorder.cold` −11…−42%. Mechanism:
  task-02 direct snapshot packing + task-03 FFI adapter scratch reuse and
  facade UTF-8 decoder, verified together on the combined image (audits show
  both endpoints keep the same selected per-operation channels; the gain is
  whole-path, not re-routing).
- No Core/Testing aggregate regression anywhere (aggregates −6.2…+1.1%).
- No confirmed repeated >5% regression attributable to this plan's changes
  survives review; all stable positive rows are either documented internal
  mode-comparison costs (FFI serializer at large sizes — already excluded from
  the default selection) or layout/JIT-site drift disclosed with the task-02/03
  precedent. See
  [evidence/final/conclusion.md](evidence/final/conclusion.md) §4–§5.
- Task 02's own conclusion stands unchanged: packing is retained for
  allocation determinism, not for a speed claim.

## 2. Prerequisites (all merged and independently coordinator-validated)

| Commit | Content | Coordinator validation (read-only) |
| --- | --- | --- |
| `fe77b7e` | 01 balanced baseline harness + frozen reference | `coordinator-01-validation` |
| `24d8912` | 04 checksum single-scan + real IO evidence | `coordinator-04-validation` |
| `5cf2163` | 01-metadata harness labels | `coordinator-01-metadata-validation` |
| `834f5ff` | 02 direct caller snapshot packing | `coordinator-02-validation` |
| `09c6a68` | 03 FFI adapter scratch + facade HTML decoder | `coordinator-03-validation` |
| `050a685` | off-lane test robustness (tests-only: the four FFI-assuming suites pass under a global disable, fixtures + evidence; no production/ABI change, verified by the coordinator at 44/0 on+off and the full chain) | coordinator 44/0 re-verification + this task's both-runtimes global-off full `validate` (below) |

This task branch is rebased onto `050a685`; the production digest
(`8e6a4b01…`) and image (`6b7e7398…`) are byte-identical before and after that
rebase (tests-only merge; verified in-gate, `WORKLOG.md` row 29), so the
measured candidate above is exactly the post-`050a685` tree.

## 3. Measured identities

- Candidate: this worktree @ `09c6a68`, production digest
  `8e6a4b0173acc0dc475ac926b730caa130097d0720477ae73cf9f2169edaaae6`;
  independently installed + `bun run dev:build` here, image SHA256
  `6b7e7398119fe255a3aead79cf81d6e68da40923359dc2c8b2595c9663331903`
  (both `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` → this one file;
  `artifact-identity.txt`).
- Reference: `efaa64b3b9d90cf1988d8092d7de08e97e929630` read-only checkout,
  image `2d1f85d4…2fa96`, 1,498-file manifest untouched.
- Runtimes: baseline Bun 1.4.0 (`.bun-version`, exe `33d56b07…`); latest
  independently resolved 2026-09-09 = **1.4.2** (revision `744846f844…`, exe
  `a83d2637…`; `latest-release-resolution.json`). Dated observation.
- Platform: Ubuntu (kernel 6.8.0-31-generic), x86_64, glibc, AMD EPYC, 8 vCPU,
  16 GiB shared VM; Rust 1.93.1; Node-API ABI + FFI v1 capability bits 31;
  full per-attempt capture in `analysis.json` metadata and the 12
  `*-integrity.json` records.

## 4. T1 — correctness and robustness matrix

Ledger: [evidence/final/commands/commands.json](evidence/final/commands/commands.json)
(gated commands with stdout/stderr logs and real exits; seq 1–115 pre-rebase,
116–125 post-rebase re-verification on the `050a685` base).

Final state on the rebased tree (`050a685`; production bytes unchanged):

| Check | baseline 1.4.0 | latest 1.4.2 |
| --- | --- | --- |
| FFI-on focused suites (report:runtime, 6 native suites, boundary/IO/probe selftests, 2 harness suites) | exit 0 | exit 0 |
| FFI-off same focused suites (off-capability coverage: partial/missing symbols, ABI mismatch, oversized, legacy fallback — child fixtures + parent suites) | exit 0 | exit 0 |
| `bun run validate` full, FFI-on (incl. `compat:hdunit:rewrite`/`validate`, `compat:ledger`, `wpt:test` in-chain) | **exit 0**, ledger 116/118: Bun **1209 pass / 0 fail**, WPT 5 pass, cargo workspace ok | **exit 0**, same counts |
| `bun run validate` full, global `MAD_DOM_FFI_DISABLED=1` | **exit 0**, ledger 117/119: **1209 pass / 0 fail** — the 16 previously-failing FFI-assumption tests now pass as real assertions | **exit 0**, same |
| Off-lane remaining gates run separately (`compat:ledger`, `compat:hdunit:validate`, `wpt:test`) | exit 0 ×3 | exit 0 ×3 |
| Isolated-store integration (fresh `bun install --frozen-lockfile --cwd benchmark/mad-dom-integration-test` + `bun run test:integration`), re-run post-rebase | exit 0 ×2 (ledger 122–123) | exit 0 ×2 (124–125) |
| Historical `bench:check` (unmodified copied baseline `bc571c41…d9ff`), re-run post-rebase under the sampling gate | exit 0 (ledger 120; 19/19 + memory gates + observational raw RSS) | exit 0 (121) |
| Buffer lifecycle (retain/transfer/destroy/GC/Worker), creation-pool single-shot, wrapper identity/epoch/live-collection, Rust-02+JS-03 combined suites | covered by the on/off lanes above (native suites 1–6 incl. `ffi-memory`, `bun-native-runtime-probe`, `gc`) | same |
| Six tiny campaign-shape smokes (10 procs each) + 472 formal processes | correctness checks/fingerprints: all valid | all valid |
| `bun run bench:bun-performance --help`, documented-form tiny `--smoke` run, `bun run docs:build` | exit 0 (ledger 080, 115, 114 + final rebuild) | — |

Chronology note (retained, not overwritten): before `050a685` merged, the
global-off full `validate` recorded exit 1 = 1193 pass / **16 fail** (ledger
065/069) — ffi-memory ×6, ffi-loader ×7, ffi-facade-hot-path ×2,
release-metadata ×1, i.e. test-design assumptions about running in-process-FFI
tests under a global disable (CI never runs global off; the suites self-toggle
modes inside child fixtures). The coordinator's tests-only `050a685` made those
16 real assertions hold under the disable; both runtimes now reach
1193 + 16 = **1209 pass / 0 fail**, exactly matching the on-lane totals, with
the original failing logs kept unaltered in the ledger.

## 5. T2 — measurement

Single sampling reservation (`campaign-all.mjs`, driver pid 132132, held
2026-09-09T18:53:10Z until completion, no nested locks): bench:check guard →
6 smokes → 6 formal campaigns (40 procs) + 6 predeclared supplementals
(40/40/40/40/32/40) → 2 CPU-profile sets (diagnostics) → final analysis.
472/472 valid; 1,079/3,168 rows noise-flagged (shared VM, disclosed); every
initial and supplemental batch retained and pooled per the predeclared rule.

Full per-phase tables:
[evidence/final/combined-tables.md](evidence/final/combined-tables.md)
(and `tables.md`, `analysis.json`, `combined.json`, `campaign.json`).
Interpretation, handoff re-gates, regression dispositions, RSS/lifecycle:
[evidence/final/conclusion.md](evidence/final/conclusion.md).

Primary reference-vs-candidate (FFI on, size 1, pooled, stable):

| Facade operation | 1.4.0 | 1.4.2 |
| --- | ---: | ---: |
| `innerHTML.ascii` | −40.9% | −40.1% |
| `innerHTML.unicode` | −36.5% | −39.6% |
| `outerHTML.ascii` | −38.7% | −38.4% |
| `outerHTML.unicode` | −38.4% | −36.6% |
| `query.large.cold` | −30.9% | −27.6% |

## 6. T3 — artifacts (final state, 2026-09-10T10:0xZ)

Campaign: completed in-reservation 2026-09-10T08:22:30Z (17 steps, all exit 0,
integrity `unchanged: true`); final analysis re-ran and
`tables.md` / `combined.json` / `combined-tables.md` are byte-identical to the
pre-profile interim outputs (`evidence/final/analysis-consistency.json`), with
only the expected `kind: "profile"` additions to `analysis.json` and
`sample-files.json`. (Per the 01–03 precedent, raw `.cpuprofile` binaries under
`evidence/final/profiles/` are not committed — `evidence/final/.gitignore`
excludes `profiles/**/*.cpuprofile`, and `profiles/INDEX.json` binds all 12 of
them (64,421,282 bytes) by path/bytes/SHA-256 to their committed batch records;
`profiles/README.md` explains the split. `evidence/final/.gitattributes` marks
`commands/*.log -whitespace` so captured output is never rewritten, matching
the vendored-tree rule in the root `.gitattributes`; the two generated tables
had only their single trailing blank EOF line removed, recorded with
generated-vs-committed SHA-256 in `analysis-consistency.json`.)

T3 entry points and docs, all verified on the actual clean-source
install/build flow of this worktree (`bun install --frozen-lockfile` +
`bun run dev:build`, gates 001–002): `bench:bun-performance` package script
with `bun run bench:bun-performance --help` exit 0; documented-form tiny
`--smoke` run (explicit absolute `--bun`, roots, images) exit 0, `valid: true`,
written outside the evidence tree (ledger 080, 115); `bun run docs:build` exit
0 (vitepress 1.6.4, no dead links — rerun after the final doc edits below,
ledger 126); this `results.md`; the `docs/performance.md` dated section;
`benchmark/README.md` + `benchmark/bun-performance/README.md` command docs;
final evidence directory (method/campaign/conclusion/tables/WORKLOG).

Post-`050a685` integration sequence (this session): rebase (no conflicts;
production digest/image re-verified byte-identical in-gate), four full
`bun run validate` runs under the build-test gate (both runtimes × FFI
on/off, all exit 0, 1209 pass / 0 fail — ledger 116–119), `bench:check`
re-verification under the sampling gate (120–121, exit 0), isolated-store
integration refresh + `test:integration` re-run (122–125, exit 0), docs update,
todo archival and the single final commit. The rebase landed while a renumbering
fix to the appended ledger entries raced a running lane; the four
`revalidate-*` entries were realigned to positions 116–119 with their log files
and recorded SHA-256s re-checked against the on-disk logs (all match) —
`WORKLOG.md` rows 29–30.

## 7. Distinctions and limits

- "Implementation complete" (01–04 merged, harness + ABI + memory protocol
  intact) is stated separately from "performance goal evidence-backed" (§1/§5:
  yes for the public facade layer; no general Core/Testing aggregate claim;
  02 makes no speed claim).
- Raw-only improvements were never used as the acceptance basis; the facade
  layer measures complete public operations.
- Non-claims: no platform beyond linux-x64/Bun 1.4.0 + 1.4.2 is covered; the
  historical RSS-v2 miss, point-sample RSS limits, create-row size labels not
  being creation scales, and shared-VM noise census above all remain;
  the integration suite is a dependency-snapshot smoke, not a full happy-dom
  upstream-compatibility declaration; no version/dependency/lockfile/CI change,
  no push/publish action was taken by this task.
- New links are additive; the 2026-09-05 macOS headline, the earlier Bun-native
  Linux results and the RSS miss disclosure remain untouched records
  (`docs/performance.md`, `docs/bun-native-runtime-results.md`).

## 8. Final commit

Exactly one commit on branch
`herdr/plan-bun-native-performance-05-integrated-performance-validation`,
parent `050a685`:
`test(bun): integrated performance validation with final campaign evidence and
docs` (its own SHA is not embeddable in its content; the branch tip at hand-off
is reported to the coordinator and reproduced by `git log main..HEAD`).
No version/dependency/lockfile change (`bun.lock` untouched; `package.json`
diff = the single `bench:bun-performance` script line), no CI change, no
push/publish. `git status --porcelain` is empty: the raw `.cpuprofile` binaries
are excluded by the evidence-local `.gitignore` rule and indexed by SHA-256 in
`profiles/INDEX.json`, so nothing is left untracked-and-unexplained.
`git diff --check 050a685..HEAD` reports no warnings (only whitespace-sensitive
raw logs are covered by `commands/*.log -whitespace`; generated tables carry no
EOF blank line).
