#!/usr/bin/env bash
# T19 dev build: compile the production native binding (`mad-dom-bun`) for the
# local triple and expose it at <repo>/build/mad-dom.node, where the dev-entry
# loader in index.js looks for it (ADR-0005 §3: dev flow).
#
# Re-runnable: safe to execute any number of times; always rebuilds from the
# current sources and replaces the artifact. The artifact and `target/` are
# git-ignored (build/, *.node, target/ in the root .gitignore).
#
# Scope: local development only. No cross-compilation, no packaging, no npm
# artifacts — the release matrix and packaging are owned by T49 (ADR-0005 §3).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root/crates/mad-dom-bun"

cargo build --release -p mad-dom-bun

case "$(uname -s)" in
  Darwin) lib="$repo_root/target/release/libmad_dom_bun.dylib" ;;
  Linux) lib="$repo_root/target/release/libmad_dom_bun.so" ;;
  MINGW* | MSYS* | CYGWIN*) lib="$repo_root/target/release/mad_dom_bun.dll" ;;
  *)
    echo "dev build: unsupported platform $(uname -s)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$lib" ]]; then
  echo "dev build: expected cdylib at $lib but it was not produced" >&2
  exit 1
fi

mkdir -p "$repo_root/build"
rm -f "$repo_root/build/mad-dom.node"
cp "$lib" "$repo_root/build/mad-dom.node"
echo "dev build: wrote $repo_root/build/mad-dom.node"
