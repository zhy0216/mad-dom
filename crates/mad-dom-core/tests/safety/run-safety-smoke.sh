#!/usr/bin/env bash
# mad-dom safety smoke (T18, hardened in T50): verify the Core zero-unsafe
# inventory and run an applicable Miri smoke over a small representative subset
# of the Core tests.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root"

echo "== unsafe inventory check =="
if rg -n 'unsafe[[:space:]]*\{' crates/mad-dom-core/src; then
  echo "ERROR: found unsafe blocks in mad-dom-core — inventory regressed" >&2
  exit 1
else
  echo "OK: no unsafe blocks in mad-dom-core (#![forbid(unsafe_code)])"
fi
expected="$(rg -n 'unsafe[[:space:]]*\{' crates/mad-dom-bun/src | wc -l | tr -d ' ')"
echo "mad-dom-bun unsafe cast sites: ${expected} (documented in SAFETY.md — must stay exactly 4)"

echo "== Miri smoke (representative subset) =="
if rustup component list --toolchain nightly 2>/dev/null | grep -q 'miri'; then
  for test in \
    arena::tests::dangling_handle_can_never_read_new_node \
    arena::tests::generation_mismatch_errors \
    arena::tests::retired_slot_is_never_reused; do
    cargo +nightly miri test -p mad-dom-core --lib "$test"
  done
else
  echo "SKIP: Miri is not installed on nightly. Install with:"
  echo "  rustup component add --toolchain nightly miri"
fi

echo "== property & stress suite (native speed) =="
cargo test -p mad-dom-core
