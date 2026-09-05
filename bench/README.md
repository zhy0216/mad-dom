# Performance and memory regression gate

This directory holds mad-dom's internal performance/memory baseline. For the
mad-dom vs happy-dom comparison, workloads and recorded results, see
[benchmark/README.md](../benchmark/README.md).

Core-side workloads run in Rust
(`crates/mad-dom-core/examples/bench.rs`), and the JS↔Rust boundary (FFI call
cost, wrapper identity, GC release, memory curve) runs in Bun
(`scripts/bench-ffi-gc.mjs`). `scripts/bench.mjs` merges both and compares
against `baseline.json`.

## Metrics

| Metric | Meaning | Direction |
| --- | --- | --- |
| `arena_alloc_ops_s` | arena slot allocation throughput | higher |
| `arena_remove_ops_s` | arena slot removal throughput | higher |
| `arena_reuse_ops_s` | alloc → remove half → realloc churn | higher |
| `arena_capacity_retention_ratio` | arena capacity after remove-half vs peak | lower (≈1) |
| `mutation_append_ops_s` | `append_child` throughput | higher |
| `mutation_remove_ops_s` | `remove_child` throughput | higher |
| `mutation_attr_ops_s` | `set_attribute` throughput | higher |
| `parser_ops_s` / `parser_bytes_s` | HTML parse throughput (docs and bytes) | higher |
| `serializer_ops_s` / `serializer_bytes_s` | serialization throughput | higher |
| `selector_cold_ops_s` | class query without the query index | higher |
| `selector_hot_ops_s` | id lookup served from the query index | higher |
| `selector_matches_ops_s` | `matches` throughput | higher |
| `ffi_create_element_ops_s` | one JS→Rust `createElement` round trip | higher |
| `ffi_batch_append_ops_s` | raw binding create/append batch score (see below) | higher |
| `wrapper_identity_hit_rate` | same native node → same JS object (must be 1) | higher (1.0) |
| `gc_release_hit_rate` | explicit `destroy()` returns `liveDocumentCount` to baseline (must be 1) | higher (1.0) |
| `gc_memory_growth_mb` | RSS growth after a bounded create/destroy churn | lower |

The Core bench also reports `node_bytes_per_node` (per-node payload size, a
memory baseline) and `bench_doc_nodes` (document size the workloads run
against).

The FFI bench uses the raw `createDocument()` API. Its legacy
`ffi_batch_append_ops_s` score is `20 / elapsedSeconds` for one loop creating
and appending 10,000 elements; it is useful for same-workload regression
comparisons, but is not a count of nodes appended per second. Neither raw
binding metric measures the public `Window` workflows in `bench:dom`.

## Running

```sh
bun install --frozen-lockfile
bun run dev:build                    # build the native artifact
bun scripts/bench.mjs --json         # collect metrics without changing a baseline
bun run bench:check                  # compare against the applicable baseline
bun run bench:record                 # intentionally replace bench/baseline.json
```

Run these commands from the repository root with Bun `1.4.0` and Rust
`1.93.1`. To force a source build when a platform package is also installed,
prefix the measurement command with
`MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"`.

`bun run bench:check` exits `0` on pass or initial baseline creation, and `1`
when a metric regresses. Build, loading and subprocess failures also stop the
command; they are not performance measurements. `bun run bench:record`
overwrites the committed reference, so review its diff before accepting it.

The current `bench:run` script passes `--report`, but the driver does not
branch on that flag: it follows the same comparison/baseline-creation path as
`bench:check`. Use `bun scripts/bench.mjs --json` for collection without a gate
or baseline write.

## Thresholds

`scripts/bench.mjs` declares per-metric bounds: higher-is-better metrics fail
when they fall below `0.5×` the baseline, lower-is-better metrics fail above
their bound (`1.1×` for arena capacity retention, `2×` for RSS growth). The
correctness metrics (`wrapper_identity_hit_rate`, `gc_release_hit_rate`)
must not fall below the reference value of `1.0`. Bounds are intentionally
generous — the gate catches **obvious** regressions (plan §6: "不以单次绝对
速度作为合并门禁，先防止明显退化"), not single-run timing jitter. Baselines
record `os`/`arch`/`bun`/`rust`, but automatic selection currently compares
**OS and architecture only**, without checking CPU model or toolchain
versions. Use comparable hardware, versions and load when judging changes.

## Baseline selection and CI

1. If `bench/baseline.json` matches the current OS/architecture, compare
   against it.
2. Otherwise, use `bench/baseline.<os>-<arch>.json` if it exists and matches.
3. Otherwise, write that host-specific file and exit successfully. These
   local files are ignored by Git.

The CI `bench` job runs `bun run bench:check`. It does not cache the local
baseline files. A fresh runner whose platform differs from the committed
reference therefore establishes a baseline on that run; its green status
does not demonstrate a comparison against a previous run. A matching
reference must be available for the regression thresholds to apply.

## Reproducibility

- The Core bench uses fixed workload sizes (arena 200k slots, mutation 50k
  ops, parse/serialize 4k runs, selectors over 40 sections of 500 rows).
- The FFI/GC bench uses the same fixed churn counts (200k element calls, 50
  documents for release, 200-document churn for the memory curve).
- `bench/baseline.json` is committed. Install the locked dependencies, build
  the native binding, and run `bun run bench:check` on comparable hardware.
  The initial Rust build may download crates from `Cargo.lock`.
- The comparison snapshots in `benchmark/results/` contain DOM benchmark
  samples; the gate does not read or update them.
