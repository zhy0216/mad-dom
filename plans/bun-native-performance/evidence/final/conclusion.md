# Task 05 final conclusions — integrated performance validation (T2)

Evidence roots (fixed before sampling, re-verified in every batch integrity
record and in `campaign.json` after/`before` inventories):

- A = frozen reference `efaa64b3b9d90cf1988d8092d7de08e97e929630`, image
  `2d1f85d4…2fa96` (read-only checkout, never rebuilt).
- B = candidate `09c6a68` (01 `fe77b7e` + 04 `24d8912` + 01-metadata `5cf2163`
  + 02 `834f5ff` + 03 `09c6a68`), installed and built in this worktree;
  image `6b7e7398119fe255a3aead79cf81d6e68da40923359dc2c8b2595c9663331903`;
  `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` both point at this single file.
- Runtimes: baseline Bun 1.4.0 (`.bun-version`) and latest Bun 1.4.2
  (independently resolved 2026-09-09, exe hashes in `runtimes.json` /
  `latest-release-resolution.json`). No cross-runtime ratios.
- Protocol: `method.md` (predeclared 2026-09-09T19:0xZ, before any sampling
  process): 01's fixed ABBA/2-warmup/9-measured/size 1→0.1→2, 16 Core +
  13 Testing + 19 hotspot phases per layer, fingerprints mandatory,
  aggregate = median of per-round timed-phase sums, positive = B slower,
  predeclared single supplemental repeat per flagged suite.

## 1. Sampling validity

One `activity.py --task 05 --kind sampling` reservation held by a single driver
(`campaign-all.mjs`, pid 132132, granted 2026-09-09T18:53:10.261Z, released
2026-09-10T08:22:30.380Z) executed, in serial order inside the lock: historical
`bench:check` guard (baseline + latest lane, exit 0 each, 19/19 + memory gates
+ observational raw RSS), six tiny smokes, six formal campaigns with automatic
supplementals, independent CPU profiles (diagnostics, never ratios), and the
final combined analysis — 17 steps, every one exit 0, `campaign.json`
`unchanged: true` across the whole reservation. No child took a nested lock;
nothing detached from the driver. The final analysis re-verified that all
formal outputs are byte-identical to the interim outputs captured before the
diagnostic profile phase (`analysis-consistency.json`).

- 12 formal batches × 40 (one supplemental 32) = **472 fresh processes, every
  manifest and summary `valid: true`**; 3,168 comparison rows retained
  (264 × 12). No failed/invalid process contributes a speedup; there were none.
- Per-attempt integrity (`*-integrity.json`, 12 files): reference source/image,
  candidate source/image, both runtime exes, shared harness and the four frozen
  drivers (`campaign.mjs`, `analyze.mjs`, `method.md`, `campaign-all.mjs`)
  unchanged across the entire campaign (`campaign.json` `before`/`after`).
- The bench:check guard ran against the historical baseline copied verbatim
  (`bc571c41…d9ff`); it was never re-recorded and no threshold was touched.
- After the tests-only `050a685` (off-lane test robustness) merged into main,
  this branch was rebased onto it (conflict-free; production digest
  `8e6a4b01…` and image `6b7e7398…` verified byte-identical before/after, so
  no rebuild and no re-measurement is required — the measured candidate is the
  rebased tree). Four full `bun run validate` runs then passed under the
  build-test gate (baseline+latest × FFI on/off, **1209 pass / 0 fail each**,
  including the two global-`MAD_DOM_FFI_DISABLED=1` lanes whose pre-merge
  16 test-design failures are now real passing assertions), with `bench:check`
  and the isolated-store integration re-run exit 0 (ledger 116–125).
- Noise per the predeclared MAD policy on this shared VM is heavy: 1,079 of
  3,168 rows flagged unstable in at least one batch; every suite that flagged
  was repeated once (all six campaigns supplemented, 40 procs each except
  latest-source-off-supplemental 32). Mechanical repeated >5% listings:
  415 row-flags across the twelve batches before review.

## 2. Public facade result — the performance question

Reference vs candidate with the default public configuration (FFI available,
mode `source`), pooled initial+supplemental medians. All cited rows have both
batches and all eight ABBA groups on the same side beyond the band with no
noise flag ("stable" below); `combined-tables.md` keeps every row.

Facade suite, size 1 (primary):

| Operation | baseline 1.4.0 | latest 1.4.2 |
| --- | ---: | ---: |
| `innerHTML.ascii` | **−40.9%** stable | **−40.1%** stable |
| `innerHTML.unicode` | **−36.5%** stable | −39.6% stable |
| `outerHTML.ascii` | −38.7% stable | −38.4% stable |
| `outerHTML.unicode` | −38.4% stable | −36.6% stable |
| `query.large.cold` | −30.9% stable | −27.6% stable |
| `query.large.hot` | −4.0% (noise-flagged) | +8.8% (mixed groups) |
| `innerHTML/outerHTML.grow-shrink` | +7.1 / −0.5 (mixed, noisy) | −5.4 / +4.2 (mixed, noisy) |

Same direction at sizes 0.1 and 2 for the HTML getters and large cold query
(e.g. baseline size 2 `innerHTML.ascii` −40.8, `query.large.cold` −28.1;
latest size 2 `outerHTML.ascii` −40.0); adapter-layer public-visible
`query.large.cold/hot` −40.5/−39.5 (baseline) and −41.6/−37.8 (latest), both
stable; `preorder.cold` −11.4/−12.7 stable. Core/Testing **aggregates show no
regression**: core `operations` +0.3% (baseline) / −2.3% (latest), testing
`operations` −6.2% / −2.9%.

**Verdict: the ≥10% stable public facade target is met.** Four public HTML
getter operations and large cold queries gained 26–44% in both runtimes with
every batch and group in agreement — this reproduces and extends the task-03
v1 signal (−28…−44%) on the final merged image (02 packing + 03 adapter +
04 harness together). It is not raw-only: the facade rows measure the complete
public operation (boundary call, string decode, wrapper hydration, public
consumption). Mechanism attribution: the FFI snapshot/scratch fast path with
bounded reuse and the facade UTF-8 decoder retained from 03 (the source-on
audits confirm both endpoints select the same channels per operation — cold
query/child/preorder via FFI snapshot calls, hot variants through the unchanged
JS scoped-query cache; HTML rows are reported with the audit's own
"provider: independent observedPath" wording, i.e. the gain comes from the
candidate's whole string path, not from a re-routed per-operation boundary).

No public default path was switched by this task; global FFI availability is
not equated with per-operation FFI execution (see `audit-*.json` in each batch).

## 3. FFI off vs on on the merged image (`*-mode` campaigns)

Same candidate root/image; A = `MAD_DOM_FFI_DISABLED=1`, B = FFI available.
These rows say nothing about reference comparison; they gate whether the
default should stay FFI-on anywhere.

- Stable FFI-on **gains**: raw Unicode HTML decode −20.7…−29.1% (stable, both
  lanes, all groups); candidate-internal `query.small.cold` −18.4% (baseline
  raw, flagged supplemental) and facade −25.2% (size 0.1, stable);
  core `operations` at sizes 0.1/2 −5.4/−5.3 (stable), `traverseWarm` −10.1,
  `getByTag` −12.0 (baseline, stable).
- Stable FFI-on **costs**, all disclosed and none on a public default-negative
  path: **core `serialize` size 2 +93.1% (baseline) / +97.4% (latest),
  size 1 +76.8%/+61.3%, every group beyond +42%** — the FFI serializer remains
  unsuitable for large serialization, which is why the existing selection (and
  03's decision to add no new static route) stands; in the source-on
  reference comparisons the same core `serialize` rows are +4.6%/+2.2% (size 1)
  and −32.3% (size 0.1), i.e. the public default is not carrying this cost.
  Adapter-layer creation tiers at position "2": latest `create.1` +60.6%,
  `create.32` +17.5%, `create.128/256` +9.4…+16.0% (stable, latest only —
  baseline-lane create rows are not stably positive, a runtime divergence to
  disclose; per the standing rule these size labels are measurement positions,
  not creation scales, and must not drive size-based strategies).
  Adapter grow-shrink/ascii HTML: `innerHTML.grow-shrink` size 1 +41.8%
  (baseline, stable), latest `outerHTML.grow-shrink` +27.9%, ascii HTML
  +9.1…+13.2%; facade `outerHTML.ascii` +11.9% (latest, one group +2.9%).
  These mode costs coexist with the far larger reference-vs-candidate facade
  gains in §2 — the candidate's Node-API-off path is itself slower than its
  FFI path on Unicode decode, and both are much faster than the reference.
- `testing testingLibraryText` size 2 +9.3% (latest mode; baseline lane +8.1%
  moderate) — repeat-mode cost, not a reference regression
  (source-off testing aggregates: −1.7/−6.0/−0.7 latest, +4.9 baseline).

## 4. Handoff re-gates

### 02 layout-drift points (±8–26%) on the merged image, Node-API lanes

Reference vs candidate with FFI off (`*-source-off`), where the changed Rust
`serialize_*`/Core bytes are identical and Node-API owns the buffers:

- Stable positives (candidate-off slower): baseline facade `outerHTML.ascii`
  +14.6%/+8.6% (sizes 1/2), `outerHTML.unicode` +11.6%; latest raw
  `outerHTML.ascii` +10.3%, facade size-2 `outerHTML.ascii` +15.6%,
  `innerHTML.unicode` +6.7/+12.0%; moderate: adapter ascii/unicode HTML
  +5.2…+12.9, raw `create.1/8/32` at size 2 +25.3/+29.5/+23.6 (one group
  below band each).
- Stable **negatives** on untouched micro paths (opposite mirror set):
  baseline facade size-2 `innerHTML.grow-shrink` −14.6%; latest testing
  `testingLibraryRole` −7.5% and `operations` −6.0%; latest raw create
  −8.3…−17.7 (size 1); latest core size-0.1 `traverseCold` −16.2%,
  `queryCold` −8.6%.
- The drift band reproduced on the merged image at ±6–16% (inside 02's reported
  ±8–26 class), with **direction not preserved** from 02's own campaigns
  (e.g. 02's stable create.8/create.32 improvements of −26/−20% became
  positive in baseline-source-off here). Combined with the task-03 null
  control — byte-identical v0/v1 production still swung ±40% at these
  positions — this remains classified as binary-layout/JIT-site sensitivity of
  these micro workloads on the shared VM, not an algorithmic regression of the
  merged changes. Nothing on the public FFI-on default path carries it:
  §2 rows are stable double-digit *gains* at the same positions.

### 03 small cold query / child grow-shrink candidates

- Latest source-on raw `query.small.cold` size 2 (03: +15.1% mixed): now
  **−16.8%**; latest source-off size 2 (03: +24.0%, noisy): now +7.6%
  (supplemental groups below band, mixed noise). Not reproduced.
- Baseline source-on raw `query.small.cold/hot` size 1 is repeatedly positive
  here (+25.1/+31.7, supplemental noisy / one group below band) — but the
  decomposition contradicts any code attribution: source-off says the same
  endpoint is −18.0/−3.7 faster than reference and the mode campaign says FFI-on
  is −16.4/−18.4 faster than off on this image, while source-on shows +31.7.
  Cross-campaign composition fails by >60 points at exactly the positions the
  03 null control flagged as path-history/site effects; latest lane is flat
  (−0.0/+3.9). Disclosed as unresolved site variance per §1 noise census,
  confirmed regression: no. At the public facade layer the same rows are
  −7.1/−9.9 (no public cost).
- Child grow-shrink: 03's +7.6% latest source-on is now −4.2 (stable,
  non-noisy groups under band); adapter child grow/shrink 03 +42.2% off-lane is
  now −14.7/−5.8. Resolved.
- 03's mode-internal create.8 signal: on the merged image the stably positive
  create rows are latest-lane-only (§3); baseline-lane FFI-on `child.grow-shrink`
  is −24.0% (on faster). Runtime-divergent, disclosed.

## 5. Repeated >5% regression review (unoptimized phases)

Criteria applied (predeclared, unchanged): pooled >5%, both batches same-sign
>5%, all groups same side >5%, no batch noise flag ⇒ class S; batch-consistent
and noise-free with one group below band ⇒ class M. Every S/M positive row was
located against group distributions, cross-lane/cross-campaign reproducibility,
and whether the workload executes changed code. Full row-level source:
`combined-tables.md`, distributions in `combined.json`/`analysis.json`.

Confirmed regressions attributable to this plan's changes that survive review:
**none at the public layer.** Disposition of every stable/moderate positive:

| Position | Signal | Disposition |
| --- | --- | --- |
| mode: core `serialize` size 1/2 +61…+97% | FFI serializer cost (03-known) | Policy already excludes it from the default; unchanged by this task; source-on default rows ≤ +4.6% |
| mode: latest adapter `create.1` +60.6%, tiers +9…+18% | creation-pool position, latest-only | No cross-runtime repro; size labels ≠ scales (standing rule); keep pool contract, monitor |
| mode: adapter HTML/grow-shrink +8.7…+41.8% | same-image off→on delta | Consistent with 03's outerHTML-ASCII mode cost; public default still far ahead of reference (§2) |
| source-off: facade outerHTML ascii/unicode +8.6…+15.6%, raw create ±23…+29 | layout/JIT-site drift | Reproduced ±6–16 band, direction unstable across campaigns; null-control precedent; no changed code on path |
| source-on baseline: raw `query.small.cold/hot` +14.2…+31.7, `query.large.cold` +8.5…+17.4, `outerHTML.ascii` +9.8, core `getByTag` size 2 +14.8; latest `raw outerHTML.ascii` +9.0/+13.0 | repeated positive raw-layer rows | Contradicted by own off/mode decomposition (§4) and by adapter/facade rows at the same workloads (−40%); shared-VM site effect, unresolved ⇒ inconclusive, retained with raw data |
| latest-mode `testingLibraryText` +9.3 (size 2) | repeat-mode delta | Not a reference regression; disclosed |

No confirmed regression required a repair hand-back; nothing was re-tuned, no
weight/threshold changed, no row dropped, no fastest-run selection: every
initial and supplemental process, including all noisy batches, is retained.

## 6. Memory, lifecycle and IO evidence

- Per-process runner-recorded RSS (baseline → per-phase peak/after) is retained
  in `analysis.json` (`memory`) for all 472 processes. Median max-peak growth
  during a suite: 31.5–38.2 MB on both sides of every campaign; no candidate-side
  systematic growth, no non-returning scratch trend (end-of-suite retention is
  noisy on both sides, 1–23 MB). These are point samples, not high-water marks:
  the historical RSS-v2 miss and raw-RSS limitations from the earlier coordinator
  evidence remain and are not re-litigated here.
- Bounded scratch reuse + UTF-8 decoder: selftest suites (03's
  `ffi-memory`, `ffi-facade-hot-path`, boundary/IO selftests) passed on both
  lanes and both FFI modes in the focused T1 batch (`commands/commands.json`
  001–061) and under full `bun run validate` (1,209 pass on both lanes,
  `commands` 062–069). Worker/destroy/transfer/GC semantics: unchanged ABI v1,
  capability bits 31; report:runtime and probe:bun:selftest exit 0.
- Checksum/IO path (04's single-scan `checksums.mjs`): exercised through
  `bench:check` (exit 0, both lanes) and per-workload semantic SHA-256
  fingerprints inside all 472 formal processes; there is no timed checksum
  phase in the formal matrix by design (01 protocol), so no ratio is claimed.
- Profiles: two independent CPU-profile sets (raw/adapter/facade, FFI-on,
  6 processes per lane) recorded under the same reservation after the formal
  campaigns; diagnostics only, never used for any speedup above. The committed
  batch records bind the 12 local profiler binaries by path/bytes/SHA-256 in
  `profiles/INDEX.json` (excluded from the tree by `./.gitignore`, 01–03
  precedent), so the local-only status of the raw `.cpuprofile` bytes is
  auditable rather than merely asserted.

## 7. Limitations

Shared 8-vCPU VM; formal windows saw load1 ≈ 1–6 with cpuSome spikes (recorded
per attempt). 1,079/3,168 noise flags ⇒ single rows carry little weight; all
headline claims use pooled both-batch agreement plus group agreement, and
cross-campaign ratios are never multiplied (composition failures documented in
§4 prove why). Latest = Bun 1.4.2 as observed 2026-09-09, not a permanent
"latest". macOS/untested platforms: no claims. Tiny smokes prove correctness
shape only. The `commands/` ledger under this directory records every gated
command with real exits, including the four driver-scope mis-scoped failures
(seq 15/18/39/42) corrected in rows 7–8 of `WORKLOG.md`. The two global-off
`validate` records (ledger 065/069) that reproduced 16 test-design collisions
pre-`050a685` are retained unaltered, and the post-merge re-run (§1,
ledger 117/119) closes them.

## 8. Acceptance statement

- T2 target: **achieved at the public facade layer** (≥10% stable gain, both
  runtimes, FFI-on default; mechanism = 02+03 combined boundary/decoder work,
  disclosed via audits as "same selected channels, faster whole-path").
  Confirmed public regressions: none surviving review; internal mode costs and
  the layout-drift band are disclosed with data, not washed.
  The formal tables regenerated byte-identically in the final in-lock analysis
  (`analysis-consistency.json`).
- "Implementation complete" vs "performance goal evidence-backed": 01–04
  implementations are complete and merged; 02's packing is retained without a
  speed claim (its honest conclusion), 03's adapter carries the measured public
  gain above; this task verified the combination end-to-end.
- T1 command-level validation is recorded in `commands/commands.json` and
  `WORKLOG.md`. After the tests-only `050a685` (off-lane test robustness)
  merge and the conflict-free rebase onto it, the previously held row is
  closed: both runtimes × FFI on/off full `bun run validate` all exit 0 with
  1209 pass / 0 fail (ledger 116–119), plus `bench:check` (120–121) and the
  isolated-store integration re-run (122–125) exit 0.
