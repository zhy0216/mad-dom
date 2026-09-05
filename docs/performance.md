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
and ran 1.8–5.1× ahead of happy-dom in a recorded 1× full-pipeline ABBA run
with 30 samples per engine (`bun benchmark/dom-bench/run.mjs`).

The trade-off used to be the other direction: every individual node operation
crossed the binding and eagerly minted a native wrapper. Current builds use
document-scoped lazy node tokens for creation and a bounded compact subtree
snapshot for the first `firstChild`/`nextSibling` walk. Reads over an unchanged
tree then stay in an epoch-guarded JS memo; Core-maintained structure and
attribute generations invalidate navigation, reflected-attribute and live
collection caches after every relevant mutation.

Simple document ID lookup now activates a Core-owned ID-only index, without
turning on the full class/tag/all-elements query index. Core text reads also
use an allocation-free relation walk with empty and single-text-child fast
paths. Text creation moves the Node-API-owned string directly into Core,
registers the guaranteed-fresh node without a futile reverse-map probe, and
uses a creation-only lazy `Text` wrapper factory that still enters the same
per-document identity table.

On macOS arm64 / Bun 1.4.0, the formal 15-round 1× command put mad-dom ahead
in 15 phases. Its only apparent loss, `readHeavy` at 4.41 ms vs 4.39 ms, was
0.46% and within run noise. To avoid relying on fixed engine order or selecting
a favorable result, a full-pipeline ABBA follow-up (mad, happy, happy, mad)
ran 15 measured rounds per worker and combined 30 samples per engine. Its
per-phase medians put mad-dom ahead in all 16 phases: cold traversal was
3.203 ms vs 3.434 ms, mixed construction 29.028 ms vs 47.382 ms, ID lookup
0.791 ms vs 41.147 ms, and the read-heavy phase 4.117 ms vs 4.559 ms. The two
mad-dom `readHeavy` batch medians were 4.005/4.142 ms; happy-dom's were
4.386/4.582 ms, so both paired directions agreed. A 200,000-draw
batch-stratified bootstrap estimated a 9.69% mad-dom advantage, with a
happy-dom/mad-dom ratio 95% CI of 1.030×..1.189×. The same 50,000-draw check
across every phase gave a positive happy-dom − mad-dom difference lower bound
for all 16; the narrowest was +0.119 ms for cold traversal.

A retained small-scale ABBA audit used four alternating workers with 31 rounds
each (62 samples per engine). Fourteen of 16 phases had a positive
happy-dom − mad-dom bootstrap-difference interval; `buildText` and `readHeavy`
were statistical ties. Their combined medians were 0.5742 vs 0.6689 ms and
0.4050 vs 0.3996 ms respectively, with 95% difference intervals of
−0.0332..+0.1914 ms and −0.0487..+0.0260 ms. Cold traversal remained just
positive at 0.3377 vs 0.3528 ms (CI +0.0003..+0.0263 ms). This is the expected
microsecond-scale noise floor, not evidence of a remaining boundary cliff.

In the final fixed-code 15-round 0.1×/1×/2× command, all 1× and 2× phases
except `readHeavy` had favorable point medians. At 2×, text creation was
14.82 ms vs 18.50 ms, element creation 12.42 ms vs 20.39 ms, and cold
traversal 6.27 ms vs 7.09 ms. `readHeavy` was 10.21 ms vs 10.17 ms—a 0.04 ms
(0.4%) gap with overlapping intervals; an earlier formal 2× run measured
9.81 ms vs 10.30 ms in the other direction, while the higher-sample 1× ABBA
above clearly favored mad-dom. Bulk work remains the strongest shape:
parsing, serialization, selector queries and bulk fragment construction run
several times ahead of happy-dom. The happy-dom aggregate total was unstable,
so these conclusions use per-phase medians only. Reproduce the scale audit
with `bun run bench:dom --runs 15 --sizes 0.1,1,2`.

The same final run reported these pipeline-end, post-drain worker RSS deltas
on its total rows:

| Scale | mad-dom RSS Δ | happy-dom RSS Δ |
| --- | ---: | ---: |
| 0.1× | +13.4 MB | +591.1 MB |
| 1× | +236.7 MB | +5,752.8 MB |
| 2× | +333.2 MB | +10,730.1 MB |

These figures include the multi-round worker's resident wrappers, JIT and GC
state; they are not per-document object sizes. They are reported alongside
the cold/warm timings because document-lifetime wrapper and memo residency is
an intentional part of the design. JSON mode retains each phase's peak and
post-drain RSS samples for machine-specific review.

## Regression gate

Performance and memory are guarded inside the repo: every change is checked
against a recorded baseline (`bench/baseline.json`) via `bun run bench:check`,
so regressions don't slip in.
