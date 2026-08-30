// Public package entry (T22 gate, extended by T23/T24).
//
// The single source of the runtime surface lives in js/entry.js; this file
// only re-exports it, so the entry can never drift from the facade wiring
// (see js/facade/CONTRACT.md). The type surface lives in index.d.ts, the
// single source for declarations.
export * from "./js/entry.js";
