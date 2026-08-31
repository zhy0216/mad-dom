#!/usr/bin/env bash
# mad-dom safety check suite (T50 hardening).
#
# * `scan` — prints the workspace `unsafe`/FFI inventory. mad-dom-core must
#   stay at zero handwritten `unsafe`; mad-dom-bun has a fixed, documented set
#   of four `unsafe { …cast() }` blocks (the napi `Unknown`→`Function`
#   relaxation; see crates/mad-dom-bun/src/extensions/{events_api,
#   mutation_observer_api,traversal_api}.rs and SAFETY.md).
# * `miri` — runs a representative Miri subset over mad-dom-core. The full
#   property/stress suite is excluded because it is intentionally too slow
#   under Miri (tens of minutes, see crates/mad-dom-core/tests/safety/README.md);
#   the representative tests cover the generational-slot reuse safety property,
#   generation-mismatch stale-handle rejection and the slot-retirement policy.
# * `asan` — AddressSanitizer smoke over the whole mad-dom-core test suite on
#   the nightly host target (when supported).
#
# Miri and ASan are intentionally separate jobs (Miri is not a sanitizer, and
# sanitizer availability varies by target). These jobs supplement, never
# replace, `cargo test -p mad-dom-core`.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

mode="${1:-scan}"
case "$mode" in
  scan)
    echo "mad-dom unsafe/FFI inventory:"
    if rg -n \
      'unsafe[[:space:]]*\{|unsafe[[:space:]]+fn|unsafe[[:space:]]+impl|extern[[:space:]]+"' \
      crates/mad-dom-core/src; then
      echo "ERROR: mad-dom-core must contain no handwritten unsafe" >&2
      exit 1
    fi
    echo "(mad-dom-core: none)"
    echo "mad-dom-bun (expected: the 4 documented cast() relaxations only):"
    if ! rg -n 'unsafe[[:space:]]*\{' crates/mad-dom-bun/src; then
      echo "(mad-dom-bun: none)"
    fi
    ;;
  miri)
    if ! rustup component list --toolchain nightly 2>/dev/null | grep -q 'miri'; then
      echo "Miri is not installed on nightly; install with:" >&2
      echo "  rustup component add --toolchain nightly miri" >&2
      exit 1
    fi
    for test in \
      arena::tests::dangling_handle_can_never_read_new_node \
      arena::tests::generation_mismatch_errors \
      arena::tests::retired_slot_is_never_reused; do
      cargo +nightly miri test -p mad-dom-core --lib "$test"
    done
    ;;
  asan)
    host_target="$(rustc +nightly -vV | sed -n 's/^host: //p')"
    if [[ -z "$host_target" ]]; then
      echo "could not determine the nightly host target" >&2
      exit 1
    fi
    CARGO_TARGET_DIR="target/asan" \
      RUSTFLAGS="-Zsanitizer=address" \
      cargo +nightly test -p mad-dom-core --target "$host_target"
    ;;
  *)
    echo "usage: $0 {scan|miri|asan}" >&2
    exit 2
    ;;
esac
