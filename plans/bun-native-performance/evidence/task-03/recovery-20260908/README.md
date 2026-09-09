# Session recovery, 2026-09-08

The original task process and Python reservation wrappers exited during the
session interruption. Their exit times and codes are unavailable. The original
activity journal is preserved; its unclosed `granted` entries do not establish
continued lock ownership. [The coordinator audit](session-recovery-20260908.json)
records the uncertifiable gap and stale requests. No gap duration, missing exit
code, or uninterrupted reservation is invented.

At recovery, baseline FFI campaign PID 2280568 still ran with its original
source, output directory and child runner. The coordinator's orphan guard PID
2288127 acquired both admission and activity locks at 15:53:38.106077Z. The
[task snapshot](task-03.json) records process start identities and actual
`/proc/locks` entries, independently of the stale journal. It also preserves
the in-progress manifest as observed, without replacing the live manifest.
The running driver was neither restarted nor interrupted.

The surviving campaign started at 15:51:06.868Z. Its early processes overlap
the interval whose reservation cannot be certified. A later runner `valid`
flag proves workload/protocol checks, not continuous external locking. Final
interpretation must identify this limitation, retain every affected sample,
and distinguish any complete paired runs wholly protected by the guard. The
guard's final end record and the campaign's final integrity results will be
collected after completion; they are pending in this snapshot.

All four completed source-on batches predate this interruption. Their original
160 valid processes, complete command results and unchanged inventories remain
intact. Their initial regressions and opposite supplemental results are retained.

The three missing campaigns had dead Python wrappers and no live descendants.
They are re-requested through the original `activity.py --task 03 --kind sampling`
using fresh `latest-ffi-resumed`, `baseline-source-off-resumed` and
`latest-source-off-resumed` directories. The unchanged driver keeps the original
two ABBA groups, two warmups, nine measured rounds, every suite/size/workload and
declared single supplemental rule. It does not acquire a nested lock.

Production bytes remain identical to the separately archived candidate v1. No
existing raw data, method, driver or shared runner was changed during recovery.
The `.py` and journal copies here are evidence snapshots, not execution entrypoints.

The original driver and its declared supplement completed successfully. Both
source/image/driver inventories report unchanged. The guard ended normally at
17:26:43.491039Z; its [final bytes](orphan-guard-final.json) and the
[per-attempt and per-group coverage](completed-coverage.json) are preserved.
The initial Core attempts 1–5 are not wholly covered by the guard, so neither
initial Core ABBA group has certified continuous reservation. Every other
initial suite and all five supplemental suites have two complete protected
ABBA groups. The protected Core supplement supplies the required two groups;
the initial Core data remains visible with its limitation, including in the
unfiltered combined tables. Do not treat that pooled Core median as wholly
reservation-qualified evidence.

The restored latest FFI campaign was granted a new ordinary sampling reservation
at 17:27:06.221948Z, after the guard ended and the coordinator's queued integration
check released its own reservation. No new command bypassed or nested a lock.
