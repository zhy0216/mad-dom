# Stable gate and release candidate report (T50)

This is a **historical verification record** for T50, translated from the
original report. The counts and results below belong to that checkpoint; they
are not new verification results from the documentation update. For current
recorded coverage, see [Compatibility](/compat-report), and for subsequent Linux
build measurements, see [Release verification](/release#measured-verification-points).

- Status: release candidate verification, partially complete pending cross-platform CI.
- Work item: `T50` — safety, performance, documentation, and the stable gate.
- Branch: `herdr/todo-50-stable`, based on `main` at `b1a029b`, including T44/T48/T49.
- Provenance: commands were recorded as run in the workspace used to produce
  the original report's commit.

## Acceptance evidence at the checkpoint

### Safety

The original report recorded no known crashes, use-after-free, data corruption,
or unexplained unsafe-code risks in the exercised checks.

- The Rust core contained no `unsafe` blocks. T50 added `#![forbid(unsafe_code)]`
  in `crates/mad-dom-core/src/lib.rs` to enforce that property at compile time.
- The binding inventory contained four documented `unsafe { …cast() }` sites
  in `events_api.rs`, `mutation_observer_api.rs`, and `traversal_api.rs`. The
  recorded justification was that the facade supplies function wrappers and
  the casts erase Node-API phantom types. The safety model is documented in
  the binding crate and `crates/mad-dom-core/SAFETY.md`.
- Three representative Miri tests passed on `aarch64-apple-darwin`:
  `dangling_handle_can_never_read_new_node`, `generation_mismatch_errors`, and
  `retired_slot_is_never_reused`.
- AddressSanitizer passed the core suite with the host nightly target.
- `bun run validate` passed, including Rust checks, 603 Bun tests, property and
  stress tests, and GC lifecycle checks. A CI safety job recorded these checks.

### Compatibility and installation

The compatibility ledger at T50 contained **43/43 passing entries**: 10 type
checks and 33 differential entries, with no known-gap or not-applicable entries.
The API snapshot compared the overall surface rather than adding per-scenario
ledger entries.

The host installation smoke passed the supported, missing-package,
unsupported-platform, and ABI-mismatch cases using a clean Bun installation
without a Cargo toolchain in the consumer flow.

Non-host builds and installation smokes were delegated to the native-runner
matrix in `.github/workflows/release.yml`: macOS x64, Linux glibc x64/arm64,
Windows x64, and Linux musl x64/arm64. They were **not all verified locally**,
which left this acceptance item partially complete.

### Performance gates and package contents

The recorded baseline covered 19 arena, mutation, parser, serializer, selector,
FFI, and GC metrics. It combined the core benchmark and
`scripts/bench-ffi-gc.mjs`. The historical gate rejected throughput below 0.5×
baseline or memory growth over 2×, and required identity/release hit rates of 1.0.
See the [current gate documentation](https://github.com/zhy0216/mad-dom/blob/main/bench/README.md)
for applicable baseline selection and thresholds.

The original report recorded reproducible workloads on the same host, with
separate ignored host-specific baselines on other hosts. A first run that
creates a baseline is not itself a regression comparison.

`npm pack --dry-run` recorded 37 files, including `index.js`, `index.d.ts`,
`js/`, `README.md`, and `LICENSE`, with no `.node` binary in the main package.
Platform metadata matched `scripts/platform-matrix.mjs`. The alpha release
rehearsal packed and checked artifacts without publishing them.

## Recorded validation results

| Check | Command | Historical result |
| --- | --- | --- |
| Unified validation | `bun run validate` | Pass: 603 Bun tests, zero failures; Rust fmt/clippy/test, types, ledger, and WPT checks completed |
| Diff whitespace | `git diff --check` | Pass |
| Unsafe inventory | `scripts/check-core-safety.sh scan` | No core unsafe; four documented binding casts |
| Miri subset | `scripts/check-core-safety.sh miri` | Three representative tests passed |
| AddressSanitizer | `scripts/check-core-safety.sh asan` | Host nightly suite passed |
| Compatibility and WPT | `bun run compat:differential`, `bun run compat:ledger`, `bun compat/ledger-report.js --json`, `bun run wpt:json` | Ledger 43/43; independent WPT measurement 39.8% |
| Performance/memory | `bun run bench:record` then `bun run bench:check` | All 19 metrics passed against the recorded baseline |
| Install smoke | `bun run smoke:install` | Host passed; other platforms required CI |

## Reproduction at that revision

The pinned toolchains were Rust `1.93.1` and Bun `1.4.0`. The recorded sequence
started from a clean checkout:

```sh
bun install --frozen-lockfile
bun run dev:build
bun run validate
scripts/check-core-safety.sh scan
scripts/check-core-safety.sh miri
scripts/check-core-safety.sh asan
bun run bench:check
bun run smoke:install
bun run release:draft -- --stage alpha
```

Miri and ASan require their corresponding nightly toolchain components and
host setup. Replaying commands at a newer revision can produce different counts;
use the original revision when reproducing this checkpoint.

## Remaining items recorded at T50

1. Cross-platform native builds and installation verification depended on the
   release CI matrix and were not completed on the development host.
2. The first Linux release build still needed to establish the glibc floor and
   observe Bun's libc filtering. The glibc measurement was subsequently recorded
   as 2.39 in the [release manual](/release); the paired gnu/musl installer check
   remains described there separately.
3. WPT was a separate measurement track at 39.8%, not a stable-release gate.

The original task produced verification evidence only. It did not push code,
create a PR, publish npm packages, or move the `latest` dist-tag.
