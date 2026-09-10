# Task 05 predeclared final-campaign protocol

Declared 2026-09-09T19:0xZ, before any 05 formal/sampling/smoke/bench:check/profile
process started. It follows the task-01 protocol frozen in
[../baseline/method.md](../baseline/method.md) and the runner README; nothing here
changes suites, sizes, repetitions, statistics, noise rules, thresholds or weights.

Subjects:
- A = frozen reference checkout `efaa64b3b9d90cf1988d8092d7de08e97e929630` with its
  own image `2d1f85d4…2fa96` (read-only, never rebuilt).
- B = this task-05 candidate: main line `09c6a68` (01 fe77b7e + 04 24d8912 +
  01-metadata 5cf2163 + 02 834f5ff + 03 09c6a68), independently installed and
  built here; image SHA256 `6b7e7398119fe255a3aead79cf81d6e68da40923359dc2c8b2595c9663331903`;
  `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` both point at this single image.
- Runtimes per `runtimes.json`: baseline 1.4.0 from `.bun-version`; latest
  independently resolved 2026-09-09 (still 1.4.2, retained exe hash-matched).
  No cross-runtime ratios.

Comparisons (six formal campaigns, in this serial order):

| Label | mode | ffi | What varies | Purpose |
| --- | --- | --- | --- | --- |
| `baseline-source-on` | source | on | ref vs candidate | merged-change effect on default public paths |
| `baseline-mode` | ffi | - | off vs on (candidate) | re-test facade FFI on/off hotspots on the combined image |
| `baseline-source-off` | source | off | ref vs candidate | Node-API fallback effect incl. 02 zero-init + layout-drift re-gate |
| `latest-source-on` | source | on | ref vs candidate | same as above, latest runtime |
| `latest-mode` | ffi | - | off vs on (candidate) | same |
| `latest-source-off` | source | off | ref vs candidate | same |

Formal mechanics (identical to 01/02/03): every campaign 40 fresh processes =
5 suites (core, testing, raw, adapter, facade) × ABBAABBA; 2 warmup + 9 measured
rounds per process; sizes 1 → 0.1 → 2; all 16 Core / 13 Testing / 19 hotspots per
layer; 32 hotspot operations per round; independent per-endpoint/per-mode path
audits precede hotspot suites; fingerprints must match or the run is invalid;
aggregate = per-round timed-phase sums, then median; positive change = B slower.

Noise/supplemental (unchanged predeclared rule): round MAD >20%, process-median
MAD >10%, or opposite group changes beyond ±5% flag a row; every flagged suite is
repeated exactly once in a supplemental two-ABBA campaign (max +40 processes per
campaign) with all sizes/phases retained; both batches and the combined
distribution are reported; unresolved variation stays inconclusive. No fastest-run
selection, no dropping, no threshold or weight edits.

The entire batch — historical bench:check guard, tiny smokes (all six campaign
shapes, 2 warmup/1 measured, size 0.001, correctness only), the six formal
campaigns with their supplementals, and independent CPU profiles — runs inside
ONE `activity.py --task 05 --kind sampling` reservation via one driver process;
children never take a nested lock and never detach from the driver. Profiles run
after formal sampling (mode source, FFI on, suites raw/adapter/facade, sizes as
declared,
A=ref/B=candidate, 6 processes per lane) and are diagnostics only.

Regression handling per plan/todo: a facade ≥10% stable gain (or eliminated
confirmed regression) is the performance target; repeated >5% regressions in the
aggregate or main unoptimized phases are located from raw distributions and
re-tested under this same protocol; rows on paths that do not execute changed
code and reverse across batches are reported with the 02 layout-drift and 03
null-control (site/path-history effect) context, not washed. Attribution to
this workflow's changes goes back to the coordinator for repair, not into the
report. RSS/heap/lifecycle observations ride on every formal process as recorded
by the runner; the historical RSS v2 miss disclosure and raw-RSS limitations
remain; no unmeasured platform is claimed.

All evidence is append-only in `evidence/final/` (campaign directories,
`commands/commands.json` ledger, integrity records, tables). Any failed or
invalid process is retained with its real exit and cannot contribute a speedup.
