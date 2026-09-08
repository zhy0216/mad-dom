# Task 04 serial integration revalidation

The coordinator authorized `git rebase main` and one priority exclusive gate for
the baseline/latest host IO tests and `bun run check`. The actual
[rebase command](rebase.json) exited 0 at 2026-09-08 15:59:28 UTC and reported
that the task branch was already up to date. There were no conflicts.
Main was `fe77b7e28ba1ca24e40ce9272bc6a504cb32c191`; the original task commit was
`36ca01fb27e591a55a5e29906e094af4b5bc9619`, directly above that main commit.
No production source changed during rebase, so the existing independently built
worktree image is retained. Formal performance campaigns are not rerun.

The [direct driver](rebase-validation.mjs) runs the four commands sequentially
inside the one [outer gate](rebase-gate.json):

```sh
python3 /tmp/mad-dom-bun-native-performance-efaa64b/activity.py \
  --task rebase-04 --kind sampling --priority-integration -- \
  /tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun \
  plans/bun-native-performance/evidence/task-04/rebase-validation.mjs
```

The recorded command uses the absolute driver path. The driver calls each Bun
directly, without nested `activity.py` or `command.py`. Runtime paths and hashes
come from the original independently verified [runtime selection](runtime-selection.json):
baseline 1.4.0 and the latest selected for this campaign, 1.4.2. Each child uses
the selected executable and its directory first in PATH. Both native overrides
point to this worktree's `build/mad-dom.node`, with its own `target` directory.
The driver checks the measured production digest and image hash before execution
and requires identical inventories after all four commands.

The priority request waits for the existing activity lock. It does not interrupt
the surviving task-03 campaign or cancel any reservation. Original activity and
recovery evidence remain unchanged; old granted rows do not prove current lock
ownership. The coordinator will run the complete integration validate separately.

The [new activity snapshot](rebase-activity.jsonl) records requested at
15:59:28.824575 UTC, granted at 17:26:43.491349 UTC and released at
17:27:06.221549 UTC on 2026-09-08, with exit 0. The complete driver ran inside
that single granted interval. Waiting for the lock did not invalidate or replace
the original reservation.

| Runtime | Host IO tests | `bun run check` |
| --- | --- | --- |
| Baseline 1.4.0 (`34cbb9a40b4bd1bd767d134a7065e66c2432a676`) | exit 0; 44 pass, 513 assertions, 0 fail, 0 skip | exit 0 |
| Selected latest 1.4.2 (`744846f844374847c902b5e7fd59b4342a51ef99`) | exit 0; 44 pass, 513 assertions, 0 fail, 0 skip | exit 0 |

[The validation ledger](rebase-validation.json) preserves every command,
environment, start/end, exit and complete stdout/stderr log path. Logs use new
`commands/rebase-*` paths; all earlier raw logs and samples retain their bytes.
The source inventories before/after execution are identical, with production
SHA256 `aaa4955e7377a05b784a4848b4da06d5cd846be9480a7dd59c08553d3045e023`.
The image also remains identical: SHA256
`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`,
3,866,672 bytes, inode 2126487. Both match the measured candidate inventory.

The [integration Git/evidence review](rebase-review.json) records original raw-log
preservation, exact-path whitespace handling and unrestricted diff checks.
[The complete evidence hash manifest](file-hashes.json) covers the new logs and
records as well as the retained evidence, excluding only the manifest itself.
The task commit is amended once with this integration evidence. Full integration
`validate` remains the coordinator's next step, as requested; it is not claimed
by these four command results.
