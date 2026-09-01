// Compatibility ledger library (T11, ADR-0002 section 7).
//
// Pure validation/cross-check/summarization helpers for
// compat/ledger.json (the compatibility ledger), compat/upstream-map.json
// (upstream provenance for ported cases) and the differential runner's
// real-pair scenarios. The CLIs live in validate-ledger.js and
// ledger-report.js; tests inject fake readFile/exists so nothing here ever
// touches the filesystem.
//
// This module is side-effect free so that `bun --check` (which executes
// top-level code) stays safe, mirroring compat/public-api/compare-snapshot.js.

export const LEDGER_SCHEMA_VERSION = "1.0.0";
export const UPSTREAM_MAP_SCHEMA_VERSION = "1.0.0";

export const STATUSES = {
  PASS: "pass",
  KNOWN_GAP: "known-gap",
  NOT_APPLICABLE: "not-applicable",
};

export const SUITES = {
  API: "api",
  TYPES: "types",
  DIFF: "diff",
  UP: "up",
  HDUNIT: "hdunit",
};

// Fixed subsystem enumeration. Semantics:
//   core     — Rust kernel behavior (arena, DOM tree, mutation invariants);
//   bindings — the native binding surface between Rust and the JS facade;
//   facade   — the JS facade / Window-Document-Element public API surface;
//   types    — the TypeScript type surface (index.d.ts);
//   tooling  — the test infrastructure itself (runner, harness, ledger, CI).
export const SUBSYSTEMS = {
  CORE: "core",
  BINDINGS: "bindings",
  FACADE: "facade",
  TYPES: "types",
  TOOLING: "tooling",
};

// ADR-0002 section 1 pinned upstream commit; must stay identical to the
// PINNED constant in compat/validate-baseline.js.
export const PINNED_HAPPY_DOM_COMMIT = "64e2c774cadbb8eda5416c1e2bcca5006d1b5df9";

// happy-dom upstream is MIT-licensed; ported cases must keep that provenance.
export const UPSTREAM_LICENSE = "MIT";

export const LEDGER_ID_PATTERN = /^hc-(api|types|diff|up|hdunit)-[a-z0-9]+(?:-[a-z0-9]+)+$/;
// Identical ISO 8601 UTC rule as compat/validate-baseline.js.
export const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const HTTPS_URL = /^https:\/\/\S+$/;
export const GIT_COMMIT_SHA = /^[0-9a-f]{40}$/;

// Local files registered in upstream-map.json may only import the package
// entry (ADR-0002 section 2 exclusion list / ADR-0002 section 3): any
// reference to happy-dom private internals fails the provenance scan.
// Matching is done on a normalized copy of the file content: runs of path
// separators are canonicalized to single posix slashes and everything is
// lowercased, so backslash separators (single or escaped) and case variants
// cannot slip through. Entries exist with and without a trailing slash
// ("happy-dom/lib" also covers "happy-dom/lib/…"); "propertysymbol" is the
// lowercase form that catches both bare references and
// "happy-dom/PropertySymbol". Since T12 the hdunit vendored tests legitimately
// reference the LOCAL PropertySymbol shim (`tests/happy-dom/shim/src/
// PropertySymbol.js`), so validateUpstreamMap exempts the bare marker for
// hdunit entries (the local shim is a provided compat module, not a happy-dom
// private import); ported cases (suite "up") keep the full check.
const FORBIDDEN_LOCAL_IMPORTS = [
  "happy-dom/lib",
  "happy-dom/lib/",
  "happy-dom/es",
  "happy-dom/dist",
  "happy-dom/src",
  "propertysymbol",
];

const LEDGER_ROOT_FIELDS = ["schemaVersion", "note", "entries"];
const LEDGER_ENTRY_FIELDS = ["id", "suite", "status", "subsystem", "reason", "recordedAt", "addedIn"];
// Suite-specific entry fields: diff → scenario; types → fixture + diagnostics;
// up → upstreamRef; hdunit → vendorPath + enabled/expectedFail/skip coverage
// counts. The api suite has no extra fields: the snapshot comparison is a
// single whole-surface pass, finer per-export granularity is deferred.
//
// hdunit (ADR-0006): each subsystem is recorded as ONE `hc-hdunit-<subsystem>-
// coverage` summary entry carrying the split's enabled/expected-fail/skip
// counts (the per-file triage state lives in tests/happy-dom/triage/*.json,
// which is the truth source). `vendorPath` points at the triage split for a
// coverage entry and at the rewritten file for a per-file entry (created by
// waves when a file becomes enabled). Count fields are only meaningful on
// coverage entries; per-file entries omit them.
const SUITE_ENTRY_FIELDS = {
  [SUITES.API]: [],
  [SUITES.TYPES]: ["fixture", "diagnostics"],
  [SUITES.DIFF]: ["scenario"],
  [SUITES.UP]: ["upstreamRef"],
  [SUITES.HDUNIT]: ["vendorPath", "enabled", "expectedFail", "skip"],
};

// hdunit coverage entries follow the fixed `-coverage` id suffix convention
// (ADR-0006): `hc-hdunit-<subsystem>-coverage`. They are the subsystem-level
// summary entries; per-file hdunit entries (added by waves for enabled files)
// never use the suffix, which lets the cross-checks distinguish the two.
export function isHdunitCoverageEntry(entry) {
  return entry?.suite === SUITES.HDUNIT && typeof entry.id === "string" && entry.id.endsWith("-coverage");
}

const UPSTREAM_MAP_ROOT_FIELDS = ["schemaVersion", "note", "upstream", "entries"];
const UPSTREAM_FIELDS = ["repository", "commit", "license"];
const UPSTREAM_ENTRY_FIELDS = ["localId", "upstreamPath", "upstreamCommit", "license", "localPath"];

const STATUS_KEYS = {
  [STATUSES.PASS]: "pass",
  [STATUSES.KNOWN_GAP]: "knownGap",
  [STATUSES.NOT_APPLICABLE]: "notApplicable",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkKeys(problems, path, object, allowedKeys) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) {
      problems.push(`${path}.${key}: unknown field (schema forbids extra keys)`);
    }
  }
}

function isPosixRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    !value.includes("\\")
  );
}

// Validates the ledger document; returns a list of problems (empty = valid).
//
// Rules (ADR-0002 section 7): stable hc-<suite>-<capability>-<case> ids that
// are never reused; only gaps and not-applicable entries carry a reason and a
// recordedAt timestamp — pass entries must NOT explain themselves (a pass
// needs no justification, and a fabricated one would rot), so reason and
// recordedAt must be absent for pass.
export function validateLedger(manifest) {
  const problems = [];

  if (!isObject(manifest)) {
    problems.push("$: ledger must be a JSON object");
    return problems;
  }

  checkKeys(problems, "$", manifest, LEDGER_ROOT_FIELDS);

  if (manifest.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    problems.push(
      `$.schemaVersion: must be ${JSON.stringify(LEDGER_SCHEMA_VERSION)}, got ${JSON.stringify(manifest.schemaVersion)}`,
    );
  }
  if (manifest.note !== undefined && !isNonEmptyString(manifest.note)) {
    problems.push("$.note: must be a non-empty string when present");
  }
  if (!Array.isArray(manifest.entries)) {
    problems.push("$.entries: must be an array");
    return problems;
  }

  const seenIds = new Set();
  manifest.entries.forEach((entry, index) => {
    const at = `$.entries[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${at}: must be an object`);
      return;
    }

    // Own-property lookup only: a hostile suite value like "toString" must
    // not resolve through the prototype chain (schema errors have to be
    // reported, never thrown).
    const suiteFields = Object.hasOwn(SUITE_ENTRY_FIELDS, entry.suite) ? SUITE_ENTRY_FIELDS[entry.suite] : [];
    const allowedFields = [...LEDGER_ENTRY_FIELDS, ...suiteFields];
    checkKeys(problems, at, entry, allowedFields);

    const suite = entry.suite;
    if (!Object.values(SUITES).includes(suite)) {
      problems.push(`${at}.suite: must be one of ${JSON.stringify(Object.values(SUITES))}, got ${JSON.stringify(suite)}`);
    }

    if (!isNonEmptyString(entry.id)) {
      problems.push(`${at}.id: must be a non-empty string`);
    } else if (!LEDGER_ID_PATTERN.test(entry.id)) {
      problems.push(
        `${at}.id: must match hc-<suite>-<capability>-<case> in lowercase kebab-case ` +
          `(${LEDGER_ID_PATTERN}), got ${JSON.stringify(entry.id)}`,
      );
    } else if (isNonEmptyString(suite) && !entry.id.startsWith(`hc-${suite}-`)) {
      problems.push(`${at}.id: suite prefix must be "hc-${suite}-", got ${JSON.stringify(entry.id)}`);
    }
    if (isNonEmptyString(entry.id)) {
      if (seenIds.has(entry.id)) {
        problems.push(`${at}.id: ${JSON.stringify(entry.id)} is duplicated (ids are permanent and never reused)`);
      }
      seenIds.add(entry.id);
    }

    const status = entry.status;
    if (!Object.values(STATUSES).includes(status)) {
      problems.push(`${at}.status: must be one of ${JSON.stringify(Object.values(STATUSES))}, got ${JSON.stringify(status)}`);
    }

    if (!Object.values(SUBSYSTEMS).includes(entry.subsystem)) {
      problems.push(
        `${at}.subsystem: must be one of ${JSON.stringify(Object.values(SUBSYSTEMS))}, got ${JSON.stringify(entry.subsystem)}`,
      );
    }

    if (!isNonEmptyString(entry.addedIn)) {
      problems.push(`${at}.addedIn: must be a non-empty string (the TODO id that recorded the entry)`);
    }

    if (status === STATUSES.PASS) {
      if (entry.reason !== undefined) {
        problems.push(`${at}.reason: must be absent for status "pass" (only gaps carry a reason)`);
      }
      if (entry.recordedAt !== undefined) {
        problems.push(`${at}.recordedAt: must be absent for status "pass" (only gaps carry a record time)`);
      }
    } else if (Object.values(STATUSES).includes(status)) {
      if (!isNonEmptyString(entry.reason)) {
        problems.push(`${at}.reason: must be a non-empty string when status is ${JSON.stringify(status)}`);
      }
      if (!isNonEmptyString(entry.recordedAt)) {
        problems.push(`${at}.recordedAt: must be a non-empty ISO 8601 UTC timestamp when status is ${JSON.stringify(status)}`);
      } else if (!ISO_8601_UTC.test(entry.recordedAt)) {
        problems.push(
          `${at}.recordedAt: must be ISO 8601 with UTC designator "Z", got ${JSON.stringify(entry.recordedAt)}`,
        );
      } else if (Number.isNaN(Date.parse(entry.recordedAt))) {
        problems.push(`${at}.recordedAt: must be a parseable date, got ${JSON.stringify(entry.recordedAt)}`);
      }
    }

    if (suite === SUITES.DIFF) {
      // Real target-pair scenarios always produce an observable result on both
      // sides (errors are recorded observations too), so "not-applicable" has
      // no meaning for a diff scenario: only pass / known-gap are allowed.
      if (status !== STATUSES.PASS && status !== STATUSES.KNOWN_GAP) {
        problems.push(`${at}.status: diff entries only allow "pass" or "known-gap", got ${JSON.stringify(status)}`);
      }
      if (!isNonEmptyString(entry.scenario)) {
        problems.push(`${at}.scenario: must be a non-empty string (the runner scenario id)`);
      }
    } else if (suite === SUITES.TYPES) {
      if (!isNonEmptyString(entry.fixture)) {
        problems.push(`${at}.fixture: must be a non-empty posix path relative to fixtures/`);
      } else if (!isPosixRelativePath(entry.fixture)) {
        problems.push(`${at}.fixture: must be a posix relative path without ".." segments, got ${JSON.stringify(entry.fixture)}`);
      }
      if (status === STATUSES.KNOWN_GAP) {
        if (!Array.isArray(entry.diagnostics) || entry.diagnostics.length === 0) {
          problems.push(`${at}.diagnostics: must be a non-empty array when status is "known-gap"`);
        } else {
          entry.diagnostics.forEach((pattern, patternIndex) => {
            const atPattern = `${at}.diagnostics[${patternIndex}]`;
            if (!isObject(pattern)) {
              problems.push(`${atPattern}: must be an object`);
              return;
            }
            checkKeys(problems, atPattern, pattern, ["code", "messageIncludes", "line"]);
            if (pattern.code !== undefined && !(Number.isInteger(pattern.code) && pattern.code > 0)) {
              problems.push(`${atPattern}.code: must be a positive integer when present`);
            }
            if (pattern.line !== undefined && !(Number.isInteger(pattern.line) && pattern.line > 0)) {
              problems.push(`${atPattern}.line: must be a positive integer when present`);
            }
            if (pattern.messageIncludes !== undefined && !isNonEmptyString(pattern.messageIncludes)) {
              problems.push(`${atPattern}.messageIncludes: must be a non-empty string when present`);
            }
            if (
              pattern.code === undefined &&
              pattern.messageIncludes === undefined &&
              pattern.line === undefined
            ) {
              problems.push(`${atPattern}: must set at least one of code / messageIncludes / line`);
            }
          });
        }
      } else if (Object.values(STATUSES).includes(status) && entry.diagnostics !== undefined) {
        problems.push(`${at}.diagnostics: must be absent unless status is "known-gap"`);
      }
    } else if (suite === SUITES.UP) {
      if (!isNonEmptyString(entry.upstreamRef)) {
        problems.push(`${at}.upstreamRef: must be a non-empty string (the upstream-map localId)`);
      }
    } else if (suite === SUITES.HDUNIT) {
      if (!isNonEmptyString(entry.vendorPath)) {
        problems.push(
          `${at}.vendorPath: must be a non-empty posix path — the triage split for a "-coverage" entry, ` +
            "the rewritten file for a per-file entry",
        );
      } else if (!isPosixRelativePath(entry.vendorPath)) {
        problems.push(
          `${at}.vendorPath: must be a posix relative path without ".." segments, got ${JSON.stringify(entry.vendorPath)}`,
        );
      }
      for (const countField of ["enabled", "expectedFail", "skip"]) {
        if (entry[countField] !== undefined && !(Number.isInteger(entry[countField]) && entry[countField] >= 0)) {
          problems.push(`${at}.${countField}: must be a non-negative integer when present, got ${JSON.stringify(entry[countField])}`);
        }
      }
      // hdunit entries summarise a *declared* triage state (ADR-0006); the
      // per-file pass/fail evidence lives in the triage split and the live
      // run, so an hdunit ledger entry itself is always a "pass" bookkeeping
      // record — a gap/not-applicable here would be a misuse of the suite.
      if (status !== STATUSES.PASS) {
        problems.push(`${at}.status: hdunit entries must be "pass" (per-file state is recorded in the triage split)`);
      }
    }
  });

  return problems;
}

// Validates the upstream provenance map; returns a list of problems.
//
// `ledgerIds` is the set of ledger entry ids with suite "up"; `readFile` and
// `exists` are injected so this function stays filesystem-free (the CLI passes
// real implementations, tests pass fakes).
export function validateUpstreamMap(map, { ledgerIds, readFile, exists, suiteByLocalId }) {
  const problems = [];

  if (!isObject(map)) {
    problems.push("$: upstream map must be a JSON object");
    return problems;
  }

  checkKeys(problems, "$", map, UPSTREAM_MAP_ROOT_FIELDS);

  if (map.schemaVersion !== UPSTREAM_MAP_SCHEMA_VERSION) {
    problems.push(
      `$.schemaVersion: must be ${JSON.stringify(UPSTREAM_MAP_SCHEMA_VERSION)}, got ${JSON.stringify(map.schemaVersion)}`,
    );
  }
  if (map.note !== undefined && !isNonEmptyString(map.note)) {
    problems.push("$.note: must be a non-empty string when present");
  }

  const upstream = map.upstream;
  if (!isObject(upstream)) {
    problems.push("$.upstream: must be an object");
  } else {
    checkKeys(problems, "$.upstream", upstream, UPSTREAM_FIELDS);
    if (!isNonEmptyString(upstream.repository) || !HTTPS_URL.test(upstream.repository)) {
      problems.push(`$.upstream.repository: must be an https:// URL, got ${JSON.stringify(upstream.repository)}`);
    }
    if (upstream.commit !== PINNED_HAPPY_DOM_COMMIT) {
      problems.push(
        `$.upstream.commit: must equal the ADR-0002 section 1 pinned commit ` +
          `${JSON.stringify(PINNED_HAPPY_DOM_COMMIT)}, got ${JSON.stringify(upstream.commit)}`,
      );
    }
    if (upstream.license !== UPSTREAM_LICENSE) {
      problems.push(
        `$.upstream.license: happy-dom upstream is ${UPSTREAM_LICENSE}-licensed, got ${JSON.stringify(upstream.license)}`,
      );
    }
  }

  if (!Array.isArray(map.entries)) {
    problems.push("$.entries: must be an array");
    return problems;
  }

  const knownLedgerIds = ledgerIds instanceof Set ? ledgerIds : new Set(ledgerIds ?? []);
  const seenLocalIds = new Set();
  map.entries.forEach((entry, index) => {
    const at = `$.entries[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${at}: must be an object`);
      return;
    }

    checkKeys(problems, at, entry, UPSTREAM_ENTRY_FIELDS);

    if (!isNonEmptyString(entry.localId)) {
      problems.push(`${at}.localId: must be a non-empty string`);
    } else {
      if (seenLocalIds.has(entry.localId)) {
        problems.push(`${at}.localId: ${JSON.stringify(entry.localId)} is duplicated`);
      }
      seenLocalIds.add(entry.localId);
      if (!knownLedgerIds.has(entry.localId)) {
        problems.push(
          `${at}.localId: ${JSON.stringify(entry.localId)} has no matching suite="up" or suite="hdunit" entry ` +
            "in the compatibility ledger",
        );
      }
    }

    if (!isPosixRelativePath(entry.upstreamPath)) {
      problems.push(
        `${at}.upstreamPath: must be a non-empty posix path inside the happy-dom repository without ".." segments, ` +
          `got ${JSON.stringify(entry.upstreamPath)}`,
      );
    }

    if (!isNonEmptyString(entry.upstreamCommit) || !GIT_COMMIT_SHA.test(entry.upstreamCommit)) {
      problems.push(
        `${at}.upstreamCommit: must be a 40-character lowercase hex SHA-1, got ${JSON.stringify(entry.upstreamCommit)}`,
      );
    } else if (entry.upstreamCommit !== PINNED_HAPPY_DOM_COMMIT) {
      problems.push(
        `${at}.upstreamCommit: must equal the ADR-0002 section 1 pinned commit ` +
          `${JSON.stringify(PINNED_HAPPY_DOM_COMMIT)}, got ${JSON.stringify(entry.upstreamCommit)}`,
      );
    }

    if (entry.license !== UPSTREAM_LICENSE) {
      problems.push(`${at}.license: ported cases keep the upstream ${UPSTREAM_LICENSE} license, got ${JSON.stringify(entry.license)}`);
    }

    if (!isPosixRelativePath(entry.localPath)) {
      problems.push(
        `${at}.localPath: must be a non-empty posix path inside this repository without ".." segments, ` +
          `got ${JSON.stringify(entry.localPath)}`,
      );
    } else {
      let content = null;
      try {
        if (typeof exists === "function" && !exists(entry.localPath)) {
          problems.push(`${at}.localPath: file does not exist: ${JSON.stringify(entry.localPath)}`);
        } else if (typeof readFile === "function") {
          content = readFile(entry.localPath);
        }
      } catch (error) {
        problems.push(`${at}.localPath: cannot read file ${JSON.stringify(entry.localPath)}: ${error.message}`);
      }
      if (typeof content === "string") {
        // Scan the normalized copy: runs of backslashes fold into a single
        // posix slash (so escaped "happy-dom\\lib" forms cannot evade the
        // scan) and everything is lowercased (case variants cannot either).
        // hdunit vendored tests (T12) legitimately reference the local
        // PropertySymbol shim (`shim/src/PropertySymbol.js`), so the bare
        // "propertysymbol" marker is exempt for them; every other forbidden
        // marker (happy-dom/lib, …) still applies. Ported cases (suite "up")
        // keep the full check.
        const normalizedContent = content.replace(/\\+/g, "/").toLowerCase();
        const isHdunit = suiteByLocalId?.get(entry.localId) === "hdunit";
        for (const forbidden of FORBIDDEN_LOCAL_IMPORTS) {
          if (isHdunit && forbidden === "propertysymbol") continue;
          if (normalizedContent.includes(forbidden)) {
            problems.push(
              `${at}.localPath: must not reference happy-dom private internals (found ${JSON.stringify(forbidden)}); ` +
                "ported cases may only use the public package entry (ADR-0002 sections 2-3)",
            );
            break;
          }
        }
      }
    }
  });

  return problems;
}

// Cross-checks the ledger against the runner's real-pair scenarios, the type
// fixtures and the upstream map. Internal schemas are already validated by
// validateLedger / validateUpstreamMap; this function only wires the
// documents to each other and to the live test inventory.
export function crossValidateLedger({ ledger, upstreamMap, realPairScenarioIds, fixtureKeys }) {
  const problems = [];
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const diffEntries = entries.filter((entry) => entry.suite === SUITES.DIFF);
  const typesEntries = entries.filter((entry) => entry.suite === SUITES.TYPES);
  const upEntries = entries.filter((entry) => entry.suite === SUITES.UP);
  const mapEntries = Array.isArray(upstreamMap?.entries) ? upstreamMap.entries : [];

  const scenarioSet = new Set(realPairScenarioIds);
  const referenceCounts = new Map();
  for (const entry of diffEntries) {
    if (typeof entry.scenario === "string") {
      referenceCounts.set(entry.scenario, (referenceCounts.get(entry.scenario) ?? 0) + 1);
    }
  }

  for (const scenarioId of [...scenarioSet].sort()) {
    const count = referenceCounts.get(scenarioId) ?? 0;
    if (count === 0) {
      problems.push(
        `cross: real-pair scenario ${JSON.stringify(scenarioId)} is not referenced by any diff ledger entry ` +
          "(every real scenario must map onto exactly one hc-diff-* entry)",
      );
    } else if (count > 1) {
      problems.push(
        `cross: real-pair scenario ${JSON.stringify(scenarioId)} is referenced by ${count} diff ledger entries; exactly one required`,
      );
    }
  }

  for (const scenarioId of [...referenceCounts.keys()].sort()) {
    if (!scenarioSet.has(scenarioId)) {
      problems.push(
        `cross: diff ledger entry references scenario ${JSON.stringify(scenarioId)} which is not a real-pair runner scenario`,
      );
    }
  }

  const fixtureKeySet = new Set(fixtureKeys);
  for (const entry of typesEntries) {
    if (typeof entry.fixture === "string" && !fixtureKeySet.has(entry.fixture)) {
      problems.push(
        `cross: ${JSON.stringify(entry.id)} references fixture ${JSON.stringify(entry.fixture)} which does not exist under tests/compat/types/fixtures`,
      );
    }
  }

  const localIds = mapEntries.map((entry) => entry.localId).filter((localId) => typeof localId === "string");
  const localIdSet = new Set(localIds);
  // hdunit entries (ADR-0006): per-file entries are provenance-mappable exactly
  // like up entries (every enabled rewritten file registers an upstream-map
  // entry whose localId matches its per-file ledger id). Coverage ("-coverage")
  // entries are subsystem summaries; they are known ledger ids but are not
  // mapped to upstream-map entries — a map entry pointing at a coverage id is a
  // provenance inconsistency that the hdunit triage gate (validate-triage.mjs)
  // reports with exit 1, while a localId that is not in the ledger at all is a
  // cross-reference error caught here.
  const hdunitPerFileEntries = entries.filter((entry) => entry.suite === SUITES.HDUNIT && !isHdunitCoverageEntry(entry));
  const hdunitPerFileIds = new Set(hdunitPerFileEntries.map((entry) => entry.id));
  const hdunitKnownIds = new Set(entries.filter((entry) => entry.suite === SUITES.HDUNIT).map((entry) => entry.id));
  for (const entry of upEntries) {
    if (typeof entry.upstreamRef === "string" && !localIdSet.has(entry.upstreamRef)) {
      problems.push(
        `cross: ${JSON.stringify(entry.id)} references upstreamRef ${JSON.stringify(entry.upstreamRef)} ` +
          "which is not registered in compat/upstream-map.json",
      );
    }
  }
  for (const localId of [...localIdSet].sort()) {
    const hasUp = upEntries.some((entry) => entry.upstreamRef === localId);
    const hasHdunit = hdunitKnownIds.has(localId);
    if (!hasUp && !hasHdunit) {
      problems.push(
        `cross: upstream-map localId ${JSON.stringify(localId)} has no matching ledger entry ` +
          `(suite "up" or suite "hdunit"; bidirectional mapping required)`,
      );
    }
  }
  for (const localId of [...hdunitPerFileIds].sort()) {
    if (!localIdSet.has(localId)) {
      problems.push(
        `cross: hdunit ledger entry ${JSON.stringify(localId)} has no upstream-map entry ` +
          "(enabled hdunit files must register provenance)",
      );
    }
  }

  return problems;
}

// Deterministic status/subsystem/suite counts shared by the gate CLI and the
// report CLI (and their --json outputs).
export function summarizeLedger(ledger) {
  const emptyBucket = () => ({ entries: 0, pass: 0, knownGap: 0, notApplicable: 0 });
  const totals = emptyBucket();
  const bySubsystem = Object.fromEntries(Object.values(SUBSYSTEMS).map((name) => [name, emptyBucket()]));
  const bySuite = Object.fromEntries(Object.values(SUITES).map((name) => [name, emptyBucket()]));

  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    // Own-property lookups only: summarizeLedger is exported and must not
    // depend on callers having validated the schema first (a hostile
    // "toString" status/subsystem/suite must never resolve through the
    // prototype chain, and null entries must not crash the aggregation).
    if (!isObject(entry)) continue;
    const statusKey = Object.hasOwn(STATUS_KEYS, entry.status) ? STATUS_KEYS[entry.status] : undefined;
    if (statusKey === undefined) continue;
    totals.entries += 1;
    totals[statusKey] += 1;
    if (Object.hasOwn(bySubsystem, entry.subsystem)) {
      bySubsystem[entry.subsystem].entries += 1;
      bySubsystem[entry.subsystem][statusKey] += 1;
    }
    if (Object.hasOwn(bySuite, entry.suite)) {
      bySuite[entry.suite].entries += 1;
      bySuite[entry.suite][statusKey] += 1;
    }
  }

  return { totals, bySubsystem, bySuite };
}
