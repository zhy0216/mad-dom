# Why MAD DOM

MAD DOM brings a native DOM to Bun while retaining a happy-dom-style JavaScript
API. It is designed for workloads that repeatedly parse HTML, build trees,
query elements, update components, and serialize results.

## Faster where DOM work adds up

The **2026-09-12 source-build benchmark** compared identical, validated workloads
with happy-dom 20.11.11:

| Workload | mad-dom | happy-dom | Speedup |
| --- | ---: | ---: | ---: |
| Core DOM operations, 16 phases | 407.14 ms | 1321.15 ms | **3.24×** |
| Test workflows, 13 scenarios | 294.31 ms | 412.66 ms | **1.40×** |
| HTML parsing phase | 25.700 ms | 93.445 ms | **3.64×** |
| HTML serialization phase | 4.152 ms | 12.491 ms | **3.01×** |
| Mutation churn phase | 21.629 ms | 379.921 ms | **17.57×** |

The first two rows are medians of per-round sums; the remaining rows are
individual phase medians and are already included in the core total. Measured
on AMD EPYC (8 vCPUs, KVM), 15.6 GiB RAM, Ubuntu 24.04 Linux x64, latest stable
Bun 1.4.2, Rust 1.93.1; size 1×, 2 warmup rounds and 9 measured rounds.
This measures a source build, not a
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

The recorded result describes one workload mix. MAD DOM was faster in 12/16
core phases and 12/13 test workflows; cold traversal, standalone element/text
creation, read-heavy work and async observers were slower. A suite dominated
by network latency, a framework renderer, or runner startup will have a different result.

Run the same tests with each engine, verify that both pass, then compare
multiple runs on the same machine. Keep dependencies, test selection, fixture
size, and setup/cleanup policies constant. The benchmark's lifecycle scenario
includes the current `happyDOM.close()` cleanup behavior. Use the latest stable
Bun for new measurements and record its actual version and revision.

## Familiar API, explicit coverage

MAD DOM targets happy-dom compatibility against a pinned baseline. A passing
differential contract is evidence for the scenarios it covers; it does not
establish support for every upstream feature or framework integration. The
[Compatibility report](/compat-report) separates that contract from upstream
unit coverage and the WPT subset.
