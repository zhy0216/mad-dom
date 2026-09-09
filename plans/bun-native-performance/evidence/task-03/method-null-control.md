# Predeclared empty-production-difference source control

Declared on 2026-09-08 after the complete v1 matrix and before any production
restoration or new sampling. The coordinator explicitly authorized this
regression investigation. It is not a new final candidate or a route change.
The [v1 findings](findings-v1.md) retain every original result, including the
repeated latest FFI-off regressions that motivate this control.

Prerequisites: finish the already queued [v1 behavior checks](html-state-checks.mjs)
in both runtimes/modes; retain their four complete command records and eight
logs; verify their actual Bun version/revision, executable path/SHA256, local
native image path/SHA256 against the existing two-lane runtime and reference
metadata, and archived v1 production digest;
finish the v1 findings; recheck the exact archived v1 bytes and archive SHA256
`666d9e02c74a06ba0b9aaccde92d4c8502b36c2ae665a49fa360e2595dd24b1c`.
No current task-02 reservation is altered or bypassed.

One ordinary `activity.py --task 03 --kind sampling` reservation invokes the
[command recorder](null-control-command.mjs), which synchronously wraps the whole
new [null-control driver](null-control.mjs). Its separate
`commands/null-control-launch/` ledger retains the outer driver's stdout,
stderr and exit, including prerequisite failures; `commands/null-control/`
records the nested campaign, whose leaf commands keep their original ledger.
There is no concurrent writer to any ledger. Before any measured process starts,
it records the current v1 inventory and restores only this worktree's two
production differences to the original bytes read from the immutable reference.
The restore inputs must match both the frozen manifest and each archived file's
baseline SHA256. No reference file, permission, image or Git state is changed.

Before sampling, the candidate and reference must have identical complete
production-file maps, identical per-file bytes and SHA256 values, and production
digest `119652fe7235e5116a21adbb547e288ba6e31768e34c7ce59cb306936ad65fda`.
This checks the shared manifest's entire input inventory, not just the two
restored JavaScript files. All unchanged Rust, DOM workloads, dependency declarations,
lockfiles, versions and metadata in that inventory must match too. Installed
`node_modules` is not part of this production source manifest. New nonignored production
inputs cannot disappear from the comparison. The task HEAD anchor remains
`fe77b7e28ba1ca24e40ce9272bc6a504cb32c191`; the reference HEAD remains efaa64b.
Equal production bytes do not imply equal roots, Git HEADs or native instances.

Both image byte sequences must match SHA256
`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`,
while their device/inode identities remain independent. The reference image
stays inside its frozen checkout; the candidate image stays in this worktree's
own `build/`. No build is needed because Rust and the image bytes are unchanged.
The runner sets both endpoint overrides to that endpoint's own image and checks
the actual loaded Node-API path. FFI is forced off at both endpoints.

The executable is fixed to the already independently verified latest observation:
`/tmp/mad-dom-bun-performance-01/runtimes/latest/bun-linux-x64/bun`, version 1.4.2,
revision `744846f844374847c902b5e7fd59b4342a51ef99`, executable SHA256
`a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`.
This control uses that fixed runtime to investigate the existing latest rows;
it does not assert that the version will remain latest indefinitely.

The append-only output label is `latest-v0-source-off-control` and the mode is
truthfully `source`, FFI off. A is the original frozen reference/root/image;
B is this task's own temporarily restored v0/root/image. The unchanged shared
runner executes all Core/Testing/raw/adapter/facade suites, sizes in order
`1, 0.1, 2`, all 16/13/19 workloads and 32 hotspot operations per round. Every
suite gets ABBAABBA, each letter a new process with two warmups and nine measured
rounds. Independent audits precede the hotspot comparisons as usual. Creation
size labels still represent identical per-tier counts at different positions.

The existing [campaign driver](campaign.mjs), [analysis](analyze.mjs) and
[original rules](method.md) remain unchanged. Initial budget is 40 formal
processes. Round MAD >20%, process-median MAD >10%, opposite group changes beyond
+/-5%, or repeated >5% regressions select the affected suites for exactly one
complete two-ABBA supplement, retaining every workload and size in those suites.
Maximum supplemental budget is another 40 formal processes. The driver keeps
the same sampling lock across initial, analysis, paired supplement and final
analysis. It never nests the gate or detaches children. Failed, partial and noisy
results remain; no recursive sampling, threshold change or omitted row is allowed.

Full before/after inventories include both roots, all production file hashes,
the per-file byte-equality checks, image identities, executable and harness
identities, and the control's driver/method/findings identities. A transition
journal records each planned restoration and each completed write. The shared
campaign's own integrity checks keep v0 production and both images frozen for
the entire initial/supplemental campaign. After that campaign ends, including
on a reported failure, the outer driver restores v1 from the verified archive
and checks the complete original v1 inventory again. No timed process sees a
production restoration. Each transition first checks that the current complete
file bytes are one of that path's verified v0/v1 states. Unknown bytes are
preserved in a new, exclusively created `null-control-unexpected-source/` record
with full base64 contents, byte count and SHA256; the driver reports
`restoreFailure` and does not overwrite that file. It still attempts to restore
the other path if that path is in either known state. A partial transition may
therefore safely recover known states without erasing an unexpected edit.
A killed process cannot certify a finally block; any
interruption requires disk/process/journal recovery, preserving all checkpoints.

The control distinguishes production-byte differences from the retained
root/path/image/process differences; it also informs investigation of v1's
entry-time resident encoder/decoder allocations. A null result, a repeated
path-associated difference, or an inconclusive/noisy result will each be
reported honestly. Separate batches run at different times cannot by themselves
prove a causal allocation, filesystem or VM explanation. No performance fix,
new static route or todo completion is inferred in advance. The restored v0 is
explicitly a diagnostic control and is restored to v1 afterward.
