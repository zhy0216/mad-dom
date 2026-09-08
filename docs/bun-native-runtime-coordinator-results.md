# Coordinator integration results

The remaining tasks 04, 06 and 07 are integrated into local `main`. All required
repository, package-install and benchmark commands passed independently.
**An additional native-memory sensitivity experiment did not fully pass: the
final v2 RSS rule detected three of four injected-growth runs and missed one.**
The failed assertion and complete curve are preserved; no threshold or baseline
was changed to turn it into a pass.

## Integrated commits

| Task | Commit | Agent / model / effort |
| --- | --- | --- |
| 04 memory/GC, continued from PR #3 | `49351d2c346bab2156ac029345f5e95995f379f2` | Codex / gpt-6-astra / max |
| 06 latest CI/release policy | `4a90f51bb6f98cbaf4ceab43579fb12da951ef35` | Codex / gpt-6-astra / xhigh |
| 07 integration and regression evidence | `6dc400bec1763c399967e8b1c6b8130ab50d4eed` | Codex / gpt-6-astra / max |

Each task retained one commit, was rebased by its original agent, passed the
coordinator's repository checks, and entered the original branch by ff-only
merge. Task 07's final rebase was a no-op against `4a90f51`; both Bun versions
then passed 52 focused tests. Its immutable commit independently passed the
14-command repository gate: 691 Rust tests, 1194 Bun tests, type compatibility,
ledger, hdunit, selected WPT, native smoke and documentation build.

Real main/platform tarballs, checksums, installed-package smoke, runtime and
capability checks also passed. Both Bun 1.4.0 and observed latest 1.4.2 passed
`bench:check` against the unchanged original 06 Linux reference; integration
passed. The [latest comparison](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-latest-bench.txt)
and [baseline comparison](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-baseline-bench.txt)
retain the raw signed RSS observation separately from the v2 memory contract.

## Additional v2 RSS miss

The coordinator predeclared two fresh native-only controls per Bun version.
Each retained 1 MiB per measured round, 24 MiB total, through page-touched C
`malloc`; all 24 allocations were freed afterward. Parent lifecycle counters
and the independent same-Bun child FFI digest remained zero in every run. Heap
checks passed. This four-run set is an observation, not a detection-rate estimate.

| Run | RSS growth detected | Evidence |
| --- | --- | --- |
| latest 1 | **No; sensitivity assertion failed** | [complete curve](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-final-native-latest-1.json), [failure log](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-final-native-latest-1-failure.txt) |
| latest 2 | Yes | [complete curve](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-final-native-latest-2.json) |
| baseline 1 | Yes | [complete curve](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-final-native-baseline-1.json) |
| baseline 2 | Yes | [complete curve](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-final-native-baseline-2.json) |

In the missed run, RSS block medians rose to 67.623 / 73.516 / 85.861 MiB,
but the middle block's lower-quartile slope was negative. The full-curve
projected block growth, 5,142,055 bytes, did not exceed the median block IQR,
5,197,824 bytes; the peak also stayed within twice the warm stock. The code
therefore follows its stated predicate while missing the real retained memory.
The original agent independently recalculated this conclusion without changing
files or rerunning experiments.

This is a concrete **final v2** detection limit, separate from the earlier v1
miss with no saved curve and the earlier combined pressure/FFI-finalizer failure.
The required commands pass; the supplementary sensitivity helper exits 1.
The gate remains a finite workload smoke check and must not be presented as a
complete native allocation ledger or reliable rejection of every 24 MiB leak.
No production ownership defect is established by this injected-allocation test.

## Completion and scope

All seven todos are archived. This run's three agents exited, workspaces
`wA`, `wB`, `wD` closed, and their worktrees and task branches were removed.
Other resources were untouched. Local `main` was clean after integration;
the final coordinator documentation is a separate local commit. No push,
PR modification, package publication or hosted CI was performed.

The main checkout's rebuilt native artifact matches the tested image SHA-256
`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`;
its native smoke and runtime report passed after integration. Source native
checks use both overrides pointing to this checkout's `build/mad-dom.node`.

Only Linux x64/glibc was verified locally. The [measurement report](./bun-native-runtime-results.md)
retains performance regressions (latest FFI Core aggregate +17.8%, Bun file
writes about 4× slower), experimental lease restrictions and the unresolved
combined GC diagnostic. Private JSC production integration remains disabled.
Full independent command results, hashes, package observations and cleanup
records are in the [coordinator evidence](https://github.com/zhy0216/mad-dom/blob/main/docs/bun-native-runtime-evidence/coordinator-validation.json).
