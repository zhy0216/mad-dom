#!/usr/bin/env bash
# T04 spike build: compile the isolated binding prototype and expose the
# cdylib as `index.node` so the Bun test runner can `require` it.
#
# Re-runnable: safe to execute any number of times; always rebuilds from the
# current sources and replaces the artifact. The artifact (and `target/`) is
# git-ignored (*.node / *.so / target/ in the root .gitignore).
set -euo pipefail

cd "$(dirname "$0")"

cargo build --release

lib="target/release/libmad_dom_binding_spike.so"
out="index.node"

if [[ ! -f "$lib" ]]; then
  echo "spike build: expected cdylib output at $lib but it was not produced" >&2
  exit 1
fi

rm -f "$out"
cp "$lib" "$out"
echo "spike build: wrote $(pwd)/$out"
