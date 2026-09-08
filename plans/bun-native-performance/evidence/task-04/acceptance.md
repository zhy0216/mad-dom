# Task 04 acceptance and command results

Only `scripts/checksums.mjs`, `scripts/bench-bun-io.mjs`,
`tests/bun/bun-host-io.test.js`, task-04 evidence and this todo's queue/archive
metadata are changed. The implementation keeps sequential file processing and
replaces per-entry directory enumeration with one Set. The experiment under
`prototype/` is evidence only; its build symlink is ignored and is not committed.

## T1

| Acceptance | Evidence |
| --- | --- |
| Complete manifest, bytes, digests, order, verification and failure exits | `validateChecksumFixture` checks every tarball and the entire manifest after every round; contract tests cover eight independent capability masks, exact ordered multi-error output, duplicate manifest keys, invalid/empty/missing manifests, unreadable files and usage/write failures. [Supplemental write proof](write-proof.json) separately requires actual creation/replacement after deleting/poisoning the manifest and rejects a success-printing no-op. |
| Same inputs and timing for Bun/fallback/reference/candidate, actual paths | Each raw worker retains full expected fixtures/fingerprints, absolute Bun/source commands, source/image hashes and actual runtime/path/capability reports. Identical deterministic input on every side; [method](method.md) separates internal CLI evaluation from direct CLI startup/exit. Native overrides resolve to the selected source's own image. |
| Both pre-optimization raw baselines with the 01 protocol | [before-baseline](before-baseline/manifest.json) and [before-latest](before-latest/manifest.json) completed before the checksum source edit, which the driver asserts against the frozen hash. Separate runtimes, at least ABBAABBA, new internal processes each 2 warmup/9 measured; all initial/repeat samples retained. [Original harness/source snapshot](before-harness-source.json). |
| Separate historical 1 MiB write result | [Findings](findings.md) report real checksum CLI results and actual 380/12,160-byte manifests separately. No conclusion about manifest IO is derived from the historical repeated-write ~4× result. |

Formal generate overwrites an already valid manifest; the independent write
proof is untimed. Its missing/poisoned-manifest cases are not silently presented
as the state used in formal timing. No formal sample was deleted or replaced
after the coordinator's oracle review.

## T2

| Acceptance | Evidence |
| --- | --- |
| Enabled, forced fallback and partial capability parity | Both-runtime host IO tests include all 8 `Bun.file` / `CryptoHasher` / `write` combinations, complete byte equality and exact CLI diagnostics. The capability contract in `js/facade/bun-host-io.js` is unchanged. |
| Failure/exception/diagnostic ordering | The tests tamper first and last files while removing a middle file, and require every diagnostic in manifest insertion order. Empty/invalid manifests fail before directory scanning; read exceptions still abort at the first unreadable entry; failed writes exit 1 without success output. Production remains sequential with awaited writes. |
| Fewer scans, end-to-end benefit, RSS/heap/in-flight records | [Both audits](README.md) observe 128 → 1 scans, 129 reads and 128 hashes for many.verify. [Results](findings.md) show real CLI median improvements of 29.9%–33.7%, all ABBA groups improving. Every raw internal sample includes RSS/heap/maxRSS; diagnostic peak tarballs remain 1 in production. Bounded 2-file/8 MiB prototype failed the predeclared benefit/regression budget and was rejected. |
| Package/lock/release/registry/runtime policy unchanged | The only production CLI diff is the Set and its membership lookup. No package, lockfile, platform, release, CI, registry, host capability or dependency/version file is modified. Rust remains 1.93.1; baseline is read from `.bun-version`; [latest was independently queried](runtime-selection.json). |

## T3

All commands below run under `activity.py --task 04`. Installation, build,
checks, tests and selftests use `--kind build-test`; formal campaigns,
diagnostic comparison and historical `bench:check` use `--kind sampling`.
The outer gate command/environment/start/end/exit and full stdout/stderr are in
`commands/`; the two [validation ledgers](validation-baseline.json)
([latest](validation-latest.json)) list each nested command and its log paths.
Three commands started while previous commands were queued share the numeric
prefix `012`, with distinct labels and files; none overwrote another log.

| Command | Baseline 1.4.0 | Independently selected latest 1.4.2 |
| --- | --- | --- |
| `bun install --frozen-lockfile` | exit 0, own worktree | Same frozen dependencies |
| `bun run dev:build` | exit 0, Rust 1.93.1, own target/build | Same independently built candidate image used for actual tests |
| `bun run check` | exit 0 | exit 0 |
| `bun run report:runtime` | exit 0; Node-API ABI 1, FFI ABI 1/capability 31 | exit 0; same ABIs/capabilities |
| `bun test tests/bun/bun-host-io.test.js` | exit 0; 43 pass / 0 fail / 0 skip before added write proof | exit 0; 43 pass / 0 fail / 0 skip before added write proof |
| `bun run bench:bun-io:selftest` | exit 0, all 11 report rows | exit 0, all 11 report rows |
| `bun test tests/bun/native-loader.test.js tests/bun/ffi-fast-path.test.js tests/bun/ffi-memory.test.js` | exit 0; 21 pass / 0 fail / 0 skip | exit 0; 21 pass / 0 fail / 0 skip |
| `bun run bench:bun-native:selftest` | exit 0 | exit 0 |
| `bun test benchmark/dom-bench/report.test.js benchmark/dom-bench/testing-worker.test.js` | exit 0 | exit 0 |
| `bun run compat:hdunit:rewrite` before full validate | exit 0 | exit 0 |
| `bun run validate` | exit 0: Rust 691, Bun 1200, types 24 fixtures, WPT 5 pass | exit 0: Rust 691, Bun 1200, types 24 fixtures, WPT 5 pass |
| `bun run bench:check` with unchanged historical baseline | Not repeated; baseline correctness/native gates above | exit 0; [full output](commands/013-latest-historical-bench-check.stdout.log), [historical baseline provenance](historical-gate.json) |
| Supplemental untimed write proof and final host IO tests | exit 0; 8 actual cases passed, 8 no-op cases rejected; 44 tests / 513 assertions / 0 fail / 0 skip | exit 0; 8 actual cases passed, 8 no-op cases rejected; 44 tests / 513 assertions / 0 fail / 0 skip |

The supplemental [driver command](commands/016-baseline-write-proof.json) ran
after its existing gate reservation was granted and exited 0. Its [32 raw probe
records](write-proof.json) and [final test commands](write-proof-tests.json) are
separate from the earlier full validation. Only the additional regression test
and evidence changed after full validate; the final production source and image
still match all retained source-comparison campaigns. No performance campaign
was rerun for this untimed oracle supplement.

Both runtime reports resolve `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` to this
worktree's `build/mad-dom.node`. Reference/candidate images have different inodes;
their identical SHA256 is the result of an independent build of unchanged Rust,
not reuse of the candidate for reference. The reference's 1,498 tracked files,
production digest and image are checked unchanged in [integrity.json](integrity.json).
Every campaign's measured source and artifact match its ending inventory.

`compat:hdunit:rewrite` generates 308 rewritten and 35 copied support files;
69 test files are enabled by the unchanged triage. The existing 22 expected-fail
and 207 skipped upstream entries retain their policy. No native/host IO specialty
test is skipped, and no ledger or tolerance is changed.

Initial preparation failures and the ineffective preliminary scan audit remain
in [README](README.md), with their original command exits and output. All 144
formal/experimental ABBA workers completed with exit 0 and complete samples.
Unrestricted `git diff --check` and `git diff --cached --check` both pass.
Original command logs retain their exact bytes and hashes. Task-local
[.gitattributes](.gitattributes) originally disabled only `blank-at-eol` for the
one emitted source-context line and `blank-at-eof` for four exact stdout/stderr
paths. Any additional exact-path rule for integration logs is documented in
[the integration review](rebase-review.json).
There is no wildcard log exemption or repository-wide rule change. The initial
check failure and final results are recorded in [final-review.json](final-review.json).

## Limits and handoff

There is no confirmed repeated >5% end-to-end regression in the retained source
change. Small/large workload differences remain noisy. Shared VM competition,
warm page cache, internal module parsing/JIT, cold direct CLI startup and natural
GC limit generalization. RSS/heap/maxRSS include runtime/oracle allocations and
are not leak proof; native scratch/lifecycle/historical RSS limitations remain.
The rejected prototype's static-fixture stat budget does not define a new
contract for files growing during reads. No DOM facade speedup is claimed.

T1, T2, T3 and the supplemental write proof are complete; no acceptance item or
blocker remains. Only todo 04 is archived and marked in the queue. The initial
handoff used one local task commit and left integration with the coordinator.
The subsequent explicitly authorized rebase and two-runtime serial revalidation
are recorded separately in [integration evidence](rebase-validation.md): rebase
was already up to date, without conflicts or production changes; both runtimes
passed host IO (44 tests / 513 assertions / no failures or skips) and `check`.
The priority exclusive gate released with exit 0 at 17:27:06 UTC. The existing
source/image fingerprints were unchanged. Only the current task commit is amended;
the coordinator's subsequent complete integration validate remains separate.

The session resumed after all task-04 campaigns and the write-proof driver had
completed. [Resume reconciliation](resume-reconciliation.json) preserves the
coordinator's orphan-guard state and the full activity snapshot, including other
tasks' interrupted/open records. Those records do not prove a live lock or a
completed campaign. Task 04 has no surviving driver or incomplete campaign to
restart; no sampling or build/test command was repeated during that initial
recovery bookkeeping.
The byte-identical [coordinator recovery audit](session-recovery-20260908.json)
records 15 stale reservations, none for task 04. Wrapper exit times/codes are
unavailable and the lock-loss window cannot be retrospectively certified.
Task-04's last driver released at 15:29:39 UTC; the earliest interrupted granted
reservation in that audit starts at 15:30:39 UTC. The session interruption therefore
left this task's final Git/evidence bookkeeping unfinished. Other campaigns'
incomplete samples and open journal entries remain unaltered; the orphan guard
protects the surviving task-03 process independently of those old journal rows.
