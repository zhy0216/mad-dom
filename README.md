# MAD DOM

> Not happy. Just native.

MAD DOM is an early-stage native, memory-arena DOM implementation designed specifically for Bun.

## Status

The project is currently pre-alpha. This initial release establishes the package and public API direction; the DOM implementation is not available yet.

The intended architecture includes:

- a Rust-native HTML parser and retained DOM tree;
- generational node handles backed by a memory arena;
- native selector matching and serialization;
- direct integration with Bun and JavaScriptCore;
- compatibility with DOM-oriented Bun tests.

Do not use this release in production.

## Development

Development uses Bun `1.4.0` (recorded in `.bun-version`) and Rust `1.93.1` (pinned in `rust-toolchain.toml`).

### Native binding (T19+)

The DOM Core runs in Rust; JavaScript reaches it through the Node-API binding
in `crates/mad-dom-bun`. To build the local development artifact:

```sh
npm run dev:build
```

This compiles the binding for your local triple and writes the git-ignored
artifact to `build/mad-dom.node`. The package entry (`index.js`) loads it on
first use (or the artifact pointed to by `MAD_DOM_NATIVE_PATH`); without a
built artifact the native-backed entry points fail fast with a
`MAD_DOM_NATIVE_NOT_FOUND` error. The native smoke tests run once the artifact
exists:

```sh
npm run test:native
```

The repository-level validation gate is:

```sh
npm run validate
```

It runs, in order: the JavaScript entry check, `cargo fmt --check`, Clippy, `cargo test --workspace`, and the Bun tests.

Individual commands:

- `bun --check index.js` — JavaScript entry syntax check;
- `cargo fmt --check` — Rust formatting check;
- `cargo clippy --workspace --all-targets -- -D warnings` — Rust lint;
- `cargo test --workspace` — Rust tests;
- `bun test tests/bun` — Bun tests (native smoke tests skip when the dev artifact is absent);
- `npm run dev:build` — build the local native artifact (`build/mad-dom.node`);
- `npm run test:native` — native binding smoke tests;
- `npm pack --dry-run` — package smoke test.

### WPT subset (T48+)

`tests/wpt/` vendors a small, commit-pinned subset of the
[web-platform-tests](https://github.com/web-platform-tests/wpt) DOM suite as a
**separate statistics track** (ADR-0002 section 8): the pass rate is reported
independently and never changes the happy-dom compatibility contract
(`compat/ledger.json` + the differential runner own the happy-dom conclusions).
The subset is a measurement, not a gate:

```sh
npm run wpt:test    # run the subset and print the pass-rate report
npm run wpt:json    # machine-readable report (mad-dom-wpt-report/1)
```

See `tests/wpt/README.md` for the manifest and how to update the subset.
