# MAD DOM

> Not happy. Just native.

**A native DOM for Bun, written in Rust. A drop-in replacement for happy-dom —
one import is the whole migration, and your DOM tests get faster.**

```sh
bun add -d mad-dom
```

## One import is the whole migration

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

That's it. Same API shape — `Window`, `Browser`, `GlobalWindow`,
`window.document`, the lot — running directly under `bun test`.

We didn't just claim it: we vendored **happy-dom's own integration-test
suite** verbatim and changed nothing but the import specifier. Same tests,
same assertions, new engine.

## And it's faster

The same suite, run both ways under `bun test` (median of 3 runs,
macOS arm64, Bun 1.4.0), on the deterministic DOM workload:

| | Median | Result |
| --- | --- | --- |
| **mad-dom** | **128 ms** | **1.6× faster** |
| happy-dom 20.11.11 | 206 ms | baseline |

Reproduce it yourself:

```sh
bun benchmark/run.mjs
```

## Why it's fast

The DOM doesn't live in JavaScript objects. It lives in a Rust memory arena:
a native HTML parser, native selector matching and serialization, reached from
JavaScriptCore through a thin Node-API binding. Less GC churn, more DOM per
millisecond.

## Compatibility

MAD DOM tracks the happy-dom API against a **locked happy-dom baseline** and
verifies it with a black-box differential suite — currently **100% pass** on
the compatibility contract. Full numbers: [docs/compat-report.md](docs/compat-report.md).

## Platforms

Per-platform binaries ship as optional npm packages (`@mad-dom/platform-*`) —
nothing to compile, `bun add` just works.

- **Available now (alpha):** macOS arm64 / x64, Linux x64 / arm64 (glibc)
- **Coming in beta:** Windows x64, Linux musl

## Status

Alpha. The native DOM is real, verified, and worth trying in your test suite —
but don't run production on it yet.

## Digging deeper

- [Benchmark methodology](benchmark/README.md) — how mad-dom vs happy-dom is measured
- [Performance & memory gate](bench/README.md) — regression-gated internal metrics
- [Compatibility report](docs/compat-report.md) · [Release manual](docs/release.md)
- [Safety notes](crates/mad-dom-core/SAFETY.md) — the core is `#![forbid(unsafe_code)]`

Development: Bun `1.4.0` + Rust `1.93.1`; `bun run validate` runs the full gate.

## License

MIT
