# Compatibility report

mad-dom targets drop-in parity with happy-dom, measured against a single
locked baseline: **happy-dom 20.11.11**. The figures below are repository
coverage records; use the commands shown to reproduce or refresh each track.
Run them from a source checkout after `bun install --frozen-lockfile` and
`bun run dev:build`. Set `MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"` when
you need to guarantee that the freshly built native module is used.

## The contract: 100%

The core of compatibility is a black-box differential suite: every scenario
runs against both engines in isolated processes and the observable results are
compared verbatim.

- **180 / 180 differential scenarios are recorded as passing (100%)**
- No `known-gap` or `not-applicable` entries in that recorded contract

```sh
bun run compat:differential
```

The ledger records **448 / 448 entries as passing**, split as follows:

| Track | Recorded entries | Meaning |
| --- | ---: | --- |
| `diff` | 180 | Differential scenarios |
| `types` | 10 | Type-level checks |
| `up` | 147 | Ported upstream checks |
| `hdunit` | 111 | Upstream-unit coverage bookkeeping |

Ledger entries are not interchangeable with individual test assertions or
fully passing upstream files. In particular, the `hdunit` bookkeeping does
not mean the full upstream suite passes. Inspect the recorded status with
`bun run compat:ledger:report`; `bun run compat:ledger` performs validation.

## The bigger picture: the happy-dom unit suite

The differential contract covers the surface we have committed to. To be
honest about coverage of the rest of happy-dom, we vendored its full unit-test
suite — 298 test files — and gave every file an explicit state:

| State | Files | Share |
| --- | --- | --- |
| Running green on mad-dom | 68 | 23% |
| Declared expected-fail | 22 | 7% |
| Skipped, with a recorded reason | 208 | 70% |

Every vendored file has a triage state. Regenerate the coverage report with:

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

## Known behavior gaps outside the recorded contract

A passing contract verifies its assertions; it does not prove all behaviors
of a named API. The documentation review identified gaps in cancellation,
cleanup ownership, task waiting, script execution on navigation, and settings
wiring. They are recorded in the
[Browser lifecycle and settings repair plan](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md).
The existing ledger has not yet been expanded to cover these findings.

For current behavior, see [Async work and cleanup](/async),
[Configuration](/configuration), and [Browser](/browser). For example,
Window and Browser lifecycle now share cancellation, waiting and scoped cleanup.
Classic scripts execute on opted-in content/navigation paths. Full child-frame,
module and automatic CSS/image loading remain deferred; see the
[lifecycle results](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/results.md).

## Which checks to use

| Question | Check |
| --- | --- |
| Do selected public observations match the pinned engine? | `bun run compat:differential` |
| Do the declared types satisfy the tracked contract? | `bun run compat:types` |
| Are ledger and triage records consistent? | `bun run compat:ledger`, `bun run compat:hdunit:validate` |
| How much of the vendored unit suite is enabled? | `bun run compat:hdunit:report` |
| How does the separate WPT subset behave? | `bun run wpt:json` |
| Are the benchmark workloads correct and faster? | `bun run bench:dom` — see [Performance](/performance) |

Benchmark validity, type coverage, upstream-file coverage, and standards
conformance answer different questions. For a migration, run your application's
own assertions too; the [migration guide](/migration) identifies the paths
that need particular attention.
