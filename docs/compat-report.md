# Compatibility report

mad-dom targets drop-in parity with happy-dom, measured against a single
locked baseline: **happy-dom 20.11.11**. Every number on this page is
reproducible with the commands shown.

## The contract: 100%

The core of compatibility is a black-box differential suite: every scenario
runs against both engines in isolated processes and the observable results are
compared verbatim.

- **180 / 180 scenarios match happy-dom exactly (100%)**
- **Zero known gaps** — no skipped, expected-fail or unexplained entries

```sh
bun run compat:differential
```

Tracked around the differential suite are further checks — type-level API
checks and ported upstream tests — currently at **448 / 448 pass with zero
known gaps**.

## The bigger picture: the happy-dom unit suite

The differential contract covers the surface we have committed to. To be
honest about coverage of the rest of happy-dom, we vendored its full unit-test
suite — 298 test files — and gave every file an explicit state:

| State | Files | Share |
| --- | --- | --- |
| Running green on mad-dom | 68 | 23% |
| Declared expected-fail | 22 | 7% |
| Skipped, with a recorded reason | 208 | 70% |

Nothing is silently missing: every file is accounted for. Reproduce:

```sh
bun run compat:hdunit:report
```

## WPT subset: a measurement, not a gate

As an independent signal we also run a small vendored slice of
web-platform-tests: currently **38 of 93 assertions pass (40.9%)** across
3 test files. This track only measures — it gates nothing and does not change
the happy-dom conclusions above.

```sh
bun run wpt:json
```

## In short

If a behavior is covered by the contract, it matches happy-dom 20.11.11
today. If it isn't covered yet, it is declared — as a known skip or an
expected-fail, never as a silent absence. The status is alpha either way; see
the [quick start](/quick-start).
