# Task 02 session interruption and recovery

The original task session and Python reservation wrappers exited externally.
At recovery, no task-02 Bun process survived. Eleven task-02 reservations had
unfinished journal entries: one granted formal campaign and ten requested
jobs. A historical requested/granted entry does not establish a live lock.

The interrupted `baseline-source-on-formal` contains 24 completed processes
(eight each for Core, Testing and raw), followed by metadata for the first
adapter process. The parent command has no known exit status; the manifest has
no completion marker and the driver has no after fingerprint. Its files and
all uncertain exit facts are retained unchanged. These samples are excluded
from acceptance ratios; the recovery reruns the complete five-suite matrix.
The four smoke campaigns and functional verification completed before this
interruption and retain their successful command exits.

Records:

- [Task audit and original file hashes](audit.json): observed dead wrappers,
  incomplete campaign, current source/image check and limits.
- [Coordinator audit](session-recovery-20260908.json): all workflow stale
  reservations and the untraceable lock-loss interval.
- [Coordinator orphan guard](orphan-guard.json): protects the surviving task-03
  process; task 02 does not signal it or acquire workflow locks directly.
- [Journal snapshot](activity.jsonl) and [command ledger snapshot](commands-before-resume.json):
  exact recovery-time copies; original history is not repaired or fabricated.
- [Recovery protocol](../resume-1-method.md): original sizes, groups, rounds,
  FFI-on/off comparisons and supplemental thresholds; new append-only outputs.

The exact wrapper exit times, exit codes and lock-loss window cannot be
retrospectively certified. Matching bytes at recovery do not reconstruct that
window. New work continues only through the original activity.py gate.
