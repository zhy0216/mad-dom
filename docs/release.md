# MAD DOM release manual (T49, stable gate T50)

This document is the build / publish / rollback manual for the native
platform packages (`@mad-dom/platform-*`) and the `mad-dom` main package, per
[ADR-0005](../adr/0005-native-build-and-release-architecture.md). The support
matrix and the runtime error contract live in the [README](../README.md#support-matrix)
("Support matrix" section, which the loader error messages anchor to). The
stable-gate verification evidence (compat rate, safety suite, benchmarks,
install smoke) is in [docs/stable-gate-report.md](./stable-gate-report.md).

## Toolchain pins

- Rust: `1.93.1` ([rust-toolchain.toml](../rust-toolchain.toml)); Bun:
  `1.4.0` (`.bun-version`).
- Every release build starts from a clean checkout with these pins and the
  `release` profile (ADR-0005 §1, §3). Never reuse a local `target/` artifact
  for a release build.
- The binding is a Node-API cdylib; `panic = unwind` must never be switched to
  `panic = abort` for any target (ADR-0005 §1, §3; it is the `catch_unwind`
  boundary).

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

> **glibc floor (measured, first linux CI release build, run 33728552831,
> 2026-09-03):** the floor is **glibc 2.39** — `ubuntu-latest`
> (`Ubuntu GLIBC 2.39-0ubuntu8.8`) built `@mad-dom/platform-linux-x64-gnu`;
> the `ubuntu-24.04-arm` runner behind `@mad-dom/platform-linux-arm64-gnu` is
> the same Ubuntu 24.04 image (floor recorded from its own logs by the same
> workflow step). Consumers on glibc older than 2.39 are not covered by an
> evidence-based claim until measured.

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

`bun scripts/install-smoke.mjs` installs the packed main + host platform
tarballs into a clean temp project with `bun add` (no Rust toolchain anywhere
in the flow) and asserts:

1. supported platform: `new Window()` + fixed HTML parse + one selector query
   succeed;
2. missing platform package: `MAD_DOM_UNSUPPORTED_PLATFORM` with
   "Reinstall without --no-optional" and the support-matrix anchor;
3. unsupported platform (`MAD_DOM_TEST_PLATFORM=freebsd`): the same code with
   "not in the supported matrix";
4. ABI mismatch (`MAD_DOM_NATIVE_PATH` → fake module): `MAD_DOM_ABI_MISMATCH`
   naming both ABI versions.

This script is the install-side gate for every released platform and is reused
by the stable gate (T50). It is run per platform on its native runner in the
release workflow and on the host in CI.

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

## Compatibility rate (T50)

The locked happy-dom baseline (`20.11.11` @ `64e2c774…`, ADR-0002 §1) is at
**100% pass** in the compatibility ledger (43/43 entries, zero known-gap /
not-applicable) and the WPT subset is tracked separately as a measurement
(39.8%). Full per-suite numbers and upstream attribution:
[docs/compat-report.md](./compat-report.md).
