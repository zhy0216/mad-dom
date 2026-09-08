# Frozen reference handoff to coordinator and tasks 02/03/04/05

Keep this checkout through completion of task 05:

```text
/home/ubuntu/.herdr/worktrees/mad-dom/bun-native-performance-reference-efaa64b
detached HEAD: efaa64b3b9d90cf1988d8092d7de08e97e929630
native image: build/mad-dom.node
artifact SHA256: 2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96
production-source inventory SHA256: 119652fe7235e5116a21adbb547e288ba6e31768e34c7ce59cb306936ad65fda
all 1498 tracked files inventory SHA256: 6a53ed77cfb008302c53c50c6bb9b2fc2394a84c5748bd4683fb30220a9c107b
```

`reference-manifest.json` carries absolute paths, the full production inventory,
executable/ZIP hashes, runtime versions and revisions, release selection, build
isolation and permissions. `reference-source-files.json` adds every tracked file.
The inventory digest is SHA256 of JSON.stringify(the sorted path→SHA256 map),
not a tar archive digest. All tracked regular source files, build and target have
write bits removed; hashes remain the authority when reusing the reference.

Both checkouts were installed separately with `bun install --frozen-lockfile` and
built separately with `bun run dev:build` under Rust 1.93.1. Commands 001–004 and
their complete outputs are in `commands/commands.json`. The two native artifacts
have equal bytes but separate inodes (reference 2104807, task 01 2102966). Each
process sets both `MAD_DOM_NATIVE_PATH` and `MAD_DOM_FFI_PATH` to its own one image;
it never loads the other checkout's image. `build/mad-dom-ffi.so` is the existing
same-image symlink. The reference target is under the reference root and is not
shared with any candidate target. Do not rebuild the reference to test a candidate.

For this recorded run:

```text
baseline /tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun
1.4.0 / 34cbb9a40b4bd1bd767d134a7065e66c2432a676
executable SHA256 33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b

latest /tmp/mad-dom-bun-performance-01/runtimes/latest/bun-linux-x64/bun
1.4.2 / 744846f844374847c902b5e7fd59b4342a51ef99
executable SHA256 a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c
```

Baseline selection is `.bun-version`; latest was independently queried from the
official release API. Future latest lanes must resolve again. Retain these exact
executables for reproducing the recorded experiment, and record a different lane
if latest moves. No CI/release policy or historical benchmark was changed.

After task 01 is integrated, run the integrated harness from the candidate root:

```sh
REF=/home/ubuntu/.herdr/worktrees/mad-dom/bun-native-performance-reference-efaa64b
BUN=/tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun
"$BUN" benchmark/bun-performance/run.mjs --bun "$BUN" \
  --reference-root "$REF" --reference-image "$REF/build/mad-dom.node" \
  --candidate-root "$PWD" --candidate-image "$PWD/build/mad-dom.node" \
  --mode source --ffi on --out /tmp/task05-baseline-source-on
```

Build the candidate first in its own checkout, then obtain the coordinator's
serial timing window. Repeat with `--ffi off`, and separately with the freshly
resolved latest executable. The same harness explicitly imports the reference
source; the frozen checkout contains no copy of this new harness. Source and
artifact hashes are rechecked inside every child. Independent path audits are
keyed by source root, artifact, runtime, mode and layer, so a candidate selecting
Node-API/range with available FFI is reported as the observed selection.

Task 01 owns `benchmark/bun-performance/` and this baseline evidence. Later tasks
write their own task evidence; ask the coordinator to route any shared-runner
correction to its owner. ABI v1, caller-owned outputs, existing Node-API lifecycle
and wrapper identity remain unchanged by task 01.

## Working-tree provenance when reusing this reference

The runner records `sourceSha` as Git HEAD, separately from the digest of current
production bytes. Current inventories include relevant tracked and nonignored
untracked inputs, including new candidate `js/` helpers before staging. Do not
interpret an unchanged HEAD as unchanged production code. The original frozen
reference inventories and hashes remain unchanged; the exact measurement harness
is retained in [measured-harness-source.json](measured-harness-source.json).
