# MAD DOM

> Not happy. Just native.

**A native DOM for Bun, written in Rust, with a happy-dom-compatible API.**

[Documentation](https://zhy0216.github.io/mad-dom/) ·
[Examples](docs/examples.md) · [Performance](docs/performance.md)

```sh
bun add -d mad-dom
```

## Start with one import

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Use familiar APIs — `Window`, `Browser`, `GlobalWindow`, `window.document` —
under `bun test`. Run your own suite after changing the import; compatibility
is measured against a defined contract and the package is still alpha.

The repository includes two copies of happy-dom's integration tests with
matching assertions and an engine import swap. The shared Bun runner and
test adaptations are documented in [benchmark/README.md](benchmark/README.md).

## Benchmarks

The DOM benchmark runs **16 core operations** and **13 test workflows** against
both engines, including real DOM Testing Library queries and events. In the
**2026-09-05 source-build run**, all workloads passed and their results matched:

| Timed workload | mad-dom | happy-dom 20.11.11 | Speedup |
| --- | ---: | ---: | ---: |
| Core operations (16 phases) | **141.70 ms** | 401.60 ms | **2.83×** |
| Test workflows (13 scenarios) | **91.10 ms** | 143.08 ms | **1.57×** |

Apple M3 Max, 48 GiB RAM, macOS arm64, Bun 1.4.0, Rust 1.93.1; size 1×,
2 warmup rounds and 9 measured rounds per engine. Each aggregate is the
**median of per-round sums** of timed phases; speedup is happy-dom / mad-dom.
Forced GC, validation and untimed setup are excluded. This measures DOM work,
including scenario mounting and cleanup, rather than complete test-runner or
React/Vue application performance.

Performance varies by workload: mad-dom had lower medians in 15/16 core phases
and 8/13 workflows in this run. The read-heavy core phase and workflows for
shared-window fixture lifecycle, Testing Library events/labels, keyed updates
and async observers were slower. See the [full phase tables and measurement
limits](docs/performance.md), [methodology](benchmark/README.md) and
[raw samples](benchmark/results/2026-09-05-dom.json).

Reproduce from a source checkout:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1
```

Use `--suite core` or `--suite testing` to select a group, and `--json` to retain
samples, result checks and RSS readings. The separate `bench:integration`
command measures integration-suite wall time; `bench:check` compares mad-dom's
internal metrics with a baseline. These measure different things.

## How it works

The DOM tree lives in a Rust memory arena, with native HTML parsing, selector
matching and serialization. A JavaScript facade exposes the API through a
Node-API binding. Lazy node wrappers and mutation-aware caches reduce repeat
boundary calls; wrappers and caches also contribute to process memory use.

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

- [Benchmark methodology](benchmark/README.md) — workloads, statistics and reproduction
- [Performance & memory gate](bench/README.md) — regression-gated internal metrics
- [Compatibility report](docs/compat-report.md) · [Release manual](docs/release.md)
- [Safety notes](crates/mad-dom-core/SAFETY.md) — the core is `#![forbid(unsafe_code)]`

Development: Bun `1.4.0` + Rust `1.93.1`; `bun run validate` runs the full gate.

## License

MIT
