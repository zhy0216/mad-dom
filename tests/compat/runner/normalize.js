// Result normalizer for the black-box differential runner (T10).
//
// Contract: ADR-0002 section 6 (结果规范化格式). This file is a
// version-controlled protocol artifact: any change here is a protocol change,
// must be an independent commit with a stated motivation, and must never be
// made to turn a failing comparison into a passing one.
//
// ═══════════════════════════════════════════════════════════════════════════
// Normalization rules (also documented in tests/compat/runner/README.md)
// ═══════════════════════════════════════════════════════════════════════════
//
// The normalizer only performs deterministic normalization: classification,
// sorting and stable serialization. It never merges unequal observations into
// equal ones (no fuzzing, no trimming, no case folding, no message rewriting).
//
// 1. Raw values (normalizeValue) — every value becomes { type, ... }:
//      null                → { type: "null" }
//      undefined           → { type: "undefined" }
//      boolean             → { type: "boolean", value }
//      string              → { type: "string", value }        (verbatim)
//      number              → { type: "number", value } where value is the
//                            number itself, or the markers "~NaN",
//                            "~Infinity", "~NegativeInfinity", "~NegativeZero"
//      bigint              → { type: "bigint", value: "<decimal digits>" }
//      symbol              → { type: "symbol", description }  (description only)
//      function            → { type: "function", name, length }
//      array               → { type: "array", items: [...] }  (order kept)
//      Date                → { type: "date", value: "<ISO>" | "~invalid-date" }
//      RegExp              → { type: "regexp", value: String(re) }
//      Error               → { type: "error", name, message } (verbatim)
//      Promise             → { type: "promise" }
//      Map                 → { type: "map", entries: [[k, v]...] }  (sorted)
//      Set                 → { type: "set", items: [...] }          (sorted)
//      other object        → { type: "object", entries: {...} } over own
//                            enumerable string-keyed properties; keys sorted;
//                            symbol-keyed properties are informational only
//                            and skipped (ADR-0002 section 2); throwing
//                            getters yield { type: "getter-threw", name, message }
//      circular reference  → { type: "reference", id: n } where n is the
//                            1-based first-visit order of the object
//      depth > 64          → { type: "truncated" }
//    Sorting keys uses default UTF-16 code-unit order (<).
//
// 2. DOM/HTML snapshots (captureSnapshot + normalizeSnapshot): captureSnapshot
//    runs eagerly in the probe process against the LIVE node and produces a
//    plain-data dump:
//      { nodeType, nodeName, namespaceURI, attributes, data, children,
//        outerHTML? }
//    attributes are collected via the NamedNodeMap surface (length + item(i))
//    or null when the node has none; data carries Text/Comment character data;
//    children recurse over childNodes in document order (NOT sorted — tree
//    order is the signal). Snapshot leaves are PLAIN VERBATIM strings
//    ("以原文比较"): attribute values, data and outerHTML are compared as-is;
//    a non-string attribute value is classified visibly via normalizeValue
//    instead of being coerced. outerHTML is captured only at the snapshot
//    root. normalizeSnapshot sorts attribute maps by name. Depth cap 64;
//    deeper nodes get truncated: true. nodeType stays a plain number.
//
// 3. Exceptions (normalizeError): { name, message, phase } — name and message
//    are compared verbatim (no fuzzing, no path stripping); phase is the
//    scenario-declared throw phase string ("setup", "sync-throw",
//    "promise-rejection", "callback", ... — vocabulary recommended in
//    protocol.js, any non-empty string accepted). Errors stay in recording
//    order (order is part of the observation).
//
// 4. Property descriptors (normalizeDescriptor): { present, writable,
//    enumerable, configurable, hasGet, hasSet }. For accessors writable is
//    null; a missing own property normalizes to { present: false }. Function
//    values are never invoked or serialized here — descriptors only carry
//    shape flags.
//
// 5. Object identity (api.record.identity(label, a, b)): a sorted map
//    label → boolean (Object.is). Labels must be unique per scenario; the
//    sorted map is the "布尔关系表" of ADR-0002 section 6.6.
//
// 6. Events (api.record.event(name, detail)): an ordered list of
//    { name, detail } — order is the observation and is never sorted; detail
//    goes through normalizeValue.
//
// 7. Ordering summary: keyed segments (values, snapshots, descriptors,
//    identity) are SORTED by key for determinism; ordered segments (events,
//    errors) and tree children keep recording/document order. All object keys
//    inside normalized values are sorted.
//
// 8. Single normalization point: normalization runs ONCE, inside the probe
//    process, right after the scenario completes (raw values may contain
//    symbols/bigints/cycles that cannot survive JSON transport). The parent
//    runner validates the envelope schema but never re-interprets normalized
//    data, so a comparison input has exactly one code path.
// ═══════════════════════════════════════════════════════════════════════════

export const RECORD_SCHEMA = "mad-dom-diff-record/1";

const MAX_DEPTH = 64;
const MARKERS = {
  NaN: "~NaN",
  POSITIVE_INFINITY: "~Infinity",
  NEGATIVE_INFINITY: "~NegativeInfinity",
  NEGATIVE_ZERO: "~NegativeZero",
  INVALID_DATE: "~invalid-date",
};

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── raw values ──────────────────────────────────────────────────────────────

function normalizeNumber(value) {
  if (Number.isNaN(value)) return { type: "number", value: MARKERS.NaN };
  if (value === Number.POSITIVE_INFINITY) return { type: "number", value: MARKERS.POSITIVE_INFINITY };
  if (value === Number.NEGATIVE_INFINITY) return { type: "number", value: MARKERS.NEGATIVE_INFINITY };
  if (Object.is(value, -0)) return { type: "number", value: MARKERS.NEGATIVE_ZERO };
  return { type: "number", value };
}

function normalizeValue(value, state) {
  if (state.depth > MAX_DEPTH) return { type: "truncated" };
  if (value === null) return { type: "null" };
  switch (typeof value) {
    case "undefined":
      return { type: "undefined" };
    case "boolean":
      return { type: "boolean", value };
    case "number":
      return normalizeNumber(value);
    case "string":
      return { type: "string", value };
    case "bigint":
      return { type: "bigint", value: value.toString() };
    case "symbol":
      return { type: "symbol", description: value.description ?? null };
    case "function":
      return {
        type: "function",
        name: typeof value.name === "string" ? value.name : "",
        length: typeof value.length === "number" ? value.length : 0,
      };
    case "object":
      break;
    default:
      return { type: "unknown", typeOf: String(typeof value) };
  }

  if (state.refs.has(value)) return { type: "reference", id: state.refs.get(value) };
  state.refs.set(value, state.refs.size + 1);
  state.depth += 1;
  try {
    if (Array.isArray(value)) {
      return { type: "array", items: value.map((item) => normalizeValue(item, state)) };
    }
    if (value instanceof Date) {
      return {
        type: "date",
        value: Number.isNaN(value.getTime()) ? MARKERS.INVALID_DATE : value.toISOString(),
      };
    }
    if (value instanceof RegExp) {
      return { type: "regexp", value: value.toString() };
    }
    if (value instanceof Error) {
      return {
        type: "error",
        name: typeof value.name === "string" ? value.name : null,
        message: typeof value.message === "string" ? value.message : String(value.message),
      };
    }
    if (value instanceof Promise) {
      return { type: "promise" };
    }
    if (value instanceof Map) {
      const entries = [];
      for (const [key, entryValue] of value) {
        entries.push([normalizeValue(key, state), normalizeValue(entryValue, state)]);
      }
      entries.sort((a, b) => compareStrings(JSON.stringify(a[0]), JSON.stringify(b[0])));
      return { type: "map", entries };
    }
    if (value instanceof Set) {
      const items = [...value].map((item) => normalizeValue(item, state));
      items.sort((a, b) => compareStrings(JSON.stringify(a), JSON.stringify(b)));
      return { type: "set", items };
    }
    const entries = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      let entryValue;
      try {
        entryValue = value[key];
      } catch (error) {
        entries[key] = {
          type: "getter-threw",
          name: typeof error?.name === "string" ? error.name : null,
          message: typeof error?.message === "string" ? error.message : String(error?.message ?? error),
        };
        continue;
      }
      entries[key] = normalizeValue(entryValue, state);
    }
    return { type: "object", entries };
  } finally {
    state.depth -= 1;
  }
}

export function normalizeValueTop(value) {
  return normalizeValue(value, { refs: new Map(), depth: 0 });
}

// ── DOM/HTML snapshots ──────────────────────────────────────────────────────

function captureAttributes(node) {
  const attributes = node.attributes;
  if (attributes == null || typeof attributes !== "object") return null;
  const length = typeof attributes.length === "number" ? attributes.length : 0;
  if (length === 0 && typeof attributes.item !== "function") return null;
  const map = {};
  for (let index = 0; index < length; index += 1) {
    const attribute = typeof attributes.item === "function" ? attributes.item(index) : attributes[index];
    if (attribute == null) continue;
    map[attribute.name] = attribute.value;
  }
  return map;
}

// Eagerly captures a live DOM subtree as plain JSON-safe data. Uses only the
// public DOM surface (nodeType, nodeName, namespaceURI, attributes, data,
// childNodes, outerHTML). Tree order is preserved; attributes are sorted by
// normalizeSnapshot afterwards.
export function captureSnapshot(node, { depth = 0 } = {}) {
  if (node == null || typeof node !== "object") {
    return { invalid: true, reason: "snapshot target is not an object node" };
  }
  const captured = {
    nodeType: typeof node.nodeType === "number" ? node.nodeType : null,
    nodeName: typeof node.nodeName === "string" ? node.nodeName : null,
    namespaceURI: typeof node.namespaceURI === "string" ? node.namespaceURI : null,
    attributes: captureAttributes(node),
    data: typeof node.data === "string" ? node.data : null,
    children: [],
  };
  if (depth >= MAX_DEPTH) {
    captured.truncated = true;
    return captured;
  }
  const childNodes = node.childNodes;
  if (childNodes != null && typeof childNodes === "object" && typeof childNodes.length === "number") {
    for (let index = 0; index < childNodes.length; index += 1) {
      captured.children.push(captureSnapshot(childNodes[index], { depth: depth + 1 }));
    }
  }
  if (depth === 0) {
    captured.outerHTML = typeof node.outerHTML === "string" ? node.outerHTML : null;
  }
  return captured;
}

function normalizeCapturedAttributes(attributes) {
  if (attributes == null || typeof attributes !== "object" || Array.isArray(attributes)) return null;
  const normalized = {};
  for (const name of Object.keys(attributes).sort(compareStrings)) {
    const value = attributes[name];
    // Attribute values are verbatim strings ("以原文比较"); a non-string
    // value is an implementation defect and is classified visibly instead of
    // being coerced (a String() coercion would merge real differences).
    normalized[name] = typeof value === "string" ? value : normalizeValueTop(value);
  }
  return normalized;
}

export function normalizeSnapshot(captured) {
  if (captured == null || typeof captured !== "object") {
    return { invalid: true, reason: "snapshot record is not an object" };
  }
  const normalized = {
    nodeType: typeof captured.nodeType === "number" ? captured.nodeType : null,
    nodeName: typeof captured.nodeName === "string" ? captured.nodeName : null,
    namespaceURI: typeof captured.namespaceURI === "string" ? captured.namespaceURI : null,
    attributes: normalizeCapturedAttributes(captured.attributes),
    data: typeof captured.data === "string" ? captured.data : null,
    children: Array.isArray(captured.children) ? captured.children.map((child) => normalizeSnapshot(child)) : [],
  };
  if (captured.truncated === true) normalized.truncated = true;
  if (captured.invalid === true) normalized.invalid = true;
  if (Object.hasOwn(captured, "outerHTML")) {
    normalized.outerHTML = typeof captured.outerHTML === "string" ? captured.outerHTML : null;
  }
  return normalized;
}

// ── exceptions ──────────────────────────────────────────────────────────────

export function normalizeError(error, phase) {
  const name = error != null && typeof error === "object" && typeof error.name === "string" ? error.name : null;
  const message =
    error == null
      ? String(error)
      : typeof error === "object" && typeof error.message === "string"
        ? error.message
        : String(error);
  return { name, message, phase: String(phase) };
}

// ── property descriptors ────────────────────────────────────────────────────

export function normalizeDescriptor(descriptor) {
  if (descriptor == null || typeof descriptor !== "object") return { present: false };
  const hasGet = descriptor.get !== undefined;
  const hasSet = descriptor.set !== undefined;
  const isAccessor = hasGet || hasSet;
  return {
    present: true,
    writable: isAccessor ? null : descriptor.writable === true,
    enumerable: descriptor.enumerable === true,
    configurable: descriptor.configurable === true,
    hasGet,
    hasSet,
  };
}

// ── whole records ───────────────────────────────────────────────────────────

function normalizeSortedMap(raw, normalizeEntry) {
  const source = raw == null || typeof raw !== "object" ? {} : raw;
  const normalized = {};
  for (const key of Object.keys(source).sort(compareStrings)) {
    normalized[key] = normalizeEntry(source[key]);
  }
  return normalized;
}

function normalizeIdentityValue(value) {
  if (typeof value !== "boolean") {
    throw new TypeError(`identity relation must be a boolean, got ${String(value)}`);
  }
  return value;
}

function normalizeEventList(raw) {
  const source = Array.isArray(raw) ? raw : [];
  return source.map((event) => ({
    name: String(event?.name),
    detail: normalizeValueTop(event?.detail ?? null),
  }));
}

function normalizeErrorList(raw) {
  const source = Array.isArray(raw) ? raw : [];
  return source.map((entry) => normalizeError(entry?.error, entry?.phase));
}

export function normalizeRecord(raw) {
  return {
    schema: RECORD_SCHEMA,
    values: normalizeSortedMap(raw?.values, normalizeValueTop),
    snapshots: normalizeSortedMap(raw?.snapshots, normalizeSnapshot),
    errors: normalizeErrorList(raw?.errors),
    descriptors: normalizeSortedMap(raw?.descriptors, normalizeDescriptor),
    identity: normalizeSortedMap(raw?.identity, normalizeIdentityValue),
    events: normalizeEventList(raw?.events),
  };
}
