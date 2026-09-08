# MAD DOM release manual (T49, stable gate T50)

This document is the build / publish / rollback manual for the native
platform packages (`@mad-dom/platform-*`) and the `mad-dom` main package, per
[ADR-0005](https://github.com/zhy0216/mad-dom/blob/main/adr/0005-native-build-and-release-architecture.md). The support
matrix and the runtime error contract live in the [README](https://github.com/zhy0216/mad-dom/blob/main/README.md#support-matrix)
("Support matrix" section, which the loader error messages anchor to). The
stable-gate verification evidence (compat rate, safety suite, benchmarks,
install smoke) is in [docs/stable-gate-report.md](./stable-gate-report.md).

## Bun version policy

| Role | Selection | Meaning |
| --- | --- | --- |
| Minimum supported | `package.json.engines.bun >=1.4.0` | Runtime floor, independent from either native ABI |
| Reproducible baseline | `.bun-version`, currently `1.4.0` | Regression diagnosis and dated benchmark reproduction |
| Latest verification | `setup-bun@v2` with explicit `bun-version: latest` | Resolve stable Bun on each CI/release run; record the installed version/revision |

The latest and baseline CI lanes both run check, Rust fmt/clippy/tests, native
build and capability/native tests, compat/types/ledger/hdunit, WPT,
integration, benchmark sanity, documentation, release draft/checksums and
real tarball install smoke. Release requires this reusable CI workflow before
building platform artifacts on latest Bun. A failed correctness gate blocks
release; an unavailable optional FFI capability alone does not. Fix a latest
regression or retain Node-API fallback; do not silently pin latest to baseline.

On 2026-09-07, the official [stable release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
was `1.4.2` (published 2026-09-05). Local verification uses that actual version
and baseline `1.4.0`; this dated fact is not a CI pin. The action's
[input resolution](https://github.com/oven-sh/setup-bun/blob/v2/src/index.ts)
prioritizes `bun-version` over `bun-version-file` and package metadata.
We use separate setup steps so the two selections cannot be confused.

Rust remains `1.93.1` (`rust-toolchain.toml`). Release builds start from a
clean checkout with locked dependencies and the `release` profile; record
actual Bun version/revision rather than claiming latest is reproducible.
`panic = unwind` must remain enabled for native panic containment. Historical
ADR/benchmark Bun measurements remain historical evidence; this policy
supersedes their earlier requirement to use baseline for every CI/release run.

## Build

Local (single platform):

```sh
bun install --frozen-lockfile
bun scripts/build-platform-package.mjs            # host triple
bun scripts/build-platform-package.mjs --triple aarch64-apple-darwin
```

The script validates the triple against the matrix, runs
`cargo build --release -p mad-dom-bun --target <triple>`, and assembles
`build/platform/@mad-dom/platform-<os>-<arch>[-<libc>]/` containing only the
binary (`mad-dom.<os>-<arch>[-<libc>].node`), `package.json` (with
`os`/`cpu`/`libc`/`main`), `LICENSE` and a short `README.md` (ADR-0005 §5).
Cross triples require the target installed (`rustup target add <triple>` plus
a cross linker / musl toolchain); a missing target fails with the cargo error.
The resulting payload must also load on the packaging runner so its actual
Node-API ABI and FFI capabilities can be measured. A cross compiler alone is
not installation evidence; beta musl payloads need a matching libc runtime.

CI matrix: `.github/workflows/release.yml` builds each platform on a native
runner (musl via `taiki-e/setup-cross-toolchain-action`), runs the install
smoke on that same runner, and uploads the platform package. Alpha omits
`win32-x64` and the musl targets; beta/stable build the full 7-platform
matrix (ADR-0005 §2).

## Measured verification points

### glibc floor (glibc baseline)

ADR-0005 §2 makes the glibc floor a recorded, evidence-based value: the
compatibility floor is whatever the build host's glibc is. The floor must be
recorded here from the first linux-gnu CI run:

> **glibc floor (measured, first linux CI release builds, run 33728552831 /
> 33728981596, 2026-09-03):** the floor is **glibc 2.39** — both linux-gnu
> platform packages were built on Ubuntu 24.04 runners reporting
> `ldd (Ubuntu GLIBC 2.39-0ubuntu8.8) 2.39` (`ubuntu-latest` →
> `@mad-dom/platform-linux-x64-gnu`, `ubuntu-24.04-arm` →
> `@mad-dom/platform-linux-arm64-gnu`). Consumers on glibc older than 2.39 are
> not covered by an evidence-based claim until measured.

### Bun installer `libc` trimming

ADR-0005 §6 requires verifying how the Bun 1.4 installer trims
optional dependencies by `libc` on linux. The loader is insensitive to the
outcome — it tries the detected-libc variant first and the other once — so
both "single package installed" and "gnu+musl both installed" end up with the
right binary. Observed behavior is recorded here:

> **Bun 1.4 libc trimming (observed on macOS arm64):** the os/cpu fields are
> honored (a `darwin`/`arm64` package installs on this host; unrelated os/cpu
> optional packages are skipped). The linux-only `libc` field cannot be
> exercised from a macOS host. It still needs measuring: the alpha CI smokes
> install the host's platform tarball directly (nothing libc-paired is on the
> registry yet), so the gnu-vs-musl trim can only be observed once beta ships
> both variants — `bun add mad-dom@<beta>` on a linux runner must install the
> matching-libc package and skip the other. Either way the loader stays
> correct (detected-libc-first dual-variant fallback); if Bun (or older npm)
> installs both gnu and musl packages, installation size grows but loading
> stays correct.

## Checksums and provenance

- The release step generates `SHASUMS256.txt` (sha256 over every platform
  package tarball and the main tarball) and verifies it recomputes before any
  publish (ADR-0005 §7):

  ```sh
  bun scripts/checksums.mjs generate build/release/tgz --out build/release/SHASUMS256.txt
  bun scripts/checksums.mjs verify   build/release/tgz --manifest build/release/SHASUMS256.txt
  ```

- The main package and every platform package are published with
  `npm publish --provenance` (GitHub Actions OIDC), making the tarball→commit
  build provenance verifiable.

## Install smoke (no Cargo environment)

`bun run smoke:install` installs real main + host tarballs with
`bun install --frozen-lockfile --ignore-scripts --no-optional` in fresh
projects. The host tarball is a direct local dependency; registry optional
packages and inherited `MAD_DOM_*`/native path overrides cannot mask a missing
binary or select a source artifact. No Cargo build is invoked when both
paths are supplied:

```sh
bun run dev:build
bun run platform:build --artifact build/mad-dom.node --out build/release/platform
bun run release:draft --no-build
bun run smoke:install --main-tgz build/release/tgz/mad-dom-0.0.1-alpha.3.tgz --platform-tgz build/release/tgz/mad-dom-platform-linux-x64-gnu-0.0.1-alpha.3.tgz
```

Adjust version and host platform in both tarball names to match the draft.
`--artifact` is for local rehearsal of an already-built payload; hosted release
builds compile from source. Smoke checks real DOM queries, wrapper identity,
serialization and destroy under automatic capability selection, explicit FFI
disabled, and missing FFI. When FFI is available, it also injects a mismatched
FFI ABI and partial symbols. Required binary absence/unsupported platform and
Node-API ABI mismatch produce distinct hard errors. Metadata tampering must
fail before artifacts are reused. `--expect-ffi available` is an optional
strict local assertion; automatic CI records capability loss and verifies
fallback instead of making experimental FFI mandatory.

Each smoke writes `runtime-results.json`, including version, platform/libc,
both ABI results and capability statuses. CI uploads these and the full
`report:runtime` matrix even after a failed gate.

## Artifact metadata and optional FFI

Main and platform `madDomRuntime` contain the same package version, Node-API
object ABI, independent FFI ABI, supported capability bitset and
`ffiRequired: false`. The platform's `madDomBuild` records the actual Bun
version/revision, platform/libc, Node-API probe, FFI status/bitset, capability
level (`ffi`, `ffi-partial`, or `node-api-only`) and binary SHA-256.
`madDomFfi`, when present, equals `main`; the package contains one native image.

Build probes run in an isolated process against that payload. Missing FFI or
an FFI ABI mismatch does not prevent a verified Node-API package or draft.
`MAD_DOM_FFI_DISABLED=1 bun run platform:build ...` also rehearses a build
with only Node-API verified. It omits `madDomFfi` and records the disabled
observation. This is not a runtime prohibition: if the same image contains
compatible symbols and Bun later provides FFI, the loader can enable them.
Use `MAD_DOM_FFI_DISABLED=1` in the application to keep it disabled.

Capability values must be integers within the u32 range before known bits
are checked; JavaScript bitwise truncation must not accept larger numbers.

Release `--no-build` validates metadata and the recorded binary checksum;
stale package versions or additional native images fail. The staged main
version and all optional dependency pins follow `--version`, including the
workflow input. `runtime-metadata.json` records per-platform observations and
whether the full stage matrix was present. Draft permits a host-only rehearsal;
real publish refuses an incomplete stage before publishing any package.

An `api-present-unverified` deallocator report establishes only API presence.
It does not certify memory ownership safety; default buffers stay caller-owned.
See [loader diagnostics](/platforms#bun-capability-diagnostics) for capability
failure, disabled FFI, independent ABI mismatches, and missing platform binary.

## Publish

Order is hard-coded (ADR-0005 §10): every platform package first, a registry
integrity check over all of them, then the main package last. The main
package's `optionalDependencies` pin every platform package to the exact same
version, so a missing platform package surfaces as
`MAD_DOM_UNSUPPORTED_PLATFORM` at load time instead of a broken install.

```sh
bun scripts/release.mjs draft --stage alpha     # rehearsal: pack + checksums + plan
bun scripts/release.mjs draft --stage beta
bun scripts/release.mjs draft --stage stable
```

`draft` never touches the registry. Real publishing requires both
`--no-dry-run` and `MAD_DOM_ALLOW_PUBLISH=1` and is performed by the release
workflow (never from a development task):

```sh
bun scripts/release.mjs publish --stage beta --no-dry-run
```

dist-tags (ADR-0005 §10): alpha/beta pre-releases publish to `next`; stable
publishes to `latest` (the final `latest` migration is owned by the stable
gate, T50). `publishConfig.tag` in the staged main package reflects the stage.

## Rollback

npm versions are immutable, so a rollback re-points the dist-tag to the last
healthy version of **every** package in the release together (main + all
platform packages — no partial rollback, which would fabricate mixed-version
installs under exact-pin optionalDependencies). `unpublish` is only for
malicious-code emergencies and follows npm policy.

```sh
bun scripts/release-rollback.mjs --tag next --version 0.0.1-alpha.1 --last-healthy 0.0.1-alpha.0 --stage beta
```

dry-run by default; execution requires `--no-dry-run` + `MAD_DOM_ALLOW_PUBLISH=1`.

## Known limitations (this host)

- Cross-platform binaries cannot be produced on a single machine: the local
  dry-run builds only the host triple (`aarch64-apple-darwin` on the
  development machine). The remaining platforms are built and install-smoked
  by the CI matrix on native runners; the rehearsal skips them with a notice.
- The glibc floor is measured (2.39, first linux CI release build, 2026-09-03);
  the Bun `libc`-trimming observation is deferred to beta, when both gnu and
  musl variants are on the registry at once (see the measured verification
  points section).
- The stable gate (T50) verifies the happy-dom compatibility suite at 100%
  pass and the host install smoke on the development machine; non-host
  platform verification is delegated to the `release.yml` matrix and is the
  reason T50 is recorded as partial until those CI runs complete. See
  [docs/stable-gate-report.md](./stable-gate-report.md).

## Historical compatibility rate (T50)

At the T50 checkpoint, the locked happy-dom baseline (`20.11.11` @
`64e2c774…`, ADR-0002 §1) had **43/43 passing ledger entries**, with zero
known-gap / not-applicable entries. Its independent WPT measurement was
39.8%. These are historical figures; current recorded coverage and known
behavior gaps are described in
[docs/compat-report.md](./compat-report.md).
