# ADR-0010: Latest Bun CI and release metadata

- Status: accepted; task 06 local acceptance complete after integration with task 04
- Date: 2026-09-07; integration verified 2026-09-08 UTC
- Scope: `plans/bun-native-runtime/todos/done/06-latest-bun-ci-and-release-policy.md`

## Version selection

`package.json.engines.bun >=1.4.0` is the minimum supported runtime.
`.bun-version=1.4.0` remains the reproducible baseline. The latest CI lane
and release builders explicitly request `bun-version: latest` from
`oven-sh/setup-bun@v2`; the baseline lane separately requests
`bun-version-file: .bun-version`. Both lanes run the complete repository and
packaging checks. Release depends on the reusable CI workflow before platform
builds. Weekly CI also catches new stable runtime releases without a source push.

This supersedes the requirement in ADR-0002/0005 to run every CI/release on
Bun 1.4.0. It does not alter their recorded measurements, the minimum support
floor, Node-API object ABI, or Rust 1.93.1. Baseline benchmark measurements are
not evidence for unmeasured latest runtimes or different hardware.

Official sources checked on 2026-09-07:

- [Latest stable release API](https://api.github.com/repos/oven-sh/bun/releases/latest):
  `bun-v1.4.2`, `prerelease: false`, published `2026-09-05T05:55:48Z`.
- [Release 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2).
- [setup-bun v2 inputs/outputs](https://github.com/oven-sh/setup-bun/blob/v2/action.yml)
  and [input selection](https://github.com/oven-sh/setup-bun/blob/v2/src/index.ts):
  explicit version takes precedence over the version file and package metadata;
  installed version/revision are reported by the action.

Local latest verification is Bun 1.4.2, revision
`744846f844374847c902b5e7fd59b4342a51ef99`, Linux x64/glibc. Baseline 1.4.0 was
downloaded separately from its official GitHub release; PATH selection also
keeps subprocesses on that baseline. No hosted workflow or platform matrix was
run from this task. Hosted results must identify the actual selected runtime;
a local 1.4.2 run is not proof of a future dynamically resolved latest run.

## Two native channels and one image

The required Node-API object/lifecycle ABI remains 1. The optional additive
FFI ABI independently remains 1, with supported operation bitset 31 at this
checkpoint. Neither ABI is a Bun patch-version pin. Runtime probes decide
which operations can run. Partial or unavailable FFI preserves Node-API;
a missing required platform image or Node-API ABI mismatch still fails.

`js/runtime-metadata.js` derives the contract from loader constants and checks
the declared package metadata. Main and platform `madDomRuntime` share the
npm package version, both ABI versions, supported capability bitset, and
`ffiRequired: false`. Platform `madDomBuild` records actual Bun, platform/libc,
both channel observations, capability level, and SHA-256 of the payload.
`madDomFfi`, if present, equals `main`. Packaging and smoke reject a second
native image; copying a library would create an independent document registry.
The runtime loader itself is unchanged by task 06.

A build with unavailable/mismatched/disabled FFI, or zero usable optional
symbols, can still package a verified Node-API image and produce a draft.
Build observations are not runtime disable switches. Compatible symbols in
the same image may become usable later; `MAD_DOM_FFI_DISABLED=1` is the runtime
opt-out. Release reuse rejects stale versions, incorrect ABIs/capabilities,
wrong platform metadata, changed binary checksums, or extra native images.
Real publish requires the full selected stage; local drafts can record an
explicitly incomplete host-only matrix.

The generic external-deallocator report remains `api-present-unverified`.
Bun's API presence is distinct from ownership/lifetime safety measurements.
Caller-owned buffers remain the default. Task 04 records real native callback/GC
spike results and their Linux-only limits in ADR-0009 and the memory protocol.
The generic API-presence result does not imply production external-buffer
ownership safety or add an external allocation capability to FFI ABI v1.

## Installation evidence and limits

Install smoke supplies local main and host platform tarballs as direct
file dependencies, uses `bun install --frozen-lockfile --ignore-scripts
--no-optional`, and clears inherited source-path/FFI/test overrides. The
selected native image must be the installed tarball payload. Each process
reports Bun, platform/libc, Node-API ABI, FFI ABI and capability status.

Checks cover automatic FFI, explicit disabled, missing FFI path, mismatched
FFI ABI and partial symbols; missing/unsupported required platform and
Node-API ABI mismatch have separate hard error assertions. Real installed
metadata is mutated to verify rejection. A Linux test-only payload masks C
FFI export names in a copy of the current binary while retaining Node-API.
Only that image is packaged. Its automatic `unavailable` result, successful
DOM smoke and Node-API-only release draft exercise actual absent symbols,
not just a manifest change. This fixture is never a publish input.

The real enabled, disabled and unavailable-symbol drafts and host installs
passed locally on 1.4.2. Baseline 1.4.0 also passed enabled installs and the
fallback scenarios. Documentation and actionlint checks passed. The Linux
`bench:check` first run established an ignored host baseline; it did not
compare Linux performance against the committed macOS results. Tiny DOM and
boundary benchmark checks are correctness sanity, not performance claims.

An additional 1.4.0 run reused that 1.4.2 host baseline and failed the existing
GC RSS-delta multiplier: baseline -18.57 MiB becomes a -37.14 MiB ceiling,
rejecting current -22.44 MiB. A negative delta under this formula is not direct
evidence of memory regression. This failed extra comparison is retained for
integration review; task 06 does not change the benchmark or its thresholds.

The initial full suite failed on a hardcoded Darwin Navigator expectation and
on GC pollution of global document counters. Task 04 fixed the expectation
against happy-dom's actual result and isolated the strict GC counter checks.
After rebasing onto `49351d2c346bab2156ac029345f5e95995f379f2`, both full
`bun run validate` runs passed: Rust 691 tests per run, Bun 1140 on latest
1.4.2 and 1146 on baseline 1.4.0, with zero failures. There were no rebase
conflicts; the 04 implementation and done state were retained unchanged.

A subsequent coordinator review reproduced a metadata bug: JavaScript bitwise
operators truncate `2 ** 32 + 31` to the same low bits as 31. Metadata now must
be an integer in `[0, 0xffffffff]` before the known-bit check. The bound also
applies to capability values supplied in disabled/unavailable/mismatch reports;
partial zero-capability fallback remains valid. Six added tests cover this
boundary, including a claimed Node-API-only partial observation. The real
platform metadata tamper now raises `MAD_DOM_METADATA_MISMATCH`.

Verification timing is explicit: latest's 1140-test full run preceded this u32
fix. Baseline's full command started earlier, but its test phase loaded the
six added cases (1146 tests). Final-code release tests separately passed 19/19
on both Bun versions. At that task-06 checkpoint the coordinator was still to run the final immutable
commit; the earlier latest full run is not represented as a full run of that
final commit. Task 07 starts from the actual integrated 06 commit and records
its own subsequent full validations separately.

The rebuilt native image SHA-256 is
`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`.
Final main tarballs include the u32 fix; platform checksum metadata and the
installed payload are checked against that actual image. Enabled, disabled,
and unavailable-symbol fixtures pass draft/checksum/install, with only one
image in each platform package. Both integration suites (10 tests plus the
exception observer), documentation builds, actionlint 1.7.12, capability and
boundary/IO/tiny-DOM sanity passed. The FFI GC benchmark exercised all six
operations on both versions and ended with zero document/registration/cache
deltas. This does not change the historical negative-RSS threshold issue,
which was assigned to task 07 at the 06 checkpoint.

The local integration install first encountered ENOENT in an incomplete
`file:../..` dependency copy. The failed node_modules tree was moved to a task
backup, and a fresh task-specific Bun cache plus `--frozen-lockfile` installed
all 79 locked packages successfully. The original integration command then
passed on both versions; no lockfile, dependency, or integration test changed.

Final commands and timing are recorded in the archived 06 todo. Local raw
artifacts are under `build/06-integrated/`; command logs use
`/tmp/mad-dom-06-integrated-*.log`. These local gates clear the previous 04
blockers and complete task 06; hosted verification remains separate.

Cross-platform and musl behavior remains unverified locally. Packaging now
requires the payload to load on the runner and checks the measured libc;
a cross compiler on a glibc runner alone does not establish a musl install.


## Task 07 integration follow-through

The final integration worktree starts from task 06 commit
`4a90f51bb6f98cbaf4ceab43579fb12da951ef35`, after task 04 commit
`49351d2c346bab2156ac029345f5e95995f379f2`. The
[task 07 report](../docs/bun-native-runtime-results.md) records the final local
repository, installed-package and benchmark results. The historical functional
failures above are resolved; they are not current repository gate blockers.

Task 07 preserves the original Linux baseline and negative-RSS failure. Fixed
repetitions also disprove the initial zero-ceiling correction as a noise model.
The signed delta remains raw evidence; a separate current-run stability contract
checks a fixed 200-document × 100-child workload, 8 warmup / 24 measured rounds,
positive warm-stock bounds, local trends plus a signal/spread check across the
full RSS curve (`mad-dom/memory-stability/2`), and exact zero lifecycle counters.
First-host recording must pass those checks and valid current metrics before
writing a baseline. This explicitly changes memory acceptance semantics, without
changing historical throughput/capacity thresholds or rewriting the baseline.
The report preserves the former failures, real retained-memory negative controls,
finite-horizon limits and final results; it does not claim an old-threshold pass.

A new worktree plus empty external Bun cache reproduced a recursive hoisted
`file:../..` copy even with install exit 0. The integration directory now selects
Bun's isolated linker. The unchanged frozen lockfile installs cleanly on both
versions, with no nested destination copy and matching installed JS hashes.
This is distinct from the earlier incomplete-cache ENOENT recovery. No dependency
version, public facade, ABI or release platform matrix changes in task 07.
Hosted verification and non-host/musl validation remain separate.
