# Off-lane test robustness WORKLOG

Task: post-merge followup on `bun-native-performance` todo 05 T1 — make the 16
FFI-assuming suite members pass under a global `MAD_DOM_FFI_DISABLED=1`, without
weakening any behavioural assertion. Single commit, no todo archiving, no
`todos/` edits. Worktree
`herdr/plan-bun-native-performance-offlane-test-robustness`, base `main` =
`09c6a68`. All commands go through
`python3 /tmp/mad-dom-bun-native-performance-efaa64b/activity.py --task
06-offlane --kind build-test --`, serially, never around the lock; the todo-05
campaign holds the exclusive sampling lock for hours, so queueing is expected.
The 05 worktree is read-only: only logs were copied out (`/tmp/opencode/05logs`).

## Progress

| # | Time (UTC) | Step | Result | Artefact | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | 12:0x | read 05 evidence (WORKLOG rows 11-14, commands 063-069), confirmed the identical 16 names in both off lanes by diffing the `(fail)` sets | ok | `/tmp/opencode/05logs/06{3,5,7,9}` copies; names listed in README | fix code |
| 2 | 12:1x | root-caused each group against `js/native-loader.js` (env check precedes every image inspection), the child-fixture design of these suites, `build-platform-package.mjs` probeEnv and `install-smoke.mjs` cleanEnv | ok | README "Findings" | implement |
| 3 | 12:2x | implemented: explicit `MAD_DOM_FFI_DISABLED="0"` in the probe/fixture child env of `ffi-loader.test.js` + `ffi-facade-hot-path.test.js`; new `tests/bun/fixtures/ffi-memory-scenarios.mjs` running the six in-process loader-protocol scenarios as FFI-enabled children; `release-metadata.test.js` manifest status branches on the documented `disabled` observation | ok | diff of the 4 suite files + 1 fixture | validation |
| 4 | 19:2x | wrote the staged validation driver (setup / before-suites-off / suites / validate-latest / validate-baseline / summary), one activity.py reservation per stage; README with the 16-item before/after table | ok | `validate.mjs`, `README.md` | queue stages |
| 5 | 19:21 | queued `setup` through the gate (pid 143195); 05 campaign still holds the exclusive sampling lock (granted 18:53) → queueing as expected | waiting | `/tmp/opencode/06-setup.log`, activity.jsonl | grant |
| 6 | 19:4x | assertion-parity audit of the six moved bodies: diffed `git show HEAD:tests/bun/ffi-memory.test.js` bodies against `fixtures/ffi-memory-scenarios.mjs` per scenario — 4/6/9/5/8/11 assertions map 1:1 (T5's `expect(bound).not.toBeNull()` now runs inside `boundAdapter`) | ok | `/tmp/opencode/base-mem-block.txt` | — |
| 7 | 20:4x | CI/doc cross-check: `.github/workflows/ci.yml` rehearses `MAD_DOM_FFI_DISABLED=1 bun run platform:build` + `release:draft` + Node-API-only install but never a global-off test lane; `docs/bun-native-runtime-results.md` calls build-disabled metadata "an observation, not a runtime switch" → confirms the release-metadata branch and the explicit-mode child contract in `docs/ffi-memory-protocol.md` | ok | README rationale | — |
| 8 | 21:0x | made `before-suites-off` self-contained (the driver writes the base-commit contents of the four files, measures, and puts the fix back in a `finally`); child report now echoes `ffiStatus` and the parent asserts it; killed the single queued `setup` and replaced it with an unattended chain: setup → before-suites-off → suites → validate-latest → validate-baseline → summary, one reservation per stage, chain aborts on the first failure; committed the change as `3a0b30f` so the work survives a restart (to be amended with results) | ok | pid 154515 waiting; `/tmp/opencode/06-chain.log`, `/tmp/opencode/06-<stage>.log` | grant |
| 9 | 00:05Z | coordinator reminder: check for a duplicate queued reservation. The 19:21 `setup` waiter (pid 143195) had already been killed at 21:01 when the chain replaced it: `ps` shows it gone, `activity.jsonl` has exactly two 06-offlane lines (its `requested` at 19:21 with **no** `granted`/`released`, because it stayed blocked in `flock` and therefore never held or blocked anything, and the chain's `requested` at 21:01, pid 154515 = the only live waiter). No cross-contamination: `commands/` is empty, `state.json` does not exist, `/tmp/opencode/06-setup.log` is 0 bytes (the killed waiter never ran the driver), and the chain log shows a single `start setup`. | ok | this row | keep waiting |
| 10 | 08:22Z | gate granted after 11h21m of queueing: the sampling reservation holds `admission.lock` exclusively for its whole life, so a build-test waiter is only granted after the todo-05 campaign fully exits (final ledger entry 113-profile-latest, then the final analysis). Nothing was bypassed or interrupted. The chain then ran unattended: setup 37 s (rustc 1.93.1, both lane identities verified, 219 packages installed in 2.81 s with `bun.lock` unchanged, `cargo build --release` finished in 29.66 s), before-suites-off 18 s, suites 24 s, validate-latest 10:58 min, validate-baseline 11:28 min, summary | ok | `/tmp/opencode/06-*.log`, 23 ledger records | results |
| 11 | 08:46Z | **all green**: before-run reproduces todo 05's failure set exactly (per lane exit 1, 28 pass / 16 fail of the 44 tests in these four files, name sets equal to `before-05-failures.json`); after the fix the four suites are 44 pass / 0 fail for baseline+latest × FFI on+off, `bun run check` exit 0 in all four combos, and the full `bun run validate` is exit 0 with 1209 pass / 0 fail (+ wpt 5 pass / 0 fail) on **all four** lanes — including the baseline off lane todo 05 had to leave for the coordinator. Built image sha256 `6b7e7398119fe255…` equals todo 05's, so the rebuild is deterministic | ok | README "Results", `state.json` | amend single commit | (driver restores the four files from `HEAD`, measures, and puts the fix back in a `finally`); child report now echoes `ffiStatus` and the parent asserts it; replaced the single queued `setup` with an unattended chain: setup → before-suites-off → suites → validate-latest → validate-baseline → summary, one reservation per stage, chain aborts on the first failure | ok | pid 154515 waiting; `/tmp/opencode/06-chain.log`, `/tmp/opencode/06-<stage>.log` | grant |

## Command order (unattended chain, one reservation per stage)

`/tmp/opencode/06-chain.log` tracks the chain; `/tmp/opencode/06-<stage>.log`
holds each stage's driver output; `commands/commands.json` +
`commands/NNN-label.{stdout,stderr}.log` hold every recorded command.

1. `setup`: rustc identity, both lane runtime identities (sha256 + version +
   revision vs the task-01 reference manifest), `bun install --frozen-lockfile`
   (with `bun.lock` proven unchanged), `bun run dev:build` with
   `CARGO_TARGET_DIR=$PWD/target`, artifact identity.
2. `before-suites-off`: the driver writes the `HEAD` contents of the four suite
   files, runs one `bun test` per lane under `MAD_DOM_FFI_DISABLED=1` (expected
   exit 1, exactly 16 failures), then restores the fixed contents in a
   `finally`. Copies of the fixed files are additionally kept at
   `/tmp/opencode/prefix/` in case the chain is killed mid-stage.
3. `suites`: per lane × mode (`on`, `off`): `bun run check` + the four suites.
4. `validate-latest` then `validate-baseline`: `compat:hdunit:rewrite` +
   `bun run validate` per lane × mode.
5. `summary`, then the README/WORKLOG result rows, then the single commit.

## Restart hints

- Gate queue check (read-only): tail `/tmp/mad-dom-bun-native-performance-efaa64b/activity.jsonl`;
  the 05 campaign's own progress log is `/tmp/opencode/herdr-bunperf/campaign.out.log`.
- 05 holds the exclusive sampling lock for hours (6 formal campaigns + profiles);
  a `requested` with no `granted` for this task is normal. Never bypass, never
  interrupt it, keep coding while waiting.
- Resume after a restart: read `state.json` (`stage` + recorded commands) and
  `git status` (must show only the four modified suite files + the new fixture).
  Then re-run just the missing stages:
  `nohup python3 /tmp/mad-dom-bun-native-performance-efaa64b/activity.py --task 06-offlane --kind build-test -- <bun> plans/bun-native-performance/evidence/offlane-test-robustness/validate.mjs <stage> > /tmp/opencode/06-<stage>.log 2>&1 &`
- A stage failure leaves its logs in place; `commands.json` keeps the record, and
  `setup`/`before-suites-off` are written to be re-runnable.
