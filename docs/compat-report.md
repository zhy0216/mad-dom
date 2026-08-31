# MAD DOM compatibility report

This report is the machine-checkable compatibility snapshot for the stable
gate (T50). It is generated from the repository's own gates — nothing here is
hand-written; every number is reproducible with the commands shown.

- Baseline: happy-dom `20.11.11` @ commit `64e2c774…` on Bun `1.4.0`
  (ADR-0002 §1, recorded in `compat/happy-dom-baseline.json`).
- Gate: `npm run validate` runs `compat:types` (type harness), `compat:ledger`
  (schema + cross-checks + live differential regression) and `wpt:test`
  (separate WPT measurement track).

## happy-dom compatibility (the contract)

The happy-dom compatibility contract is owned by the differential runner
(`tests/compat/runner`, ADR-0002 §5) and the ledger (`compat/ledger.json`,
ADR-0002 §7). Reproduce:

```sh
npm run compat:differential     # live black-box differential over every scenario
npm run compat:ledger           # schema + cross-check + pass-regression gate
bun compat/ledger-report.js --json   # offline summary
```

Result (regenerated for this report):

| Suite | Entries | pass | known-gap | not-applicable | Rate |
| --- | --- | --- | --- | --- | --- |
| types (type fixture) | 10 | 10 | 0 | 0 | 100% |
| diff (black-box differential) | 33 | 33 | 0 | 0 | 100% |
| api (snapshot) | 0 | 0 | 0 | 0 | — |
| up (ported upstream) | 0 | 0 | 0 | 0 | — |
| **total** | **43** | **43** | **0** | **0** | **100%** |

Stable condition: **the locked happy-dom compatibility suite is at 100% pass
with zero known-gap and zero not-applicable entries** — no skipped, expected-
fail, or unexplained gap remains (ADR-0001 plan §4 stable gate).

The `api` suite has zero entries because the public-API surface comparison is a
single whole-surface snapshot (`compat/public-api/snapshot.json`) rather than
per-scenario entries; the snapshot is validated by `compat:snapshot:test`
(part of `tests/compat`). `up` has zero ported cases because no upstream
happy-dom test is currently vendored; when a case is ported it is recorded in
`compat/upstream-map.json` with its provenance (ADR-0002 §7.4).

## WPT subset (separate measurement, not a gate)

The vendored web-platform-tests subset (T48) is a **separate statistics
track** (ADR-0002 §8): its pass rate is reported independently and never
changes the happy-dom compatibility conclusions above.

```sh
npm run wpt:test    # human report
npm run wpt:json    # machine-readable
```

Result (regenerated for this report): 3 cases, 37 pass / 56 fail / 0 error,
93 assertions, pass rate 39.8%. This is a measurement track only — it
supplements happy-dom where its behavior is unclear and is not a stable gate.

## Upstream attribution

- **happy-dom** (compatibility baseline): the differential targets, baseline
  manifest and (future) ported cases anchor to the pinned upstream commit
  `64e2c774cadbb8eda5416c1e2bcca5006d1b5df9` (`v20.11.11`), MIT licensed.
  `compat/upstream-map.json` records per-case provenance; `compat/validate-ledger.js`
  mechanically rejects any vendored file that touches happy-dom private
  internals.
- **web-platform-tests** (WPT subset): `tests/wpt/manifest.json` pins the
  upstream repository and commit `81841cc6e29ed4d57173f8b6dd0b736096c0bb58`,
  BSD-3-Clause, and maps every vendored case under `tests/wpt/cases/` to its
  upstream path. See `tests/wpt/README.md`.
- **Rust ecosystem** (build/runtime dependencies): the HTML parser (html5ever,
  MIT OR Apache-2.0), selector engine (selectors, MPL-2.0) and cssparser
  (MPL-2.0) are used as unmodified dependencies; adaptation code lives in
  `crates/mad-dom-core/src/{html,selectors}`. Licensing is recorded in the
  crate manifests and `LICENSE`.
