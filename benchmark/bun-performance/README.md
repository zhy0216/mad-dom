# Bun native performance runner

Run from the task checkout. JavaScript installation/execution uses Bun; build with
Rust 1.93.1. The runner never looks up a measurement executable through PATH.
`--help` is executable documentation; no package script is added in task 01.

```sh
bun benchmark/bun-performance/run.mjs --help
bun install --frozen-lockfile
bun run dev:build
export MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"
export MAD_DOM_FFI_PATH="$PWD/build/mad-dom.node"
bun test benchmark/bun-performance
```

The frozen task-01 reference is
`/home/ubuntu/.herdr/worktrees/mad-dom/bun-native-performance-reference-efaa64b`,
source `efaa64b3b9d90cf1988d8092d7de08e97e929630`. It has its own build and target.
Do not rebuild, change or remove it before task 05 finishes. The committed
[reference manifest](../../plans/bun-native-performance/evidence/baseline/reference-manifest.json)
contains source/file, artifact, archive and executable SHA256s and actual revisions.
The current harness imports that checkout's production modules and starts that
checkout's original DOM workers. No harness is copied into the reference.

```sh
REF=/home/ubuntu/.herdr/worktrees/mad-dom/bun-native-performance-reference-efaa64b
BASELINE=/tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun
LATEST=/tmp/mad-dom-bun-performance-01/runtimes/latest/bun-linux-x64/bun
```

Baseline was selected by reading `.bun-version` (1.4.0). The latest executable
above was independently resolved from the official
[latest-release API](https://api.github.com/repos/oven-sh/bun/releases/latest) on
2026-09-08 UTC, which returned [1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2).
That path describes this experiment; future experiments must query latest again,
download to their own directory, and record the resolved version/revision/hash.
Do not edit CI's latest policy. Bun's [profiling documentation](https://bun.com/docs/project/benchmarking)
describes the independent CPU profile used below.

```sh
# Hold the coordinator's exclusive timing reservation. Commands are sequential.
"$BASELINE" benchmark/bun-performance/run.mjs --bun "$BASELINE" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --mode ffi --out /tmp/bun-performance-baseline
"$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --mode ffi --out /tmp/bun-performance-latest

# Future candidate: build it first; both endpoints must own separate artifacts.
"$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --candidate-root "$PWD" --candidate-image "$PWD/build/mad-dom.node" \
  --mode source --ffi on --out /tmp/bun-performance-candidate
# Repeat source comparison with --ffi off and the baseline executable separately.

# Real correctness smoke: both modes, all suites, 2 warmup / 1 measured, tiny size.
"$BASELINE" benchmark/bun-performance/run.mjs --bun "$BASELINE" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --smoke --out /tmp/bun-performance-smoke

# Separate diagnostics. Never count these times as formal samples.
"$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --suites raw,adapter,facade --sizes 1 --iterations 1 --diagnostic \
  --out /tmp/bun-performance-counts
"$LATEST" benchmark/bun-performance/run.mjs --bun "$LATEST" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --suites raw,adapter,facade --sizes 1 --profile /tmp/bun-performance-profiles \
  --out /tmp/bun-performance-profile-evidence

# Revalidate saved evidence; errors return nonzero and cannot publish speedup.
"$BASELINE" benchmark/bun-performance/run.mjs --verify /tmp/bun-performance-baseline
```

The runner owns both overrides in every child. The preload checks the actual
loaded image, ABI 1, all six operation symbols / bitset 31, document binding and
real UTF-8 serialization. Disabled mode must explicitly report disabled. A missing
file, partial/unavailable capability, mixed image, changed source/executable,
failed subprocess, absent result, inconsistent fingerprint or missing workload
invalidates the comparison. Source comparison never mixes Bun versions.

`sourceSha` is the repository's Git HEAD anchor. It does not assert that current
production files match that commit. `productionSha256` hashes the sorted map of
current file bytes: relevant tracked files plus nonignored untracked files under
the declared `productionInputs`. A new `js/` helper changes this digest before
`git add`; `untrackedProductionFiles` makes those inputs visible. A tracked file
that cannot be read fails the inventory. The lock and original DOM-worker
inventories are also bound to the production digest.

The complete task-01 campaign used one frozen harness, preserved byte-for-byte in
[measured-harness-source.json](../../plans/bun-native-performance/evidence/baseline/measured-harness-source.json).
After the campaign, inventory and verification were strengthened; the timed
worker and workload/statistical protocol stayed unchanged. Original manifests,
samples and recorded harness hashes were retained. Saved-evidence verification
checks the recorded inventory hashes, rather than demanding that historical
harness files equal the current verifier. Profile commands and allocation-hook
results cannot be promoted into formal timing.

Every hotspot comparison runs independent A and B diagnostic processes before
that suite's formal ABBA. They instrument JS constructors, TypedArray copies,
adapter methods and native prototype methods. `expectedPath` is a description
of the reference implementation. `observedPath` contains actual per-round calls,
bound to the specific source root/hash, artifact, runtime, mode and audit checksum.
A candidate can select Node-API/range while FFI remains available; the observed
calls expose that selection. An adapter returning `undefined` is an unexpected
fallback and fails the audit. New unobservable operation helpers require an audit
update before they can produce a valid comparison. Formal workers have no hooks.

The three layers have deliberately different output contracts:

| Layer | Timed operation | Output / limitations |
| --- | --- | --- |
| raw | Direct ABI v1 with pre-encoded input and sufficient caller storage; disabled uses the nearest Node-API token/snapshot/string entry | FFI UTF-8 decoding and buffer allocation are outside raw timing. Node-API necessarily returns owned output / strings. Raw creation retains a scalar range on Node-API and a caller array on FFI. These are boundary diagnostics, not public speedups. |
| adapter | Actual loader adapter, including validation, encoding, growth retries, owned copy, and HTML decoding; disabled uses Node-API | Snapshot results remain complete owned packed arrays. No wrapper cost. Creation compares real FFI owned token array with Node-API scalar range, avoiding an artificial Node-API array conversion. |
| facade | Public `querySelectorAll`, child iteration, firstChild/nextSibling traversal, complete HTML getters, or `createElement` | Retains/iterates every returned wrapper and includes decode/hydrate; same fixture and semantic oracle as lower layers. |

19 hotspots per layer: scoped small/large cold/hot queries; child and preorder
cold snapshots plus large-result-to-small-result transitions; innerHTML/outerHTML
ASCII, Unicode and growth/shrink; exact pool tiers 1/8/32/128/256. At size 1, small
means 8 spans, large 512 spans, each with B/text/comment children. Unicode text is
`你好 café 🦀`. Input hashes, UTF-8 bytes, selector, output consumption and cache
state are explicit in each workload record. A fresh document per operation keeps
cold descendants unprimed; hot queries run the exact query once outside timing.
Growth/shrink uses the same document, consumes a large result, replaces the
fragment outside timing, then measures the smaller result. Public creation drains
all earlier pool tiers outside timing and measures one full tier including refill.
All created tokens/wrappers are retained and checked for identity and detachment.

Fixtures/setup, assertions/full-content hashes and forced GC are outside the
timed window. Ordinary GC inside it remains included. Raw snapshot validation
materializes all tokens after timing, compares node kinds/order and exact query/
child serialization, and rejects incomplete continuation. All warmup and measured
hotspot rounds have deterministic semantic digests. The original Core/Testing
workers and their existing oracles stay unchanged: 16 Core and 13 Testing rows,
with all per-round samples and original setup/GC conventions retained. Core's
legacy worker exposes measured samples only; its two discarded warmup times were
never emitted. Hotspot workers also retain warmup timings.

Formal defaults: suites core → testing → raw → adapter → facade, sizes 1 → 0.1 → 2,
two ABBA groups per suite, 2 warmup and 9 measured rounds in each new process,
32 hotspot operations per round. FFI comparison A=off/B=on; source comparison
A=reference/B=candidate at one fixed mode. There are 36 measured rounds per side,
per suite/size. Core/Testing totals sum phases within each round, then take the
median. Reports retain median, nearest-rank p90, MAD, each process median, and each
ABBA group's change. Positive change means B takes longer; speedup=A/B.

Noise policy is declared before formal sampling: flag round MAD >20% of median,
process-median MAD >10%, or opposite group changes beyond ±5%. Repeat each flagged
suite once with two additional complete ABBA groups and all declared sizes/phases;
retain both batches and report unresolved variation as inconclusive. Never select
the fastest process, drop failures, change phase weights or relax regression
thresholds. Shared-VM load, CPU pressure, memory and competing process names are
sampled around every child. Other repositories are not controlled. Independent
process repetitions and noise context are required for any optimization claim.

Each output directory is append-only for one invocation. `manifest.json` declares
the protocol before child launch; attempt JSON retains config/command, exit and
signal, metadata, complete samples, correctness and any failure output. Failed
children do not stop remaining formal configurations, so their evidence is kept.
An invalid prerequisite audit stops dependent timings. `summary.json` exists only
after full validation; smoke/profile/diagnostic rows carry no speedup. Verification
cross-checks protocol versus child runs/sizes/suites/iterations/order and rejects
internally consistent children that executed a different protocol.
