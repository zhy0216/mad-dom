# Why MAD DOM

MAD DOM brings a native DOM to Bun while retaining a happy-dom-style JavaScript
API. It is designed for workloads that repeatedly parse HTML, build trees,
query elements, update components, and serialize results.

## Faster where DOM work adds up

The **2026-09-05 source-build benchmark** compared identical, validated workloads
with happy-dom 20.11.11:

| Workload | mad-dom | happy-dom | Speedup |
| --- | ---: | ---: | ---: |
| Core DOM operations, 16 phases | 141.70 ms | 401.60 ms | **2.83×** |
| Test workflows, 13 scenarios | 91.10 ms | 143.08 ms | **1.57×** |
| HTML parsing phase | 9.845 ms | 31.415 ms | **3.19×** |
| HTML serialization phase | 1.007 ms | 5.013 ms | **4.98×** |
| Mutation churn phase | 9.416 ms | 80.848 ms | **8.59×** |

The first two rows are medians of per-round sums; the remaining rows are
individual phase medians and are already included in the core total. Measured
on Apple M3 Max, 48 GiB RAM, macOS arm64, Bun 1.4.0, Rust 1.93.1; size 1×,
2 warmup rounds and 9 measured rounds. This measures a source build, not a
downloaded npm binary.

The testing workloads include real DOM Testing Library queries and events,
forms, template cloning, Shadow DOM, and snapshot round trips. All workloads
passed with matching results. See [Performance](/performance) for all 29
phases, slower cases, raw samples, and reproduction commands.

## How the native implementation helps

The **Rust arena owns the DOM tree**: nodes, attributes, text, and tree
relationships live in the native core. Parsing, selector matching, and
serialization can process substantial tree work there. The JavaScript facade
provides the familiar objects and methods through a Node-API binding.

Crossing that binding has a cost. MAD DOM reduces repeated work with lazy node
handles, bounded batches, and caches for queries and navigation. Mutations
invalidate derived state so subsequent reads still reflect the native tree.
Repeated access to the same node preserves JavaScript object identity.

You use ordinary DOM methods; there is no separate fast-mode API to learn.
The core enforces `#![forbid(unsafe_code)]`. The native binding has its own
documented safety boundary, described in the repository's
[safety notes](https://github.com/zhy0216/mad-dom/blob/main/crates/mad-dom-core/SAFETY.md).

## Choose it for these jobs

| Job | Starting point |
| --- | --- |
| Unit tests that create and mutate DOM fixtures | [Testing](/testing) |
| Testing Library queries against rendered HTML | [DOM Testing Library](/testing#dom-testing-library) |
| Extracting data from HTML or rewriting a document | [DOM operations](/dom) |
| Testing custom elements, templates, and shadow trees | [Web components](/web-components) |
| Loading server-rendered HTML and inspecting the result | [Browser](/browser) |
| Evaluating a migration from happy-dom under Bun | [Migration](/migration) |

MAD DOM does not perform visual layout or paint pixels. Element geometry is
not a real browser rendering result. Use a browser for screenshot comparisons,
layout-sensitive assertions, and complete application navigation.

## Evaluate the improvement in your suite

The recorded result describes one workload mix. MAD DOM was faster in 15/16
core phases and 8/13 test workflows; read-heavy work and several small testing
scenarios were slower. A suite dominated by network latency, a framework
renderer, or runner startup will have a different result.

Run the same tests with each engine, verify that both pass, then compare
multiple runs on the same machine. Keep dependencies, test selection, fixture
size, and setup/cleanup policies constant. The benchmark's lifecycle scenario
uses the current alpha cleanup behavior; future lifecycle fixes will require a
fresh measurement.

## Familiar API, explicit coverage

MAD DOM targets happy-dom compatibility against a pinned baseline. A passing
differential contract is evidence for the scenarios it covers; it does not
establish support for every upstream feature or framework integration. The
[Compatibility report](/compat-report) separates that contract from upstream
unit coverage and the WPT subset.
