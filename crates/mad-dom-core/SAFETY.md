# mad-dom-core safety checks

This crate currently contains no `unsafe` block, `unsafe fn`, `unsafe impl`,
or FFI declaration. The inventory covers production code under `src/`; tests
and documentation do not establish additional safety contracts.

Refresh the inventory from the repository root:

```sh
scripts/check-core-safety.sh scan
```

The script prints every matching source location. Any future result must be
documented here with its caller obligations, ownership/lifetime assumptions,
failure-path tests, and the reason safe Rust is insufficient.

## Dynamic checks

The Core is runtime-independent and uses only supported Rust APIs, so its test
suite is suitable for Miri. Install Miri for the pinned/current nightly and run:

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
