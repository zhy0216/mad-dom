# Quick start

A native DOM for Bun, written in Rust. Not happy. Just native.

## Install

```sh
bun add -d mad-dom
```

Platform binaries ship as optional npm packages (`@mad-dom/platform-*`), so
`bun add` just works — nothing to compile.

## One import is the whole migration

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Same API shape — `Window`, `Browser`, `GlobalWindow`, `window.document`, the
lot.

## Run your tests

```sh
bun test
```

We vendored happy-dom's own integration-test suite verbatim and changed
nothing but the import specifier — same tests, same assertions, new engine. On
the deterministic DOM workload the same suite runs **1.6× faster** under
`bun test` (128 ms vs 206 ms, median of 3 runs, macOS arm64, Bun 1.4.0).

Reproduce it yourself:

```sh
bun benchmark/run.mjs
```

## Status

Alpha. The native DOM is real, verified, and worth trying in your test suite —
but don't run production on it yet.
