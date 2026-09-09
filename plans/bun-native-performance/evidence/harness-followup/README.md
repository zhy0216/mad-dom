# Shared harness metadata followup

This is a corrective followup by the original task-01 owner on
`herdr/plan-bun-native-performance-01-metadata-followup`, based on
`24d89122758dca628786211763497bd065d2c2a4` (integrated 01 and 04). The original
`fe77b7e` commit, task-01 baseline data, measured harness archive, immutable
reference and other task worktrees are unchanged. This work does not archive a
todo or accept any task-02/03/05 performance result.

The scope is limited to descriptive metadata and focused regression tests:

| Request | Implementation / evidence |
| --- | --- |
| Describe the actual preload branch | `preload.mjs` changes only `metadata.handshake`. Off describes native runtime/path checks, explicit disablement/null binding, and real document create/destroy. On retains the existing real query and UTF-8 serialization checks. No operation is added to either branch. |
| Separate facade operation from provider | `protocol.mjs::operationPath` describes complete public HTML string generation/length consumption and creation tier/count/canonical wrappers, referring to independent `observedPath`. It does not derive the HTML/range provider or JS decoding from enabled FFI. create.1, hot-cache and all raw/adapter labels retain their previous meaning. |
| Keep strict evidence validation | `audit.mjs`, `report.mjs`, `run.mjs`, diagnostics and the timed worker are unchanged. Focused tests cover accepted Node-API HTML/range observations with available FFI, rejected worker/audit disagreement, missing/empty cold calls, unexpected fallback, raw/adapter on without its FFI channel, invalid capability/fingerprint and child failure. |
| Explain the five metadata facts | The runner README distinguishes available capability, configured mode, nominal expectedPath, independent actual observedPath and completed preload checks. Workload correctness is separate from both preload and audit. |
| Preserve historical interpretation | Original labels/handshake descriptions are not edited. Read-only verification of the two original formal batches uses the same saved hashes and semantic workload checks. New tiny batches identify this worktree and its new harness hash. |

The accepted facade policy fixtures are explicitly constructed test inputs:
they combine recorded FFI-on capability/result data with real Node-API HTML/range
call records from the recorded off audit. They establish that reporting permits
that provider selection; they do not claim a new production route was implemented
or timed. Separate new processes trace the real current preload in each mode:
off must perform no adapter/Node-API query or serialization call; on must perform
the existing query, serialization and full decode, with one document lifecycle.
Instrumentation is installed only inside those test processes.

Validation uses one ordinary reservation around the complete sequential driver:

```sh
python3 /tmp/mad-dom-bun-native-performance-efaa64b/activity.py \
  --task 01-metadata --kind build-test -- \
  /tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun \
  plans/bun-native-performance/evidence/harness-followup/validate.mjs
```

`validate.mjs` is a once-only driver for this fresh checkout; it refuses preexisting
node_modules/build/target. It verifies the recorded executable hashes and actual
Bun version/revision, reads `.bun-version`, verifies Rust 1.93.1, then runs:

1. `bun install --frozen-lockfile` and independent `bun run dev:build` here, with
   `CARGO_TARGET_DIR` explicitly under this worktree.
2. On both recorded Bun executables: `bun run check`,
   `bun test benchmark/bun-performance`, the two existing DOM harness tests,
   `bun run report:runtime`, all-suite tiny FFI-on/off smoke and saved-result
   verification. Both overrides point to this worktree's `build/mad-dom.node`.
3. Read-only original evidence/source/artifact checks. No old worker is rerun and
   no historical JSON/hash is rewritten. Every build/test child runs directly
   under the outer reservation without a nested gate.

Raw gate stdout/stderr and per-command stdout/stderr/exit/hash belong in this new
directory. `before.json` records the source, new harness and full original baseline
inventory before validation; `validation.json` records actual successful checks,
new tiny batch paths/hashes and physical build isolation. Any failed invocation
is retained and explained, never converted into a passing sample.

The two runtimes are the immutable task-01 baseline 1.4.0 and its experiment-time
latest 1.4.2. Their paths/hashes are checked against the original reference
manifest. This followup makes no fresh latest claim; 05 must independently resolve
latest again. Only correctness/tiny checks are authorized here, no formal timing
or speedup. The reference remains at its original path through completion of 05.

At preparation the ordinary reservation is queued behind task 02's resume-1
sampling holder. Validation completion is reported only after the driver actually
runs; no lock is bypassed, reprioritized or interrupted.
