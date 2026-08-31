# mad-dom-core safety checks

This crate currently contains no `unsafe` block, `unsafe fn`, `unsafe impl`,
or FFI declaration — and that is now enforced at the compiler level by
`#![forbid(unsafe_code)]` at the crate root (T50 hardening). The inventory
covers production code under `src/`; tests and documentation do not establish
additional safety contracts.

Refresh the inventory from the repository root:

```sh
scripts/check-core-safety.sh scan
```

The script prints every matching source location and fails if the Core ever
gains a handwritten `unsafe`. Any future result would have to be documented
here with its caller obligations, ownership/lifetime assumptions, failure-path
tests, and the reason safe Rust is insufficient — and the `#![forbid(unsafe_code)]`
attribute lifted in a dedicated, audited commit.

## The binding's unsafe surface (mad-dom-bun)

The FFI/`unsafe` surface of this project lives in `crates/mad-dom-bun`, not in
this crate. It is a fixed, documented set of **four** `unsafe { …cast() }`
blocks — the napi `Unknown`/`Reference` → `Function` phantom-type-erasure
relaxation in the event listener, MutationObserver scheduler/callback and
TreeWalker filter paths:

- `src/extensions/events_api.rs` (listener registration, T37);
- `src/extensions/mutation_observer_api.rs` (scheduler + observer callback, T41);
- `src/extensions/traversal_api.rs` (TreeWalker filter, T35).

Each is documented inline with the "facade always passes a function wrapper, so
the erased `Function` phantom type is sound at runtime" premise. The binding
crate root (`crates/mad-dom-bun/src/lib.rs`) documents the full safety model:
all real FFI lives inside the `napi` crates, `#[napi(catch_unwind)]` contains
panics, no raw pointer crosses the boundary, and the T21B affinity guard
rejects cross-thread use before any Core state is touched.

## Dynamic checks

The Core is runtime-independent and uses only supported Rust APIs, so its test
suite is suitable for Miri. Install Miri for the pinned/current nightly and run
the representative subset (the full property/stress suite is intentionally
excluded from Miri — it runs tens of minutes there, see
`crates/mad-dom-core/tests/safety/README.md`):

```sh
rustup component add miri --toolchain nightly
scripts/check-core-safety.sh miri
```

AddressSanitizer is a useful smoke check on nightly toolchains whose host target
supports `-Zsanitizer=address`:

```sh
scripts/check-core-safety.sh asan
```

These jobs supplement, rather than replace, the normal `cargo test -p
mad-dom-core` gate. Miri and ASan are intentionally separate because Miri is
not a sanitizer and because sanitizer availability varies by target.
