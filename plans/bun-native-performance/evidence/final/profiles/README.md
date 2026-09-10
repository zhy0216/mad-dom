# profiles/

CPU-profile capture output for the two diagnostic profile batches (raw/adapter/facade,
source-on, 6 processes per batch), run after the formal campaigns inside the same
sampling reservation. Diagnostics only: no speedup or ratio is derived from them.

- `INDEX.json` — every local `*.cpuprofile` (path, bytes, SHA-256) bound to its
  committed batch record (`../profile-baseline/`, `../profile-latest/`), attempt
  exit, side, runtime version/revision and protocol.
- The binaries themselves are excluded by `../.gitignore` per the 01–03 evidence
  precedent (the main tree tracks zero `*.cpuprofile`); the committed records are
  the report JSON, per-attempt metadata, per-endpoint path audits and manifests.

See [conclusion.md](../conclusion.md) §6 and [../../results.md](../../../results.md) §6.
