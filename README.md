# MAD DOM

> Not happy. Just native.

MAD DOM is an early-stage native, memory-arena DOM implementation designed specifically for Bun.

## Status

The project is in alpha. The native DOM implementation is available and
verified against a locked happy-dom baseline (see Compatibility below);
surfaces beyond that contract are still incomplete.

The architecture:

- a Rust-native HTML parser and retained DOM tree;
- generational node handles backed by a memory arena;
- native selector matching and serialization;
- direct integration with Bun and JavaScriptCore;
- compatibility with DOM-oriented Bun tests.

Do not use this release in production.

## Compatibility (T50)

MAD DOM tracks a **locked** happy-dom baseline (`20.11.11` @ commit
`64e2c774…`, [ADR-0002](adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)).
The black-box differential suite and type harness are the compatibility
contract, and the ledger currently reports **100% pass** (43/43 entries, zero
known-gap / not-applicable) on the stable-gate verification:

```sh
bun run compat:differential     # live black-box differential over every scenario
bun run compat:ledger           # schema + cross-check + pass-regression gate
```

A separate [web-platform-tests](https://github.com/web-platform-tests/wpt)
subset is vendored as an independent statistics track (currently ~40% pass) —
it is a measurement, not a gate. Full numbers and upstream attribution live in
[docs/compat-report.md](docs/compat-report.md).

## Known limitations

- Cross-platform binaries cannot be built on a single machine: the local
  build covers only the host triple, and the remaining platforms are built and
  install-smoked by the `release.yml` CI matrix on native runners.
- The glibc compatibility floor and Bun installer `libc`-trimming behavior are
  recorded only after the first linux CI release build (`docs/release.md`).
- Pre-alpha: many happy-dom behaviors beyond the differential suite (notably
  the broader WPT surface) are not yet implemented; the compatibility contract
  above is what is claimed and verified.

See `docs/release.md` (build/publish/rollback manual), `docs/stable-gate-report.md`
(stable-gate verification) and the [safety](./crates/mad-dom-core/SAFETY.md) /
[benchmark](./bench/README.md) notes for hardening detail.

## Public entry

The package entry exposes the happy-dom-shaped construction surface: create a
window with `new Window()` (or `new Window(options)` to honor the initial
`url`, viewport and inner-dimension options), then reach the document through
`window.document`:

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://example.test/" });
const { document } = window;
// ... drive the DOM ...
window.destroy();
```

Since T48E the `createWindow` convenience is retired from the package entry to
match happy-dom (`typeof entry.createWindow === "undefined"`); the facade
layer keeps it only as an internal compatibility alias.

## Support matrix

The native binding ships as a per-platform npm package (`@mad-dom/platform-*`,
ADR-0005). The main package loads its binary at runtime through the
`@mad-dom/platform-<os>-<arch>[-<libc>]` optional dependency that matches the
installing machine (linux tries the detected libc variant first, then the
other once). `win32` needs no libc suffix; `linux` always carries an explicit
`gnu`/`musl` suffix.

| Platform package | Target triple | libc | Phase |
| --- | --- | --- | --- |
| `@mad-dom/platform-darwin-arm64` | `aarch64-apple-darwin` | — | first (alpha+) |
| `@mad-dom/platform-darwin-x64` | `x86_64-apple-darwin` | — | first (alpha+) |
| `@mad-dom/platform-linux-x64-gnu` | `x86_64-unknown-linux-gnu` | glibc | first (alpha+) |
| `@mad-dom/platform-linux-arm64-gnu` | `aarch64-unknown-linux-gnu` | glibc | first (alpha+) |
| `@mad-dom/platform-win32-x64` | `x86_64-pc-windows-msvc` | — | first (beta+) |
| `@mad-dom/platform-linux-x64-musl` | `x86_64-unknown-linux-musl` | musl | second (beta+) |
| `@mad-dom/platform-linux-arm64-musl` | `aarch64-unknown-linux-musl` | musl | second (beta+) |

Alpha releases may omit `win32-x64`; beta and stable ship the full matrix.
Platforms outside this matrix (e.g. 32-bit `arm`, FreeBSD) are not supported.

Load failures are never silent: the first native-backed call throws an `Error`
with a stable `code` — `MAD_DOM_UNSUPPORTED_PLATFORM` (platform outside the
matrix, platform package missing, or its binary failed to load),
`MAD_DOM_ABI_MISMATCH` (mixed-version install), or `MAD_DOM_NATIVE_NOT_FOUND`
(source checkout without a built dev artifact). The message always names the
current platform/arch, every package it tried, and this section. See
`docs/release.md` for build, publish and rollback details.

## Development

Development uses Bun `1.4.0` (recorded in `.bun-version`) and Rust `1.93.1` (pinned in `rust-toolchain.toml`).

### Native binding (T19+)

The DOM Core runs in Rust; JavaScript reaches it through the Node-API binding
in `crates/mad-dom-bun`. To build the local development artifact:

```sh
bun run dev:build
```

This compiles the binding for your local triple and writes the git-ignored
artifact to `build/mad-dom.node`. The package entry (`index.js`) loads it on
first use (or the artifact pointed to by `MAD_DOM_NATIVE_PATH`); without a
built artifact the native-backed entry points fail fast with a
`MAD_DOM_NATIVE_NOT_FOUND` error. The native smoke tests run once the artifact
exists:

```sh
bun run test:native
```

The repository-level validation gate is:

```sh
bun run validate
```

It runs, in order: the JavaScript entry check, `cargo fmt --check`, Clippy,
`cargo test --workspace`, the type harness (`compat:types`), the Bun test
suite (`tests/bun`, `tests/compat`, `tests/wpt`), the ledger gate
(`compat:ledger`), the hdunit rewrite + triage validation, and the WPT subset.

### Safety and performance gates (T50+)

The stable-gate hardening adds two dedicated suites alongside `bun run validate`:

```sh
scripts/check-core-safety.sh scan   # unsafe/FFI inventory (Core must stay zero)
scripts/check-core-safety.sh miri   # Miri representative subset (nightly)
scripts/check-core-safety.sh asan   # AddressSanitizer smoke (nightly host target)

bun run bench:record                # run benchmarks, write bench/baseline.json
bun run bench:check                 # performance/memory regression gate (CI)
```

The Core carries `#![forbid(unsafe_code)]`; all handwritten `unsafe` lives in
the binding as four documented `cast()` relaxations (see
[crates/mad-dom-core/SAFETY.md](crates/mad-dom-core/SAFETY.md)). Benchmark
metrics, thresholds and reproducibility are documented in
[bench/README.md](bench/README.md).

Individual commands:

- `bun --check index.js` — JavaScript entry syntax check;
- `cargo fmt --check` — Rust formatting check;
- `cargo clippy --workspace --all-targets -- -D warnings` — Rust lint;
- `cargo test --workspace` — Rust tests;
- `bun run test` — Bun tests over `tests/bun`, `tests/compat` and `tests/wpt` (native smoke tests skip when the dev artifact is absent);
- `bun run dev:build` — build the local native artifact (`build/mad-dom.node`);
- `bun run test:native` — native binding smoke tests;
- `npm pack --dry-run` — package smoke test.

### Native packaging and release (T49+)

The published form splits the binary into per-platform npm packages
(`@mad-dom/platform-*`, see the support matrix above). The runtime loader in
`js/native-loader.js` resolves, in order: `MAD_DOM_NATIVE_PATH` → the matching
platform package (linux: detected-libc variant, then the other once) → the
repository-local dev artifact. It runs an ABI probe after every successful
load. Local commands:

```sh
bun run platform:build     # build the host platform package (build/platform/)
bun run smoke:install      # no-Cargo install smoke against the packed tarballs
bun run release:draft -- --stage alpha    # rehearsal: pack + checksums + ordered publish plan
bun run release:draft -- --stage beta
bun run release:draft -- --stage stable
bun run release:rollback -- --tag next --last-healthy <v>
```

The release workflow (`.github/workflows/release.yml`) builds the platform
matrix on native runners, runs the install smoke per platform, verifies the
sha256 checksum manifest, and only publishes when explicitly authorized
(platform packages first, registry verification, main package last). See
`docs/release.md` for the full manual, the measured glibc floor, Bun installer
`libc`-trimming notes, dist-tag policy and rollback procedures.

### WPT subset (T48+)

`tests/wpt/` vendors a small, commit-pinned subset of the
[web-platform-tests](https://github.com/web-platform-tests/wpt) DOM suite as a
**separate statistics track** (ADR-0002 section 8): the pass rate is reported
independently and never changes the happy-dom compatibility contract
(`compat/ledger.json` + the differential runner own the happy-dom conclusions).
The subset is a measurement, not a gate:

```sh
bun run wpt:test    # run the subset and print the pass-rate report
bun run wpt:json    # machine-readable report (mad-dom-wpt-report/1)
```

See `tests/wpt/README.md` for the manifest and how to update the subset.
