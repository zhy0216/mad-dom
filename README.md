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
- `bun test tests/bun` — Bun tests;
- `npm pack --dry-run` — package smoke test.
