#!/usr/bin/env bash
# mad-dom-core safety smoke (T18): verify the zero-unsafe inventory and run an
# applicable Miri smoke over a small representative subset of the Core tests.
set -euo pipefail

cd "$(dirname "$0")/../../.."

echo "== unsafe inventory check =="
if rg -n '\bunsafe\b' crates/ --glob '*.rs' 2>/dev/null; then
  echo "ERROR: found 'unsafe' tokens in Rust sources under crates/ — inventory regressed" >&2
  exit 1
else
  echo "OK: no unsafe tokens in Rust sources under crates/ (mad-dom-core and mad-dom-bun)"
fi

echo "== Miri smoke =="
if rustup component list --toolchain nightly 2>/dev/null | grep -q 'miri'; then
  cargo +nightly miri test -p mad-dom-core --lib arena::tests::dangling_handle_can_never_read_new_node
else
  echo "SKIP: Miri is not installed on nightly. Install with:"
  echo "  rustup component add --toolchain nightly miri"
fi

echo "== property & stress suite =="
cargo test -p mad-dom-core
