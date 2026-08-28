#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

mode="${1:-scan}"
case "$mode" in
  scan)
    echo "mad-dom-core unsafe/FFI inventory:"
    if ! rg -n \
      'unsafe[[:space:]]*\{|unsafe[[:space:]]+fn|unsafe[[:space:]]+impl|extern[[:space:]]+"' \
      crates/mad-dom-core/src; then
      echo "(none)"
    fi
    ;;
  miri)
    cargo +nightly miri test -p mad-dom-core
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
