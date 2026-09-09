# Checked snapshot packing review

The FFI entry resolves the owner/generation before validating the output. It
then checks alignment, representable byte/address ranges, output/written and
input/output/written disjointness over the caller's full declared capacity.
Query UTF-8, token validity, selector parsing and collection precede capacity
failure, preserving existing error priority. Node collectors are unchanged.

`token_snapshot_len` checks multiplication/addition and the u32 written-length
limit. `Output::require` publishes the required length; inadequate capacity
returns before the callback, output writes, token enablement or registration.
The helper independently checks its actual slice length and continuation
arithmetic before any output or registry mutation. Tests cover unchanged
canaries, fresh proof and registry state after failures.

The only new raw borrow is in `ffi/buffer.rs`. It covers the required prefix
within the real declared capacity and is a callback-scoped mutable slice of
`MaybeUninit<u32>`. It neither assumes initialization nor returns a reference
with an unconstrained lifetime. The callback's output is `()`, so this borrow
cannot be returned to the entry. A zero prefix never creates a null slice.
Actual allocation validity and exclusive access during the call remain C
caller obligations; arithmetic checks cannot validate arbitrary addresses.

Packing assigns every returned word. The common helper receives `identity`
for the owned u32 allocation and `MaybeUninit::new` for the caller prefix.
The fresh-descriptor rewrite reads the original classified node descriptor,
never an uninitialized output word. Existing tokens, one packing registry
mutex, missing-index collection, token range reservation and fresh-bit
semantics are retained. Existing boundary panic/status conversion is unchanged;
the ABI's success prefix is meaningful only on success.

Node-API owns its Vec and resulting Uint32Array independently. FFI retains no
pointer or native allocation for the result. Capacity failure remains separate
from single-shot creation; creation and read_batch are untouched. No unsafe
code is added to Core. The added tests exercise truly uninitialized C output,
guards outside the required prefix, exact/short/zero capacity, invalid ranges,
Unicode, deep/wide topology, continuation and per-document identity/fresh proof.

Rust tests, Bun FFI tests, sanitizer results and full commands are recorded in
`commands/commands.json`. Sanitizer execution and safety scans are additional
evidence, not a proof of all aliasing, initialization or native lifetime cases.
Existing scratch/lifecycle/RSS limitations (including the historical injected
leak miss) continue to apply.

The final helper was rebuilt in command 017 and passed the complete functional
batch 014–042. ASan command 041 used the same Rust 1.93.1 compiler, with
`RUSTC_BOOTSTRAP=1` only to enable `-Zsanitizer=address`, an explicit Linux target
and this checkout's separate `target/asan`. All 18 FFI tests passed, including
the uninitialized prefix, overflow, overlap, token/lifecycle and continuation
cases; no sanitizer diagnostic was reported. The Bun release image remains
the ordinary build, independently exercised by both recorded Bun runtimes.
ASan does not establish all initialization/aliasing properties or the behavior
of arbitrary invalid C pointers. See [validation.json](validation.json) and the
complete [command record](commands/commands.json).
