// Portable copy of the independent coordinator control. Source/library paths
// are portable, every curve survives later failures, and the independent FFI
// digest uses a fresh same-Bun process instead of sharing injected C pressure.
// Parent lifecycle counters still must be zero in every RSS sample.
// Run from the repository root:
// mkdir -p build/07-integration
// cc -shared -fPIC docs/bun-native-runtime-evidence/native-rss-control.c -o build/07-integration/native-rss-control.so
// bun docs/bun-native-runtime-evidence/native-rss-control.mjs ./build/07-integration/native-rss-control.so
// Set MAD_DOM_NATIVE_PATH and MAD_DOM_FFI_PATH to this checkout's build/mad-dom.node.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dlopen, FFIType } from 'bun:ffi';
import { benchMemoryStability } from '../../scripts/bench-ffi-gc.mjs';
import { memoryGate } from '../../scripts/bench-memory-gate.mjs';

assert.equal(process.execPath, Bun.which('bun'));
assert.ok(process.argv[2], 'supply the compiled C helper path');
const lib = dlopen(process.argv[2], {
  retain_native_mb: { args: [], returns: FFIType.u32 },
  release_native_mb: { args: [], returns: FFIType.u32 },
});
let retained = 0;
let report;
let releasedBlocks;
try {
  const series = await benchMemoryStability({ afterRound(_index, measured) {
    if (!measured) return;
    assert.equal(lib.symbols.retain_native_mb(), ++retained);
  } });
  report = { control: 'native-malloc-page-touched', bunVersion: Bun.version,
    bunRevision: Bun.revision, execPath: process.execPath, retainedBytes: retained * 1048576, series };
  // Keep the native-only sensitivity experiment separate from the facade/FFI
  // finalizer activation. This is the same process isolation used by task 04's
  // strict digest tests. The inherited overrides select the same mad-dom image.
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../tests/bun/fixtures/ffi-memory-digest.mjs', import.meta.url))], { encoding: 'utf8', env: process.env, timeout: 30000 });
  const ffiEvidence = JSON.parse(output.match(/^MEMORY (\{.*\})$/m)?.[1] ?? 'null');
  assert.equal(ffiEvidence?.bunVersion, Bun.version);
  assert.equal(ffiEvidence?.bunRevision, Bun.revision);
  report.ffiEvidenceProcess = 'fresh same-Bun child; parent counters checked in every series sample';
  report.ffiEvidence = ffiEvidence;
  const result = memoryGate(series, ffiEvidence);
  report.result = result;
  assert.ok(result.rows.some(row => row.name.startsWith('memory_rss_') && row.status === 'FAIL'), 'RSS gate must detect retained native memory');
  assert.equal(result.rows.find(row => row.name === 'memory_lifecycle_counters').status, 'pass');
} finally {
  releasedBlocks = lib.symbols.release_native_mb();
  assert.equal(releasedBlocks, retained);
  lib.close();
  // Emit samples even when the sensitivity assertion fails.
  console.log(JSON.stringify({ ...report, releasedBlocks }, null, 2));
}
