# Performance

The same test suite, the same runner, only the import swapped.

## mad-dom vs happy-dom

| | mad-dom | happy-dom 20.11.11 |
| --- | --- | --- |
| Deterministic DOM suite | **128 ms** | **206 ms** |

**1.6× faster.** Median of 3 runs, macOS arm64, Bun 1.4.0, under `bun test`.

The suite is happy-dom's own integration-test suite, vendored verbatim — the
only change is the import specifier (`happy-dom` → `mad-dom`). Details in the
[benchmark README](https://github.com/zhy0216/mad-dom/blob/main/benchmark/README.md).

Reproduce it yourself:

```sh
bun benchmark/run.mjs
```

## Why it's fast

The DOM doesn't live in JS objects. Nodes are stored in a Rust memory arena,
HTML is parsed natively, and selector matching runs natively — JS reaches all
of it through a thin Node-API binding. Bulk work is where that pays: parsing,
serializing (`innerHTML`) and selector queries are single native operations
and run 1.8–4.5× ahead of happy-dom in the per-phase dom benchmark
(`bun benchmark/dom-bench/run.mjs`).

The trade-off used to be the other direction: every individual node property
read crosses the binding, and each node gets a lazily-minted JS wrapper. Since
the navigation-memo work, a raw `firstChild`/`nextSibling` tree walk is no
longer the losing shape either — reads over an unchanged tree are served from
an epoch-guarded JS-side memo (invalidated by any structural mutation), and
the mint cost dropped with classification stamped at creation (~0.4 ms for an
18k-node walk, several times ahead of happy-dom). Bulk operations remain the
sweet spot: parsing, serializing (`innerHTML`) and selector queries are single
native operations and run 2–5× ahead of happy-dom in the per-phase dom
benchmark.

## Regression gate

Performance and memory are guarded inside the repo: every change is checked
against a recorded baseline (`bench/baseline.json`) via `bun run bench:check`,
so regressions don't slip in.
