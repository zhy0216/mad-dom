# Post-campaign verification repairs

The full campaign ended at 2026-09-08T10:28:12.266Z. Before changing the harness,
command 036 preserved its exact source at 10:30:13Z in
[measured-harness-source.json](measured-harness-source.json). The original method,
sampling-start record, twelve campaign manifests, sample records and reference
inventories were not overwritten.

| Identity | SHA256 |
| --- | --- |
| Harness used for the complete campaign | `4d64a19f6d5432fc40a6c4e9e843eb98e05a3fd783c56fdcc0c235ff1e21f035` |
| Final reusable harness | `713dc9567cc9d8c1926a67fef250eb13b1ae47352b35310149e5e87e3564cf3f` |
| Predeclared method | `1f28c600b6036fe87048bd04898ba710a8537745790102bde6668d395d0947b5` |
| Original reference manifest file | `55224b87e42d6c41aec938f7ccc7d8ec0b1136af0c7e2dc62b3937fdc19a8b09` |

Only `provenance.mjs`, `report.mjs`, `run.mjs`, and `report.test.js` changed after
capture. The timed worker, fixtures/statistical protocol, preload handshake and
independent instrumentation/audit remain byte-identical to the measured harness.
The archive contains each original source text and file digest, plus the exact
sampling driver. [post-campaign-integrity.json](post-campaign-integrity.json)
records the final comparison; `integrity.mjs` also rechecks the archived campaign
manifest hashes, all 1498 tracked reference files and readonly build/target.

The repairs address coordinator review without modifying production:

- Source inventories now include relevant tracked and nonignored untracked
  production files. An actual unstaged Unicode-named `js/` helper regression
  proves that adding it or changing its bytes changes the production digest while
  HEAD stays fixed. The test uses an isolated fixture inside this task's new
  benchmark directory and performs no Git writes.
- `sourceSha` explicitly means Git HEAD. The separate `productionSha256` hashes
  the current sorted path-to-file-SHA256 map; it does not claim a clean checkout.
  The expanded inventory exactly matches the old frozen reference file set and
  digest, so old reference hashes remain independently checkable.
- Saved-evidence verification checks the declared runs/sizes/suites against the
  actual child configs, and verifies recorded harness/production/lock/workload
  inventories. Regressions exercise a coherent child set paired with a different
  protocol, rather than testing only malformed child internals.
- An unexpected instrumented result or CPU-profile command cannot be accepted as
  formal timing. The recorded child executable must equal the explicit Bun path.

Actual operation selection was audited before the campaign: each source/mode has
separate independent calls and checksums, distinct from `expectedPath`. The final
source-on and source-off smokes exercise reference and task endpoints with their
own images. Live tests accept a future facade selecting Node-API with available
FFI; the frozen audit demonstrates this today with create pool 1. There are no
instrumentation hooks in formal workers or changes to production hot paths.

The measured preload's fixed `metadata.handshake` description names the FFI-on
Unicode handshake. In off mode the preload verifies explicit disablement and a
null FFI document binding; the subsequent worker's complete semantic checks prove
off-mode query/serialization correctness. The runtime status and checks, rather
than that descriptive string alone, establish which work actually ran.

After repair, both Bun versions passed 18 tests / 102 assertions, `check`, help,
three complete smoke modes each, and saved-evidence verification for all twenty
batch directories (including development evidence). Commands 037–069 retain the
full outputs. The original full repository gates predate these harness-only
repairs; production and Rust inputs are unchanged, and the affected harness and
syntax checks were rerun. Analysis scripts were then run separately.

`sample-files.json` records every file in those twenty data directories. Its
inventory and the complete log hashes are checked by `validation.mjs`. Re-running
analysis writes derived tables only; re-running a measurement must use a new
output directory. Do not run `sample.mjs` over this saved campaign: its content is
an execution record, and its original sampling-start record must be retained.
