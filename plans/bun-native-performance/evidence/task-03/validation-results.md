# Candidate v1 correctness results

These results apply to the archived v1 production digest
`74ef5e3ca7a102422aeffd26280c4c743462de6230ca83cadfa977e6aeaf6aa7`.
They do not certify a later revision or the coordinator's integrated main.
The complete executable paths, arguments, environment, timestamps, exit codes,
stdout/stderr bytes and SHA256 values are in [commands.json](commands/commands.json).
The `bun` spelling below refers to each lane's explicit executable from
[runtimes.json](runtimes.json): baseline 1.4.0 and independently resolved latest
1.4.2. Children use that executable too.

All commands used `activity.py --task 03 --kind build-test`. Both
`MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` pointed to this worktree's own
`build/mad-dom.node`, with FFI enabled for the native suites. The recorded runtime
reports confirm Node-API ABI 1, FFI ABI 1, capabilities 31 and six mounted operation
symbols. The artifact existed and native tests ran; the no-artifact guards were
not taken. Installation used only `bun install --frozen-lockfile`.
`bun run dev:build` built this worktree's image with Rust 1.93.1 and its own target directory.

| Command | Baseline | Latest | Result in each lane |
| --- | --- | --- | --- |
| `bun run check` | [006](commands/006-baseline-check-initial.stdout.log), exit 0 | [013](commands/013-latest-check-initial.stdout.log), exit 0 | Check passed |
| `bun run report:runtime` | [007](commands/007-baseline-runtime-initial.stdout.log), exit 0 | [014](commands/014-latest-runtime-initial.stdout.log), exit 0 | Real same-image FFI available |
| `bun test tests/bun/native-loader.test.js tests/bun/ffi-memory.test.js` | [008](commands/008-baseline-loader-memory-initial.stderr.log), exit 0 | [015](commands/015-latest-loader-memory-initial.stderr.log), exit 0 | 23 pass, 0 fail, 712 assertions |
| `bun test tests/bun/lazy-token-fast-path.test.js tests/bun/navigation-memo.test.js tests/bun/query-api.test.js` | [009](commands/009-baseline-navigation-query-initial.stderr.log), exit 0 | [016](commands/016-latest-navigation-query-initial.stderr.log), exit 0 | 53 pass, 0 fail, 521 assertions |
| `bun test tests/bun/html-api.test.js tests/bun/nodelist-live.test.js` | [010](commands/010-baseline-html-live-initial.stderr.log), exit 0 | [017](commands/017-latest-html-live-initial.stderr.log), exit 0 | 33 pass, 0 fail, 193 assertions |
| `bun test tests/bun/ffi-loader.test.js tests/bun/ffi-facade-hot-path.test.js tests/bun/safety.test.js` | [011](commands/011-baseline-capability-facade-worker-initial.stderr.log), exit 0 | [018](commands/018-latest-capability-facade-worker-initial.stderr.log), exit 0 | 21 pass, 0 fail, 121 assertions |
| `bun run bench:bun-native:selftest` | [012](commands/012-baseline-boundary-selftest-initial.stdout.log), exit 0 | [019](commands/019-latest-boundary-selftest-initial.stdout.log), exit 0 | Real native boundary selftest passed |
| `bun run compat:hdunit:rewrite` | [022](commands/022-baseline-hdunit-prepare-prepared.stdout.log), exit 0 | [028](commands/028-latest-hdunit-prepare-prepared.stdout.log), exit 0 | Required fixture preparation completed |
| `bun run validate` after preparation | [023](commands/023-baseline-validate-prepared.stderr.log), exit 0 | [029](commands/029-latest-validate-prepared.stderr.log), exit 0 | Bun 1197 pass, Rust 691 pass, 24 type fixtures, separate WPT 5 pass |

The original compatibility ledger remains 69 enabled, 22 expected-fail and 207
skipped fixtures. Passing validate does not mean those skipped upstream cases ran.
Original lifecycle counters and RSS/heap bounds remain unchanged; the new tests
add retained-array, real reentrant-call, exception and Worker coverage.

The [separate additional ledger](commands/additional/commands.json) contains four
more successful commands, preserving eight full log files. Both lanes passed
`bun test benchmark/dom-bench/report.test.js benchmark/dom-bench/testing-worker.test.js`
(28 tests, 85 assertions) and `bun run bench:bun-io:selftest` (exit 0). This separate
ledger avoids concurrent writers under the shared build-test permit.

All failures remain available. Fixture development attempts [003](commands/003-reuse-fixture-first.stderr.log)
and [004](commands/004-reuse-fixture-second.stderr.log) exited 1 before the real
dlopen hook fixture passed. The first used the handle API incorrectly; the second
used a module mock that did not intercept `createRequire`. The initial latest
[validate 020](commands/020-latest-validate-initial.stderr.log) exited 1 with three
ledger failures because 69 rewritten fixtures did not yet exist. Its 1194 passing
Bun tests and its Rust/type results are retained. Preparing the fixtures and
rerunning validate resolved that environment failure without changing the ledger
or test tolerances.

Formal performance campaigns and the historical performance gate have separate
sampling reservations and evidence. This correctness index makes no latency claim.

## Final T3 rerun on the restored v1 bytes (2026-09-09)

After the null control completed and the finally path restored and re-verified
the archived v1 production bytes (per-file SHA256 match re-checked post-run),
the same full command set was rerun in both lanes inside one ordinary
`activity.py --task 03 --kind build-test` reservation each (16:37:17-16:43:04Z
baseline, 16:48:29-16:53:19Z latest; both released exit 0). The ten appended
ledger entries per lane are `commands/commands.json` records 054-073. Note: the
driver invocation passed the intended `-final` label into the `phase` argument
position of `validation.mjs`, so these entries reuse the original label spellings
(`baseline-check`, `latest-validate`, ...); they are distinguishable from the
original 001-029 runs by ledger order, 2026-09-09 timestamps and fresh
`0NN-*.log` files. No original log, hash or entry was modified.

Every command exited 0 in both lanes with the same counts as the v1 index:
loader/memory 23 pass / 0 fail (712 assertions class unchanged), navigation +
query 53 pass, html + live collection 33 pass, capability/facade/Worker 21
pass, boundary selftest `ok`, full validate with Bun 1197 pass / 0 fail, Rust
691 pass across 26 suites, and WPT 5 pass. Original lifecycle counters and
RSS/heap bounds were not altered by any rerun.
