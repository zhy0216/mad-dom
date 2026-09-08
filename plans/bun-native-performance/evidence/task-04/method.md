# Task 04 predeclared protocol

Declared before production checksum edits or formal samples, 2026-09-08 UTC.
Baseline: read `.bun-version` (1.4.0). Latest queried independently at preparation
from the official release API (raw `latest-release.json`), resolving bun-v1.4.2.
Reuse the exact task-01 executable hashes; Rust 1.93.1, own target/build. Both
native overrides always point to the selected source's one build/mad-dom.node.
The checksum CLI does not load DOM/native code; native capabilities are separately
verified by report:runtime and actual native tests, never inferred from IO timings.

Workloads: actual unmodified CLI generate and verify, in order, for small (4 ×
4 KiB), many (128 × 16 KiB), large (4 × 8 MiB). Opaque deterministic binary .tgz
bytes with ASCII/Unicode sorted names and a real shasum manifest (4 or 128 entries).
Tar extraction is outside the checksum CLI's contract. All input bytes, every
expected digest, full manifest and semantic fingerprint are retained. Fixtures
are made before timing and removed after all validations. The same harness is
used for frozen source and candidate; no writes/builds in reference.

Two distinct windows: internal evaluates a unique data module containing the actual CLI source
for every round (only relative import and import.meta.url resolved to source), includes module evaluation/argument parsing/IO/hash/console output
and natural GC but excludes Bun startup. Dependencies use normal module caching.
Each round validates every tarball's bytes/digest and the complete manifest after
timing. Direct CLI process time starts immediately before spawn and stops after
exit, explicitly includes startup/exit/stdout transport, excludes fixture/oracle
and deletion. The parent labels its first two direct CLI launches warmup and keeps
nine measured fresh-process launches, each itself cold. This window cannot claim
in-process JIT warmup. Internal workers are new per side/workload, each 2 warmup /
9 measured. No forced GC. Diagnostic host-call instrumentation runs separately.

Formal before: each runtime separately, A=forced fallback and B=Bun on frozen
reference, ABBAABBA. Confirm current checksums source equals reference before it.
After scan optimization: same-runtime A=reference / B=candidate, separately enabled
and fallback, ABBAABBA. Each letter starts a new driver worker, each operation
starts its own internal worker with 2/9 and all direct CLI samples. Complete paired
sets stay beneath one activity.py --task 04 --kind sampling reservation; children
are awaited. Builds/tests use --kind build-test, including selftests.

Median, nearest-rank p90, MAD, all process medians and two group changes for every
window/workload. Flag round MAD >20%, process-median MAD >10%, or opposite group
changes beyond ±5%; repeat a flagged comparison once as two complete ABBA groups,
all workloads unchanged. Also repeat any source row with both group regressions
>5%. Retain failures and all initial/repeat samples. An unresolved small/noisy
change is inconclusive; repeated >5% source regression requires diagnosis/fix.
No workload deletion, threshold change or cross-runtime ratios.

Concurrency evaluation budget (declared before edits): compare sequential against
at most 2 files and 8 MiB total scheduled bytes (one oversized file alone). No
unbounded Promise.all. Extra stat/scheduling/error ordering complexity is retained
only with repeatable >=10% end-to-end benefit on both runtimes, no repeated >5%
regression, and <=16 MiB additional RSS above sequential on these fixtures.
Otherwise retain sequential processing and the one-scan Set. Exact sequential
exception ordering is the default. Manifest IO decisions use only these workloads.
The historical 1 MiB repeated-write ~4× difference is a separate microbenchmark,
not evidence of real checksum manifest benefit. A measurement-only prototype may
live under this evidence directory; it is never a production capability contract.

Record full source inventory (including untracked production inputs), executable
and native image hash before/after, actual absolute commands and IO call audit.
Shared VM CPU/load/pressure/competing process names are retained. Other repositories
are uncontrolled. Endpoint RSS/heap and process maxRSS are not precise peak live
buffer measurements; call audits separately count scheduled tarball bytes/files.
Historical v2 RSS leak blind spots, native lifecycle and scratch limitations remain;
this checksum task does not improve or weaken those gates.
