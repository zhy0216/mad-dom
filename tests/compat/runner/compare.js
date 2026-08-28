// Comparator for normalized differential records (T10).
//
// Contract: ADR-0002 section 5 (runner compares only AFTER normalization) and
// section 6 (difference reporting). The comparator walks two normalized
// records (mad-dom-diff-record/1, see normalize.js) and produces a sorted list
// of differences with precise paths:
//
//   { path: "errors[0].name",              kind: "changed",   left, right }
//   { path: "values.sync-mode",            kind: "changed",   left, right }
//   { path: "events[2].name",              kind: "changed",   left, right }
//   { path: "snapshots.tree.attributes.id", kind: "left-only", left, right: null }
//
// Path grammar: `.` between object keys, `[n]` between array items; the
// top-level segments are the record sections (values / snapshots / errors /
// descriptors / identity / events). Keys are the scenario-chosen labels.
//
// kinds:
//   "changed"   — both sides present, leaf values differ (recursion stops at
//                 the first differing level; nested structural differences
//                 surface as their own entries because arrays/objects recurse);
//   "left-only" — present on the left target, absent on the right;
//   "right-only"— present on the right target, absent on the left.
//
// Rules:
//   - normalized records are plain JSON data; equality is strict (===), so the
//     normalizer's markers ("~NaN" etc.) compare exactly;
//   - arrays are compared index by index up to the longer length — extra
//     elements on one side are left-only/right-only, so ORDER differences
//     surface as changed entries at the offending indices;
//   - object keys are the sorted union of both sides;
//   - the output is sorted by path (lexicographic) for determinism.
//
// The comparator never rewrites, trims or fuzzy-matches values — what it
// reports is exactly what the two sides produced.

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function diffValue(left, right, path, out) {
  if (Object.is(left, right)) return;

  if (Array.isArray(left) && Array.isArray(right)) {
    const maxLength = Math.max(left.length, right.length);
    for (let index = 0; index < maxLength; index += 1) {
      const childPath = `${path}[${index}]`;
      if (index >= left.length) {
        out.push({ path: childPath, kind: "right-only", left: null, right: right[index] });
      } else if (index >= right.length) {
        out.push({ path: childPath, kind: "left-only", left: left[index], right: null });
      } else {
        diffValue(left[index], right[index], childPath, out);
      }
    }
    return;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (!Object.hasOwn(left, key)) {
        out.push({ path: childPath, kind: "right-only", left: null, right: right[key] });
      } else if (!Object.hasOwn(right, key)) {
        out.push({ path: childPath, kind: "left-only", left: left[key], right: null });
      } else {
        diffValue(left[key], right[key], childPath, out);
      }
    }
    return;
  }

  out.push({ path: path === "" ? "$" : path, kind: "changed", left, right });
}

export function diffNormalizedRecords(leftRecord, rightRecord) {
  const differences = [];
  diffValue(leftRecord, rightRecord, "", differences);
  // The record schemas are fixed, so the "schema" segment never differs; strip
  // nothing — sorting keeps the report deterministic.
  differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return differences;
}
