# MAD DOM benchmark & stable performance gate (T50)

This directory holds the reproducible performance/memory baseline for the
stable gate (T50) and the driver that gates against it. The measurement split
mirrors the plan (ADR-0001 plan §6): Core-side workloads run in Rust
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
| `ffi_batch_append_ops_s` | facade `appendChild` batch throughput | higher |
| `wrapper_identity_hit_rate` | same native node → same JS object (must be 1) | higher (1.0) |
| `gc_release_hit_rate` | explicit `destroy()` returns `liveDocumentCount` to baseline (must be 1) | higher (1.0) |
| `gc_memory_growth_mb` | RSS growth after a bounded create/destroy churn | lower |

The Core bench also reports `node_bytes_per_node` (per-node payload size, a
memory baseline) and `bench_doc_nodes` (document size the workloads run
against).

## Running

```sh
npm run dev:build          # native artifact required by the FFI/GC bench
npm run bench:record       # run everything, write bench/baseline.json
npm run bench:check        # run everything, gate against the baseline (CI gate)
npm run bench:run          # run everything, print the merged report (no gate)
```

`npm run bench:check` is the stable-gate regression command. It exits `0` on
pass, `1` when a metric regresses beyond its threshold, and `2` on
infrastructure errors. When no baseline exists it records one and passes (the
first run on a fresh checkout establishes the baseline rather than failing).

## Thresholds

`scripts/bench.mjs` declares per-metric bounds: higher-is-better metrics fail
when they fall below `0.5×` the baseline, lower-is-better metrics fail above
their bound, and the correctness metrics (`wrapper_identity_hit_rate`,
`gc_release_hit_rate`) must stay exactly `1.0`. Bounds are intentionally
generous — the gate catches **obvious** regressions (plan §6: "不以单次绝对
速度作为合并门禁，先防止明显退化"), not single-run timing jitter. Baselines
are host-specific (the report records `os`/`arch`/`bun`/`rust`); comparing
across a different toolchain is not meaningful and should be re-recorded with
`npm run bench:record`.

## Reproducibility

- The Core bench uses fixed workload sizes and enough iterations to be stable
  (arena 200k slots, mutation 50k ops, parse/serialize 4k runs, selectors on a
  20k-node document).
- The FFI/GC bench uses the same fixed churn counts (200k element calls, 50
  documents for release, 200-document churn for the memory curve).
- Baselines are recorded and committed, so `git checkout <commit>` + `npm run
  dev:build` + `npm run bench:check` reproduces the gate on the same host
  without a Cargo-side network dependency beyond the toolchain pins.
