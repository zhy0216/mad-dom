# Task 03 predeclared budget and measurement protocol

Declared before production edits / candidate sampling on 2026-09-08 UTC.
`before-source.json` preserves the original relevant production bytes and hashes,
identical to the frozen efaa64b reference. Task 01's complete before samples,
profiles, findings and tables remain immutable in `../baseline/`.

First candidate: reuse one encoder and one non-streaming facade decoder; replace
context map preparation with three checked scalars; use per-operation numeric
capacity hints and a leased four-byte length word. No output buffer pool, document
cache, borrowed facade helper, selector cache or new ABI. Every returned array
owns its entire backing store. Exact-size results may return the fresh output
directly; other results are copied into an exact-size allocation.

Budget: three read-only word operations retain hints at most 16,384 words (64 KiB
initial allocation); two byte operations at most 131,072 bytes (128 KiB initial
allocation). These are allocation hints, not retained buffers. The next successful
small result immediately resets its hint to max(original minimum, result length).
Results larger than the hint ceiling reset the hint to the original minimum.
Native/output-allocation/copy exceptions and protocol anomalies reset the hint.
Rejected arguments precede the output lease and leave the existing hint alone;
they neither call native nor touch scratch. The original
4,000,000-word / 64,000,000-byte maximum and eight-attempt ceiling stay unchanged.
Six operation-local scratch length words retain only 24 backing-store bytes per
adapter/realm; overlapping reentrant calls use independent temporary length words,
released with try/finally. Nothing retained refers to a document or result buffer.
Creation keeps exact capacity, one native call, and malformed success throws.

All install/build/test/selftest commands use activity.py --task 03 --kind build-test.
All comparisons, diagnostics, profiles and performance gates use --kind sampling.
An entire runner invocation (including both audit endpoints and all ABBA groups)
remains under one exclusive gate. Child processes are synchronously joined.
Commands, exits, failures and full stdout/stderr are retained in commands/.
The gate's requested/granted/released records are copied for task 03 at completion.

Baseline is read from .bun-version. Latest is freshly resolved via the official
release API; runtimes.json records verification against the 01 executable hashes.
The task owns target/ and build/; both overrides point at its build/mad-dom.node.
Source comparisons let the runner set each endpoint's overrides independently.
The frozen reference is read only and is never rebuilt or used as a candidate image.

Initial source comparison: baseline and latest independently, FFI on and off;
all Core/Testing/raw/adapter/facade suites, sizes 1, 0.1, 2, 32 hotspot operations
per round. Each suite runs ABBAABBA, each letter a new explicit-runtime process
with two warmups and nine measured rounds. All 16/13/19 workloads and fixtures
(including B nodes, Unicode, growth/shrink and every creation tier) stay unchanged.
Creation's off endpoint uses the existing Node-API scalar range.
Candidate FFI on/off comparisons use the same protocol to inform path selection.
Smoke/diagnostic timing never becomes a performance claim. Any alternate candidate
is recorded with its own source hashes and complete evidence before revision.

Statistics and noise handling follow 01 unchanged: per-round Core/Testing sums,
median/p90/MAD, process medians, every group change. Round MAD >20%, process-median
MAD >10%, opposite group changes beyond +/-5% trigger one complete supplemental
two-group batch of the flagged suite with every size/workload retained. Repeated
>5% regressions also trigger that one supplemental batch and require investigation/fix;
no sampling until green, dropped rows,
threshold changes or raw-only benefit claims. Keep opposite runtime/mode results.
Retain useful simple changes; shrink or revert complexity without stable benefit.

Source/image inventories are recorded before and after every campaign; production
files and images remain unchanged while sampled. Independent 01 audits record
actual paths separately from available capabilities. New path choices must be
notified to the coordinator and remain observable through the existing audit.
Shared-VM competition remains uncontrolled and is recorded by the runner. Existing
native lifecycle counters, RSS limits and historical RSS false negatives remain.
