# Task 01 predeclared measurement protocol

Declared 2026-09-08 UTC before any formal sampling. Owner: task 01; coordinator
has granted the exclusive build/test/benchmark window through task completion.
This workflow executes builds, tests, diagnostics and timings sequentially; other
repositories may run and must not be stopped. Every measurement records visible
system load and competing process names.

The executable protocol and complete commands are in
[the runner README](../../../../benchmark/bun-performance/README.md).
Baseline is `.bun-version` 1.4.0 / revision 34cbb9a40; official latest-release API
resolved 1.4.2 / 744846f84 at preparation. Both freshly downloaded executables,
source files and the frozen native image are hashed in `reference-manifest.json`.
Both checkouts were independently installed with `bun install --frozen-lockfile`
and built with `bun run dev:build`, Rust 1.93.1. Their native files have distinct
inodes. No build output is shared. Production source is unchanged from efaa64b.

Formal batch order: baseline FFI off/on, then latest FFI off/on. In each runtime:
core, testing, raw, adapter, facade; each suite executes A B B A A B B A, with A=off,
B=on, every letter a new explicit-executable process. Each process executes sizes
1, 0.1, 2 in that order, 2 warmup and 9 measured rounds per size. All 16 Core / 13
Testing / 19 hotspots in each layer are mandatory. Hotspots use 32 operations per
round. Full raw samples, process order, exits, correctness checks and RSS remain.
Only same-runtime ratios are computed. Task 01 measures frozen production; future
02/03/05 use the identical runner with mode source and explicit candidate image.

Statistics: per-round sum for Core/Testing aggregate, then median; nearest-rank
p90 and median absolute deviation; also all four process medians per side and
both group changes. Formal speedup = A/B, change = (B/A - 1) × 100%. No confidence
interval is invented from correlated in-process rounds.

Noise / supplementation: any suite with a row whose round MAD exceeds 20%, whose
process-median MAD exceeds 10%, or whose two group changes have opposite signs
beyond ±5% receives exactly one supplemental two-group ABBA batch with all phases
and all three sizes unchanged. Supplemental batches run after the two initial
runtime batches, baseline then latest. Keep every original and supplemental
sample. Report both batches and a combined distribution; unresolved variation is
inconclusive. This is not permission to alter the plan's >5% repeat-regression or
10% target rules for future optimization.

Independent path audit processes run before each suite's first formal process,
including separate reference/candidate audits in source mode. Their hook counts
are excluded from timing. CPU profiles run after formal/supplemental sampling in
separate processes and are never admitted as performance ratios. Profile stack
summaries distinguish operate from setup/validation/GC; Bun's JS CPU profiler does
not establish a Rust allocator count or a native internal causal breakdown.

Preparation smoke and tests may precede formal sampling. They are explicitly
labelled smoke/diagnostic/development and have no speedup. Any failed preparation,
sampling, gate or error fixture is retained with its real exit, never replaced by
a synthetic passing result. The command ledger is `commands/commands.json`.
