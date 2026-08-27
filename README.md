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
