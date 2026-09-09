# Task 02 protocol and budget, declared before formal sampling

The before endpoint is task 01's frozen efaa64b source and its image, SHA256
2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96.
`before.json` captured all candidate production files before implementation;
`before-image.json` records the independently built identical initial image.
Task 01's complete before rounds/profiles remain in `../baseline/`, including
the original 16 Core, 13 Testing and 19 operations in each of three layers.

Only query, child and preorder packing changes. Keep the node collectors,
missing-index Vec, one packing registry lock, fresh proof, opaque tokens and
continuation. No read_batch change: 01's JS profiles do not establish a useful
Rust id/class allocation hotspot. No parser/selector/traversal changes, native
cache, scratch pool, operation path policy, ABI change or dependency update.

Allocation budget: zero intermediate packed Vec and zero packed-output copy
per successful FFI snapshot; the existing node and missing-index Vecs remain.
Caller storage and Node-API arrays remain independently owned. The caller borrow
is the checked required prefix, never full-capacity uninitialized u32 values.
Node-API retains one owned Vec, initially valid u32 values, filled by the common
helper. This initialization is a possible fallback cost and must be measured.
No new retained native memory. Existing v2 RSS missed one of four injected leak
runs; safety scans and passing lifecycle/RSS tests cannot prove arbitrary FFI
memory safety or absence of native leaks.

Every installation/build/test/selftest is under activity.py task 02 build-test.
Every formal campaign/profile/performance comparison/bench:check uses the task
02 sampling reservation. One Bun driver owns the complete paired ABBA group,
all child processes are synchronous descendants, and no process detaches.
Build/target are exclusive to this checkout. Both overrides name this checkout's
build/mad-dom.node for validation; the public runner supplies each endpoint's
own source/image overrides during source comparison. The frozen checkout is
read-only and must not be installed, rebuilt, chmodded or modified.

Baseline is read from .bun-version. Latest is independently resolved from the
official release API and downloaded to task 02's runtime directory; see
runtimes.json and latest-release.json. Use these explicit executables, never
mix versions in a ratio. Hash candidate production, image, runtime and harness
before/after each campaign; a new production file must appear in the runner's
inventory. Do not edit measured production or images until the campaign ends.

Formal order: baseline source FFI on; latest source FFI on; baseline source FFI
off; latest source FFI off. Each comparison includes core, testing, raw, adapter,
facade; all sizes 1, 0.1, 2; all phases, fixtures (including unknown b descriptors
and Unicode), pool tiers and output materialization unchanged. Each suite runs
two complete ABBA groups, a fresh process per letter, two warmups and nine
measured rounds, 32 hotspot operations per round. The existing independent
per-side path audits precede timing. Smoke is separately labelled and untimed
for conclusions. Task 01 already established the same-source FFI on/off before
comparison; this task measures same-runtime source changes in both modes.

Separate baseline/latest source-FFI-on CPU profiles cover A/B in raw, adapter
and facade at size 1, 32 operations per round, two warmups and nine measured
rounds. They retain the original workload and do not enter timing ratios.
Profile summaries separate whole-process samples from the operation-stack
subset; JS samples cannot establish Rust allocator counts.

Retain all attempts, failures, samples, actual paths, digests, load/pressure,
median/p90/MAD and group/process medians. Core/Testing aggregation is the median
of per-round sums. Noise policy matches 01: round MAD >20%, process-median MAD
>10%, or opposite group changes beyond +/-5% flags a suite for exactly one
additional full two-group ABBA batch at all sizes/phases. A repeated >5%
regression also triggers this full-suite investigation, even without a noise
flag; conservatively, any initial pooled change above +5% also triggers it.
Rows above +5% in both batch medians or in every group are explicitly listed for
investigation; group distributions and affected paths are reviewed, not only
this mechanical list. All initial/repeated results remain visible. Any persistent >5% regression
must be located/repaired, not accepted by deleting workload or adjusting gates.

Facade endpoints decide whether public performance improves. Target 10% is not
a promised outcome. If packing has no reproducible public benefit, report that
fact and retain only a minimal implementation justified by reduced allocation
and the checked memory boundary, or retract complexity. Do not claim raw-only
gain as public gain. Shared-VM work in other repositories is uncontrolled;
the reservation excludes only this workflow's other build/test/sample jobs.
