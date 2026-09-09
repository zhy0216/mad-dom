# Off-lane test robustness (post-merge followup on todo 05 T1)

Followup work by the same flow that produced `05-integrated-performance-validation`,
on branch `herdr/plan-bun-native-performance-offlane-test-robustness` (base
`main` = `09c6a68`). It is a test-only robustness change, in the same shape as
the merged [`../harness-followup/`](../harness-followup/README.md) metadata
followup: it archives no todo, edits no `todos/`, and produces **no performance
claim or timed sample**. The todo-05 worktree stayed untouched (read-only); the
two off-lane logs quoted below were copied out of
`../final/commands/065-validate-baseline-off.*` and `069-validate-latest-off.*`.
Those four suite files are byte-identical between `main` at `09c6a68` and the
todo-05 worktree (`pre-fix-files.json`, a read-only `sha256` check; that worktree
was never modified), so the reproduced before-run below measures exactly the code
todo 05 measured.

## Why this exists

todo 05 T1 requires "both Bun versions pass a full `bun run validate` with FFI
enabled and disabled". On the final composition:

| lane | result |
| --- | --- |
| baseline 1.4.0, FFI on | exit 0, 1209 pass / 0 fail |
| latest 1.4.2, FFI on | exit 0, 1209 pass / 0 fail |
| baseline 1.4.0, `MAD_DOM_FFI_DISABLED=1` | exit 1, 1193 pass / **16 fail** |
| latest 1.4.2, `MAD_DOM_FFI_DISABLED=1` | exit 1, the identical 16 names |

(the last two rows' totals are todo 05's whole-repo `bun run test` figures; this
followup's own before-run reproduces the same 16 failures inside just the four
affected files, where they are 28 pass / 16 fail of 44 tests.)

Those 16 are not product defects. `js/native-loader.js` resolves FFI once per
process and its `MAD_DOM_FFI_DISABLED` test precedes every image inspection, so
a suite that assumes "this process can use FFI" cannot hold when the whole
runner is launched with FFI globally off — while CI and the on lanes never
expose it. CI does exercise an FFI-disabled flow, but only as a release
observation (`.github/workflows/ci.yml` rehearses
`MAD_DOM_FFI_DISABLED=1 bun run platform:build` + `release:draft` + a
Node-API-only install), never as a global-off test lane; `docs/bun-native-runtime-results.md`
calls that build-disabled metadata "an observation, not a runtime switch". The
suites already isolate FFI state in child fixtures; the fix is to make those
children state the mode they measure, and to assert the documented off semantics
where the parent's own env is the measurement. No assertion was deleted, skipped
or loosened; no tolerance changed.

## The 16 items, before → after

### `tests/bun/ffi-loader.test.js` — "Bun FFI loader capability matrix" (7)

`enabled probe is additive and records the independent ABI`, `missing FFI
artifact is a data report, not a load failure`, `ABI mismatch falls back without
throwing from the loader`, `partial capabilities retain the supported operation
and report the gap`, `a genuinely missing advertised symbol is a per-symbol
partial, not available`, `a second same-ABI image cannot bind documents and
records the image reason`, `the exact Node-API image binds documents`.

*Before:* each scenario spawns `fixtures/ffi-loader-probe.mjs` or
`fixtures/ffi-binding-probe.mjs` with `{ ...process.env, ...extra }`. Under a
global off lane the child inherited `MAD_DOM_FFI_DISABLED=1`, so the loader
answered "disabled" before looking at the image at all: the enabled probe failed
its `["available","partial"]` status check, the missing-artifact probe failed
`status === "unavailable"`, the ABI-mismatch probe failed `status === "mismatch"`
(and `code`/`expectedAbiVersion`), the two capability probes failed their
`status === "partial"` checks (the per-symbol one also reports the `symbols` list
and its `missing` entry), the second-image binding probe reported a null
`imageReason` instead of "different file", and the exact-image binding probe
reported `bound: false` instead of `true`. In other words every one of the seven
asserted the env short-circuit instead of its scenario.

*After:* `runProbeFile` passes `MAD_DOM_FFI_DISABLED: "0"` in the default child
env, with `extra` still spread last, so the one test that *is* about the
short-circuit (`disabled FFI keeps the process on Node-API`, which passes `"1"`)
is unchanged. Every other assertion string is unchanged and now observes the
same scenario in both ambient modes.

### `tests/bun/ffi-memory.test.js` — "FFI loader output memory protocol" (6)

`all owned adapter outputs survive alternating multi-document results and
destroy`, `live Worker adapters isolate owners and transferred results survive
churn and destroy`, `createElements is served single-shot at any legal batch
size`, `destroyed-document FFI calls surface the frozen error, not a crash`,
`FFI copies and Node-API token buffers survive later calls, transfer, GC and
destroy`, `input lengths use the real view and mutable/detached stores are
rejected`.

*Before:* the bodies ran in-process on `ffiForDocument(doc)` and
`nodeDocumentStateOf(document.body).ffi`. With the parent resolved to the
Node-API channel, `ffiForDocument` returned `null` so the destructuring threw
(items 1, 2, 5, 6), and `state.ffi` was `null` so the mounted-method type checks
failed (items 3, 4). Not one buffer-ownership, transfer, single-shot-batch,
destroyed-document-error or input-validation assertion executed at all.

*After:* each body moved verbatim into the new
`fixtures/ffi-memory-scenarios.mjs` (`expect` → `node:assert/strict`, 1:1) and
runs in a child launched with `MAD_DOM_FFI_DISABLED: "0"` plus both artifact
overrides, through `runMemoryScenario`. The child fails closed unless the
enabled channel is really there (`loadNativeFfi().status` in
`available`/`partial`, `ffiForDocument(doc) !== null`) and echoes
`{ scenario, bunVersion, ffiStatus, passed }`; the parent asserts its own
scenario name, `bunVersion === Bun.version` (proof the child is the same
executable via `process.execPath`, not a newer Bun on PATH), the reported
`ffiStatus` and `passed === true`. The only new parameter is the per-test
wall-clock allowance (60 s / 120 s, in the style of
`release-metadata.test.js`) to cover child start-up; the in-process assertions
are untouched.

Parity was audited body by body against the base commit: the six scenarios carry
4 / 6 / 9 / 5 / 8 / 11 assertions before and after, with the only source-level
merge being `expect(bound).not.toBeNull()`, which now executes inside the shared
`boundAdapter` helper. `.toBeInstanceOf(Uint32Array)` became
`assert.ok(x instanceof Uint32Array)`, `.toEqual` became `assert.deepEqual`
(both already on plain arrays) and `.toThrow`/`.toThrowError` became
`assert.throws` with the same regexes.

### `tests/bun/ffi-facade-hot-path.test.js` (2)

`FFI-enabled workload actually calls the FFI methods`, `FFI-disabled and missing
scenarios report the mounted-method gap`.

*Before:* `runFixture` inherited the parent env, so the trace child reported
`bound: false, calls: []` against assertions demanding `bound === true` and four
traced method names, and the enabled leg `digest({})` of the second test
reported `ffiMethods: []` against the six-method mount assertion. The group's
other two tests passed in that mode only because every leg had degraded to
Node-API, i.e. they compared a Node-API digest with Node-API digests.

*After:* same default `MAD_DOM_FFI_DISABLED: "0"` with `extraEnv` spread last.
The enabled legs are enabled in both ambient modes, and
`facade digest is identical across every FFI capability state` now really pits a
live FFI run against a Node-API run even in the off lane. No assertion changed.

### `tests/bun/release-metadata.test.js` (1)

`a real payload with unavailable FFI exports can be drafted and installed`.

*Before:* one assertion, `expect(platform.build.ffi.status).toBe("unavailable")`,
failed with `Received: "disabled"`. The drafted manifest records what
`scripts/build-platform-package.mjs` measured; that probe strips only the
test-only overrides (`MAD_DOM_TEST_*`, `MAD_DOM_NATIVE_PATH`,
`MAD_DOM_FFI_PATH`) and keeps `MAD_DOM_FFI_DISABLED`, so in a global off run the
honest measurement is the documented `"disabled"` observation, and the masked
`mad_dom_ffi_*` exports are never inspected.

*After:* the assertion follows the documented precedence instead of fighting it:
it expects `"disabled"` when the ambient report is `"disabled"`
(`loadNativeFfi().status`, the public loader report) and `"unavailable"`
otherwise — one exact equality either way. The `"disabled"` branch is precisely
the manifest the CI node-API-only rehearsal already produces
(`MAD_DOM_FFI_DISABLED=1 bun run platform:build`), so the off lane asserts a
shipped observation rather than inventing one.
`capabilityLevel: "node-api-only"`
stays unconditional, and the install-smoke leg keeps `--expect-ffi unavailable`
because that script clears every `MAD_DOM_*` variable for its own probes, so its
`automatic` row genuinely reports the payload's missing exports in both ambient
modes. Consequence: under off, the rest of that body (draft, install smoke,
tamper fail-closed) now executes for the first time.

## Validation

`validate.mjs` runs staged, one `activity.py --task 06-offlane --kind build-test`
reservation per stage, serially, never around the lock (todo 05's campaign holds
the exclusive sampling lock for hours; queueing is expected and honoured):

1. `setup` — `rustc 1.93.1`, both lane executables verified against the task-01
   reference manifest (sha256 + `Bun.version` + `Bun.revision`),
   `bun install --frozen-lockfile` (with `bun.lock` proven unchanged),
   `bun run dev:build` with `CARGO_TARGET_DIR` inside this worktree, artifact and
   `mad-dom-ffi.so` identity (one inode).
2. `before-suites-off` — for the duration of the stage the driver restores the
   four suite files from the base commit `09c6a68` (not `HEAD`, so it can never
   measure the fixed files by accident) and puts the fix back in a `finally`, even
   if the measurement fails; it then runs `bun test` of the four suites per lane under
   `MAD_DOM_FFI_DISABLED=1`: expected exit 1, and the failure name set must equal
   `before-05-failures.json` — the 16 names copied verbatim out of todo 05's
   `065`/`069` logs.
3. `suites` — per lane × mode (`on` = `MAD_DOM_FFI_DISABLED=0`, `off` = `1`):
   `bun run check` and the four suites, all green. Both native overrides point
   at this worktree's `build/mad-dom.node`, as in the todo-05 lanes.
4. `validate-latest` then `validate-baseline` — `compat:hdunit:rewrite` followed
   by the full `bun run validate` per lane × mode. todo 05 had to run the
   post-`test` gates separately under off because the lane aborted; a complete
   green off-lane `validate` is the acceptance target here. The latest pair is
   required; the baseline pair runs in the same session when the shared queue
   allows it, otherwise the coordinator re-verifies the baseline off lane.
5. `summary` — asserts every recorded command exited as expected and collects
   the pass/fail counts of the suite and validate runs into `state.json`.

`commands/commands.json` plus per-command `NNN-label.{stdout,stderr}.log`
(full output, hashes, exit codes, incl. the intentional exit-1 before-runs) are
produced by the shared `benchmark/bun-performance/command.mjs` ledger;
`state.json` accumulates across stages. Raw logs are force-added, following the
`harness-followup` precedent, and the two before-run logs keep bun's own
`"193 | "` blank context lines byte-for-byte: `.gitattributes` disables the
`blank-at-eol` hint for exactly those retained files (as `../task-03` does), so
`git diff --check` stays green without editing a recorded failure.

## Results (23 recorded commands, 0 unexpected failures)

Environment actually used, from `state.json`: branch
`herdr/plan-bun-native-performance-offlane-test-robustness`, HEAD `c79562b` at
`setup` time (this followup's own single commit, amended afterwards — the
evidence therefore records the interim commit hash of the same tree), baseline
Bun 1.4.0 `34cbb9a4…` and latest Bun 1.4.2 `744846f8…` verified against the
task-01 manifest, `.bun-version` = 1.4.0, rustc 1.93.1, `bun.lock` unchanged by
`bun install --frozen-lockfile` (219 packages), and this worktree's own
`build/mad-dom.node` (sha256 `6b7e7398119fe255…`, 3 869 072 B, `mad-dom-ffi.so`
the same inode) — byte-identical to the image todo 05 built, i.e. the rebuild is
deterministic. Both overrides point at that image in every command.

| step | baseline 1.4.0 | latest 1.4.2 |
| --- | --- | --- |
| before-fix suites, global `MAD_DOM_FFI_DISABLED=1` | exit **1**, 28 pass / 16 fail, names identical to todo 05 | exit **1**, 28 pass / 16 fail, same 16 names |
| after-fix suites, FFI on | exit 0, 44 pass / 0 fail | exit 0, 44 pass / 0 fail |
| after-fix suites, global off | exit 0, 44 pass / 0 fail | exit 0, 44 pass / 0 fail |
| `bun run check`, on / off | exit 0 / exit 0 | exit 0 / exit 0 |
| full `bun run validate`, FFI on | exit 0, 1209 pass / 0 fail, wpt 5 / 0 | exit 0, 1209 pass / 0 fail, wpt 5 / 0 |
| full `bun run validate`, global off | exit 0, 1209 pass / 0 fail, wpt 5 / 0 | exit 0, 1209 pass / 0 fail, wpt 5 / 0 |

So todo 05 T1's "both versions pass a complete `bun run validate` with FFI
enabled and disabled" now holds on all four lanes in this checkout, without the
off lanes needing the separately-run post-`test` gates todo 05 had to fall back
on: `compat:ledger`, `compat:hdunit:rewrite`, `compat:hdunit:validate` and
`wpt:test` all execute inside the off-lane `validate` chain (see
`019-latest-validate-off` / `023-baseline-validate-off`).

## Limits

* Nothing here re-samples performance, so no published number changes; the
  todo-05 campaign numbers, hashes and evidence are untouched, and that worktree
  was only ever read. The exclusive sampling lock was waited out rather than
  shared around: this task's chain was `requested` at 21:01Z and granted at
  08:22Z, and no other task's reservation was interrupted.
* All four full `validate` lanes — including the baseline off lane that todo 05
  had to leave open — passed in this session, so nothing is deferred to the
  coordinator. The residual risk is scope rather than result: these four suites
  now state their own FFI mode, but a future suite that assumes an in-process
  enabled FFI channel could collide with a global-off lane again.
* Suites still carry their pre-existing `if (!hasArtifact) return` guards: with
  no native image built at all (a pure-JS checkout) these files describe the
  Node-API-only reality. That behaviour is unchanged by this followup.
