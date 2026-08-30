#!/usr/bin/env bun
// Build-time platform matrix (T49 / ADR-0005 §2, §5).
//
// Single source of the triple → platform-package mapping used by the build,
// release and checksum scripts. The runtime loader (js/native-loader.js) keeps
// its own os/arch/libc → package-name mapping because it is shipped inside the
// installed package (which never contains scripts/); the install smoke test
// cross-checks the two agree for the host platform.
//
// Phase meanings (ADR-0005 §2):
//   phase 1 — first-batch platforms that must build + pass install smoke in
//     the alpha release rehearsal, except win32-x64 (alpha may omit it; it
//     must be ready from beta on);
//   phase 2 — second-batch platforms that must be ready before beta.

export const TRIPLE_MATRIX = {
  "aarch64-apple-darwin": { os: "darwin", arch: "arm64", libc: null, phase: 1 },
  "x86_64-apple-darwin": { os: "darwin", arch: "x64", libc: null, phase: 1 },
  "x86_64-unknown-linux-gnu": { os: "linux", arch: "x64", libc: "gnu", phase: 1 },
  "aarch64-unknown-linux-gnu": { os: "linux", arch: "arm64", libc: "gnu", phase: 1 },
  "x86_64-pc-windows-msvc": { os: "win32", arch: "x64", libc: null, phase: 1 },
  "x86_64-unknown-linux-musl": { os: "linux", arch: "x64", libc: "musl", phase: 2 },
  "aarch64-unknown-linux-musl": { os: "linux", arch: "arm64", libc: "musl", phase: 2 },
};

export function platformSegment(meta) {
  const base = `${meta.os}-${meta.arch}`;
  return meta.libc === null ? base : `${base}-${meta.libc}`;
}

export function platformPackageName(meta) {
  return `@mad-dom/platform-${platformSegment(meta)}`;
}

export function platformBinaryName(meta) {
  return `mad-dom.${platformSegment(meta)}.node`;
}

// Which platforms ship in a given release stage (ADR-0005 §2): alpha ships the
// first-batch platforms except win32-x64 (the one platform allowed to be absent
// until beta); beta and stable ship the full matrix (first + second batch).
export function stagePlatformNames(stage) {
  const triples = Object.keys(TRIPLE_MATRIX);
  const filtered = triples.filter((triple) => {
    const meta = TRIPLE_MATRIX[triple];
    if (stage === "alpha") {
      if (meta.phase === 2) return false;
      if (meta.os === "win32") return false;
    }
    return true;
  });
  return filtered.map((triple) => platformPackageName(TRIPLE_MATRIX[triple]));
}

export function binaryExtension(meta) {
  switch (meta.os) {
    case "darwin":
      return "dylib";
    case "linux":
      return "so";
    case "win32":
      return "dll";
    default:
      throw new Error(`unknown os in matrix: ${meta.os}`);
  }
}

export function cdylibOutputName(triple) {
  const meta = TRIPLE_MATRIX[triple];
  if (meta === undefined) throw new Error(`triple not in the supported matrix: ${triple}`);
  if (meta.os === "win32") return "mad_dom_bun.dll";
  return `libmad_dom_bun.${binaryExtension(meta)}`;
}
