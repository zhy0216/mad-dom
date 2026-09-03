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
of it through a thin Node-API binding. No per-node JS wrapper tax on the hot
path.

## Regression gate

Performance and memory are guarded inside the repo: every change is checked
against a recorded baseline (`bench/baseline.json`) via `bun run bench:check`,
so regressions don't slip in.
