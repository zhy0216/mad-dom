# Task 05 final evidence index

Integrated performance validation on the merged candidate (01 `fe77b7e` +
04 `24d8912` + 01-metadata `5cf2163` + 02 `834f5ff` + 03 `09c6a68`, rebased
onto tests-only `050a685`) against the frozen reference `efaa64b`.
Plan-level summary: [../../results.md](../../results.md).

| File | Content |
| --- | --- |
| `method.md` | Predeclared final-campaign protocol (declared before any sampling process; suites/ABBA/noise/aggregate rules inherited from `../baseline/method.md`, unchanged) |
| `runtimes.json`, `latest-release-resolution.json` | Baseline 1.4.0 from `.bun-version`; latest independently resolved 2026-09-09 = 1.4.2 with exe hashes/revisions |
| `artifact-identity.txt` | This worktree's build identity (image SHA256 `6b7e7398…`, shared by the Node-API and FFI overrides) |
| `campaign-all.mjs`, `campaign.mjs`, `analyze.mjs`, `checks.mjs` | Frozen drivers: single-lock campaign orchestrator, per-campaign worker (integrity + auto-supplemental), analysis, T1 focused-suite driver |
| `campaign.json` | Whole-reservation record: 17 steps (all exit 0), `before`/`after` inventories, `unchanged: true` |
| `commands/commands.json` + `NNN-*.log` | Gated command ledger (115 pre-rebase + 116–126 post-rebase re-verification) with hashed stdout/stderr and real exits |
| `smoke-*` (6 dirs + integrity) | Correctness smokes for every campaign shape (2 warmup/1 measured, size 0.001), all `valid: true` |
| `baseline-{source-on,mode,source-off}`, `latest-{source-on,mode,source-off}` (+`-supplemental`) | 12 formal batches, 472 fresh processes, every manifest/summary valid: per-attempt records, audits, memory/RSS observations, `summary.json` |
| `*-integrity.json` (20) | Per-batch before/after fingerprints: reference source+image, candidate source+image, runtime exes, shared harness, frozen drivers |
| `tables.md`, `analysis.json` | Per-batch complete phase tables (every retained sample) and machine-readable summary incl. noise flags and memory observations |
| `combined.json`, `combined-tables.md` | Initial+supplemental pooled distributions per campaign (the source for every percentage cited in `conclusion.md`) |
| `analysis-consistency.json` | Final in-lock analysis re-emitted the formal tables byte-identically to the pre-profile interim outputs |
| `profile-baseline`, `profile-latest` (+integrity), `profiles/` | Independent CPU-profile batches (diagnostics only, never ratios). Per-attempt report JSON/metadata, path audits and manifests are committed in the batch dirs; the raw `.cpuprofile` binaries are excluded by `./.gitignore` per the 01–03 precedent and are bound by path/bytes/SHA-256 to their committed records in [`profiles/INDEX.json`](profiles/INDEX.json) (12 profiles, 64,421,282 bytes) |
| `conclusion.md` | **T2 conclusions**: facade ≥10% verdict, FFI on/off on the merged image, 02/03 handoff re-gates, regression dispositions, RSS/lifecycle, limitations, acceptance statement |
| `WORKLOG.md` | Chronological session log (UTC) reconciled with the shared `activity.jsonl` gate journal |
| `.gitignore` | Excludes `profiles/**/*.cpuprofile` (raw profiler bytes stay local, indexed by SHA-256 in `profiles/INDEX.json`) |
| `.gitattributes` | `commands/*.log -whitespace`: raw captured output is evidence and is never rewritten (same convention as the vendored-tree rules in the root `.gitattributes`) |

Reproduction: `bun install --frozen-lockfile` → `bun run dev:build` →
`bun run bench:bun-performance -- <abs --bun/roots/images …>` per
`benchmark/bun-performance/README.md`; the formal matrix itself ran through
`campaign-all.mjs` under one `activity.py --kind sampling` reservation.
