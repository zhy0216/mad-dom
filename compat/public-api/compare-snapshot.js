// Comparator for public API snapshots (T08, ADR-0002 section 3).
//
// Compares two snapshot documents (as written by generate-snapshot.js or
// produced from synthetic modules in tests) and classifies every difference
// using the four fixed categories from ADR-0002:
//
//   missing        - present in expected, absent in actual (hard failure)
//   extra          - present in actual, absent in expected (recorded, visible;
//                    not a hard failure by default per ADR-0002 section 3)
//   shape-mismatch - structural difference: typeof/category, prototype chains,
//                    descriptor shapes, member name sets, counts, meta fields
//   value-mismatch - difference in a serialized value (enum/constant values,
//                    primitive export values, instance serializable defaults)
//
// Symbol-keyed data (fields `staticSymbols`, `prototypeSymbols`,
// `instanceSymbols`, `symbols`, `symbolValues`) is INFORMATIONAL per
// ADR-0002 section 2: differences there are reported with
// `informational: true` and do not fail the comparison unless strict mode
// is requested (see compare-snapshot-cli.js --strict).
//
// This module is side-effect free so that `bun --check` (which executes
// top-level code) stays safe; the CLI lives in compare-snapshot-cli.js.

export const CATEGORY = {
  MISSING: "missing",
  EXTRA: "extra",
  SHAPE_MISMATCH: "shape-mismatch",
  VALUE_MISMATCH: "value-mismatch",
};

export const DIFFERENCE_CATEGORIES = Object.values(CATEGORY);

// Path segments below which scalar differences are value differences.
const VALUE_FIELDS = new Set(["value", "values", "instanceDefaults", "items"]);

// Path segments that carry informational (symbol) data.
const INFORMATIONAL_FIELDS = new Set([
  "staticSymbols",
  "prototypeSymbols",
  "instanceSymbols",
  "symbols",
  "symbolValues",
]);

export function isInformationalPath(path) {
  return path.split(".").some((segment) => INFORMATIONAL_FIELDS.has(segment));
}

export function compareSnapshots(expected, actual, { strict = false } = {}) {
  const differences = [];
  walk(expected, actual, "$", false);
  differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const hard = differences.filter((difference) => !difference.informational);
  const informational = differences.filter((difference) => difference.informational);
  const ok = strict ? differences.length === 0 : hard.length === 0;

  return { ok, differences, hard, informational, strict };

  function walk(expectedValue, actualValue, path, valueContext) {
    const expectedIsObject = isPlainRecord(expectedValue);
    const actualIsObject = isPlainRecord(actualValue);

    if (expectedIsObject && actualIsObject) {
      const keys = unionSorted(Object.keys(expectedValue), Object.keys(actualValue));
      for (const key of keys) {
        const childPath = `${path}.${key}`;
        const inExpected = Object.hasOwn(expectedValue, key);
        const inActual = Object.hasOwn(actualValue, key);
        if (!inActual) {
          push(childPath, CATEGORY.MISSING, preview(expectedValue[key]), undefined);
        } else if (!inExpected) {
          push(childPath, CATEGORY.EXTRA, undefined, preview(actualValue[key]));
        } else {
          walk(
            expectedValue[key],
            actualValue[key],
            childPath,
            valueContext || VALUE_FIELDS.has(key),
          );
        }
      }
      return;
    }

    if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
      if (expectedValue.length !== actualValue.length) {
        push(
          `${path}.length`,
          CATEGORY.SHAPE_MISMATCH,
          expectedValue.length,
          actualValue.length,
        );
      }
      const shared = Math.min(expectedValue.length, actualValue.length);
      for (let index = 0; index < shared; index++) {
        walk(expectedValue[index], actualValue[index], `${path}[${index}]`, valueContext);
      }
      return;
    }

    if (expectedValue === null || actualValue === null) {
      if (expectedValue !== actualValue) {
        push(path, CATEGORY.SHAPE_MISMATCH, preview(expectedValue), preview(actualValue));
      }
      return;
    }

    if (typeof expectedValue !== typeof actualValue) {
      push(path, CATEGORY.SHAPE_MISMATCH, preview(expectedValue), preview(actualValue));
      return;
    }

    if (!Object.is(expectedValue, actualValue)) {
      push(
        path,
        valueContext ? CATEGORY.VALUE_MISMATCH : CATEGORY.SHAPE_MISMATCH,
        preview(expectedValue),
        preview(actualValue),
      );
    }
  }

  function push(path, category, expectedValue, actualValue) {
    differences.push({
      path,
      category,
      informational: isInformationalPath(path),
      expected: expectedValue,
      actual: actualValue,
    });
  }
}

export function countByCategory(differences) {
  const counts = {};
  for (const difference of differences) {
    counts[difference.category] = (counts[difference.category] ?? 0) + 1;
  }
  return counts;
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unionSorted(a, b) {
  const set = new Set([...a, ...b]);
  return [...set].sort();
}

function preview(value) {
  if (value === undefined) {
    return undefined;
  }
  const json = JSON.stringify(value);
  if (json === undefined) {
    return String(value);
  }
  return json.length <= 160 ? json : `${json.slice(0, 157)}...`;
}
