# Recovery addendum — 2026-09-08

This addendum changes only campaign locations and orchestration after the
external session interruption. The original [method and budget](method.md),
workloads, sizes, thresholds, runtime selection and full-suite supplemental
rule remain unchanged. No original driver or measurement file is overwritten.

The [recovery audit](recovery-20260908/audit.json) records 11 dead unfinished
task-02 reservations and no surviving task-02 Bun process. The original
baseline-source-on formal directory contains 24 completed process records,
plus metadata for the first adapter process, out of 40 expected processes.
It has no closing manifest, after fingerprint or known parent exit code. Its
raw data stays on disk but is excluded from acceptance ratios. The exact
wrapper exit time and lock-loss interval cannot be reconstructed. Coordinator
records are preserved separately from the unchanged original activity journal.

The four completed smoke comparisons remain valid correctness evidence and
are verified again with the public runner under the new reservation. Current
production/image bytes match the completed functional verification. A new
static inventory check runs before recovery sampling; no rebuild is needed.

`resume-1.mjs` is invoked once through the original activity.py with task 02,
kind sampling. It waits for the coordinator's guard and other real lock
holders. It never takes locks directly, nests a gate or detaches children.
It keeps the reservation through the following synchronous sequence:

1. Recheck the retained evidence inventory, frozen reference and four smokes.
2. Run all five suites in new `resume-1-*-formal` directories, in the original
   baseline-on, latest-on, baseline-off, latest-off order. Each suite uses two
   full ABBA groups; each new process runs two warmups and nine measured rounds,
   sizes 1, 0.1, 2 and 32 complete hotspot operations per round.
3. Apply the unchanged predeclared rule to each complete initial result and
   run one full two-group supplemental batch for each triggered suite, retaining
   every size and phase. Original interrupted samples are never mixed into a
   complete ABBA group or substituted for a missing process.
4. Run separate baseline/latest A/B profiles, derive complete tables, run the
   unchanged historical bench:check guard and repeat the final static inventory.

Node-API FFI-off public comparisons remain mandatory for the new initialization
cost. Public facade results decide benefit; allocation/copy accounting alone
does not prove public speedup. All regression/noise review and historical
scratch/lifecycle/RSS limits continue to apply. No task is archived by this
driver merely because its commands complete.
