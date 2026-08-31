# happy-dom test-suite vendor scan (hdunit T01)

Generated at: 2026-08-31T14:20:49.054Z
Upstream: https://github.com/capricorn86/happy-dom @ tag v20.11.11 (commit 64e2c774cadbb8eda5416c1e2bcca5006d1b5df9, MIT)
Upstream checkout used: /Users/yang/workspace/happy-dom
shimPath base (frozen contract for T02/T03/T04): `tests/happy-dom/shim/src/` — every mappable `src/` module gets `tests/happy-dom/shim/src/<srcPath>`; not-mappable modules are `null` with a reason category.

## 概览 (Overview)

| Metric | Value |
| --- | --- |
| Vendored files (packages/happy-dom/test/) | 352 |
| Vendored lines | 100375 |
| Source files scanned (.ts/.js) | 335 |
| Test files (*.test.ts) | 298 |
| Distinct internal `src/` module paths | 367 |
| Mappable `src/` module paths | 187 |
| Not-mappable `src/` module paths | 180 |
| Files with all runtime `src/` imports mappable (all source files) | 138 |
| Files with all runtime `src/` imports mappable (*.test.ts) | 103 |

## Import classification (statements)

| Kind | Count |
| --- | --- |
| src-runtime | 1177 |
| src-type | 460 |
| local-helper | 51 |
| vitest-api | 301 |
| external | 59 |
| **total** | **2048** |

## 口径说明 (Scope note)

Figures above are computed from the actual `v20.11.11` tree (298 `*.test.ts`, 352 files). The queue's pre-scan ballpark (~492 internal paths / ~265 mappable / ~104 files) was measured against a slightly newer upstream snapshot (`~302` test files) and is not authoritative; this scan is. Mappability ratios are consistent (51% of internal paths mappable).

## Not-mappable `src/` paths by reason category

| Reason | Paths |
| --- | --- |
| internal-class | 127 |
| internal-enum | 18 |
| internal-utility | 16 |
| internal-type | 8 |
| internal-other | 4 |
| internal-parser | 4 |
| internal-config | 3 |

## vi API distribution (files importing each API from vitest)

| API | Files |
| --- | --- |
| vi | 59 |
| afterEach | 43 |
| describe | 300 |
| it | 300 |
| expect | 300 |
| beforeEach | 272 |
| beforeAll | 1 |

## Mapping rule (frozen)

A vendored `src/` module path is **mappable** iff it is re-exported by the public entry `src/index.ts` (value or type export), or is the entry itself (`src/index.js`). For mappable modules `shimPath` equals the canonical module path under `tests/happy-dom/shim/src/`; T04 generates a re-export shim there. Not-mappable modules get `shimPath: null` and a reason category (`internal-*`).

Machine-readable manifest: `tests/happy-dom/vendor-scan.json`.
