# MAD DOM

> Not happy. Just native.

**A fast native DOM for Bun, written in Rust, with a happy-dom-style API.**

**2.83× faster core DOM work · 1.57× faster test workflows** in the recorded
2026-09-05 source-build comparison with happy-dom 20.11.11. See the benchmark
conditions and full results below.

[Documentation](https://zhy0216.github.io/mad-dom/) ·
[Examples](docs/examples.md) · [Performance](docs/performance.md)

```sh
bun add -d mad-dom@next
```

## Start with one import

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Use familiar APIs — `Window`, `Browser`, `GlobalWindow`, `window.document` —
under `bun test`. Run your own suite after changing the import; compatibility
is measured against a defined contract and the package is still alpha.

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://app.example/" });
try {
  window.document.body.innerHTML = "<button>Save</button>";
  const button = window.document.querySelector("button");
  button.addEventListener("click", () => { button.textContent = "Saved"; });
  button.click();
  console.log(button.textContent); // Saved
} finally {
  window.destroy();
}
```

`destroy()` explicitly releases the native document. For async tests, finish
requests and clear timers before teardown; see [cleanup](docs/async.md#cleanup).

## What you can do

- Parse and serialize HTML, query selectors, traverse live collections, and mutate trees.
- Test events, form values and validation, template clones, and DOM snapshots.
- Work with custom elements, shadow roots, slots, and MutationObserver.
- Use Window timers, Fetch, URL/history/storage APIs, and virtual console output.
- Load server-rendered HTML through Browser pages and inspect their documents.

MAD DOM provides DOM behavior without visual layout or painting. Guides:
[Getting started](docs/quick-start.md) · [Bun & Testing Library](docs/testing.md) ·
[DOM](docs/dom.md) · [Window](docs/window.md) · [Browser](docs/browser.md) ·
[Migration](docs/migration.md) · [Configuration](docs/configuration.md).

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

Those dated aggregates used the earlier partial close implementation. After
lifecycle repairs, the 25-Window workload measured 29.842 ms for mad-dom versus
34.385 ms for happy-dom (1.15×). See the updated
[performance notes](docs/performance.md) for the separate measurement.

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

## Support matrix

Per-platform binaries ship as optional npm packages (`@mad-dom/platform-*`) —
no Rust compiler is needed when a matching binary is available. Requires
Bun >= 1.4.0; the measured Linux glibc floor is 2.39.

- **Available now (alpha):** macOS arm64 / x64, Linux x64 / arm64 (glibc)
- **Coming in beta:** Windows x64, Linux musl

[Platform packages, source builds, and loader troubleshooting](docs/platforms.md).

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
