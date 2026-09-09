# Frozen v1 preload wording limitation

The coordinator reported this metadata/nominal-label issue while task 02's
unchanged resume1 driver held its sampling reservation. The original owner is
repairing it in another worktree. Task 02 continues to measure its frozen
fe77b7e-based checkout and original harness; no repaired future harness or main
content is represented as part of these measurements.

In the measured `benchmark/bun-performance/preload.mjs`, lines 29 and 47 check
that FFI-off has runtime status `disabled` and a null document FFI binding.
The real FFI query and UTF-8 serialization handshake at lines 40–46 executes
only in the FFI-on branch. Line 59 nevertheless writes the same fixed handshake
description in both modes. Therefore the off-mode `metadata.handshake` sentence
does **not** prove that a query or serialization handshake ran in preload, nor
that an FFI image was loaded. The two override variables are still checked
against that side's own image, and the Node-API loaded image is checked directly.

Use each worker's recorded mode, overrides, runtime status, independent operation
path audit, and validated workload/semantic digest to describe the actual path.
In particular, FFI-off measurements cover the Node-API path even where a suite
retains a nominal raw/adapter layer name. Keep all original labels and raw files;
do not silently rewrite them or use FFI availability as a per-operation oracle.
Final performance findings remain pending the complete paired matrices and
predeclared supplements.
