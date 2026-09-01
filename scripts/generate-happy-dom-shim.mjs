#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// happy-dom src-path shim generator (mad-dom hdunit T04/T12)
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates the re-export shim layer at tests/happy-dom/shim/src/ that lets
// rewritten happy-dom tests (`import X from '…/src/a/B.js'`) resolve the
// upstream internal module path to a mad-dom facade binding.
//
// Contract (frozen by T01 vendor-scan.json):
//   every mappable `src/` module gets tests/happy-dom/shim/src/<shimPath>.ts
//   (bun resolves the `.js` import specifier to the `.ts` shim).
//
// What a shim contains — and nothing more (T04 boundary):
//   1. `export { <Basename> as default } from "mad-dom"`          for classes the
//      package entry exports (reference-equal to the facade export);
//   2. `import "mad-dom"; export { <Basename> as default } from …` for classes
//      the facade implements internally but does not export from the package
//      entry (reference-equal to the facade binding; the leading `import
//      "mad-dom"` forces the facade module-init order so the internal module
//      can be read without the circular-init failure);
//   3. honest-value re-export of the T01-vendored upstream literals
//      (tests/happy-dom/vendor-src-enums/**) for pure enum/constant modules —
//      the values ARE the upstream behavior contract, copied verbatim by T01;
//   4. `export default undefined` for type-only modules (interfaces have no
//      runtime value upstream either) and for genuine gaps where the mad-dom
//      facade does not provide the class yet (recorded, never fabricated);
//   5. `tests/happy-dom/shim/src/index.ts` re-exports the facade public
//      surface (`export * from "mad-dom"`) for the upstream `src/index.js`
//      named-import surface;
//   6. `tests/happy-dom/shim/src/PropertySymbol.ts` (T12) reproduces the
//      upstream private-symbol key set verbatim — each key is a unique
//      `Symbol("<key>")`, names/signatures only, no DOM behavior.
//
// Explicitly out of scope (never generated, recorded as exclusions):
//   - none. PropertySymbol.js was excluded under T04; T12 reverses that
//     carve-out and provides the honest-value symbol shim (the upstream key
//     set reproduced verbatim as unique Symbols — names/signatures only, no
//     DOM behavior).
//
// The script is idempotent (fixed headers, no timestamps) and gates on 100%
// coverage of every mappable scan path minus the documented exclusions —
// a missing shim fails with exit code 1.
//
// Usage: bun scripts/generate-happy-dom-shim.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIM_SRC = path.join(ROOT, "tests", "happy-dom", "shim", "src");
const ENUM_DIR = path.join(ROOT, "tests", "happy-dom", "vendor-src-enums");
const SCAN_PATH = path.join(ROOT, "tests", "happy-dom", "vendor-scan.json");
const ENTRY_PATH = path.join(ROOT, "js", "entry.js");
const FACADE_DIR = path.join(ROOT, "js", "facade");
const MANIFEST_PATH = path.join(ROOT, "tests", "happy-dom", "shim", "shim-manifest.json");

const PACKAGE_SPECIFIER = "mad-dom";
const UPSTREAM_COMMIT = "64e2c774cadbb8eda5416c1e2bcca5006d1b5df9";
const UPSTREAM_TAG = "v20.11.11";

// ----------------------------------------------------------------------------
// PropertySymbol (T12) — honest-value symbol shim.
//
// The upstream src/PropertySymbol.js (v20.11.11 @ 64e2c774) is a module of pure
// symbol constants: every key maps to a unique `Symbol("<key>")`. The key SET
// is the behavior contract the vendored tests import (`import * as
// PropertySymbol from '.../src/PropertySymbol.js'`), so this shim reproduces
// the exact upstream key set verbatim — each key exports a unique Symbol and no
// DOM behavior is attached to any key. The key list below is copied from the
// locked upstream baseline (T01). Do not add or remove keys without updating
// the upstream contract.
const PROPERTY_SYMBOL_KEYS = [
  "abort", "activeElement", "asyncTaskManager", "bodyBuffer", "buffer", "cachedResponse",
  "callbacks", "checked", "childNodes", "children", "classList", "connectedToNode",
  "disconnectedFromNode", "connectedToDocument", "disconnectedFromDocument", "contentLength", "contentType", "cssText",
  "currentScript", "currentTarget", "data", "defaultView", "destroy", "dirtyness",
  "end", "entries", "evaluateCSS", "evaluateScript", "exceptionObserver", "formNode",
  "internalId", "height", "immediatePropagationStopped", "indeterminate", "isFirstWrite", "isFirstWriteAfterOpen",
  "isInPassiveEventListener", "isValue", "listenerOptions", "listeners", "itemsByName", "nextActiveElement",
  "observeMutations", "mutationListeners", "ownerDocument", "ownerElement", "propagationStopped", "readyStateManager",
  "referrer", "registry", "relList", "resetSelection", "rootNode", "selectNode",
  "selectedness", "selection", "setupVMContext", "shadowRoot", "start", "style",
  "target", "textAreaNode", "unobserveMutations", "reportMutation", "updateSelectedness", "url",
  "value", "width", "window", "windowResizeListener", "mutationObservers", "openerFrame",
  "openerWindow", "pointerCaptures", "popup", "isConnected", "parentNode", "nodeType",
  "tagName", "prefix", "scrollHeight", "scrollWidth", "scrollTop", "scrollLeft",
  "attributes", "attributesProxy", "namespaceURI", "accessKey", "accessKeyLabel", "offsetHeight",
  "offsetWidth", "offsetLeft", "offsetTop", "clientHeight", "clientWidth", "clientLeft",
  "clientTop", "name", "specified", "adoptedStyleSheets", "implementation", "readyState",
  "publicId", "systemId", "validationMessage", "validity", "returnValue", "elements",
  "length", "complete", "naturalHeight", "naturalWidth", "loading", "x",
  "y", "defaultChecked", "files", "sheet", "volume", "paused",
  "currentTime", "playbackRate", "defaultPlaybackRate", "muted", "defaultMuted", "preservesPitch",
  "buffered", "duration", "error", "ended", "networkState", "textTracks",
  "seeking", "seekable", "played", "options", "content", "mode",
  "host", "setURL", "localName", "classRegistry", "nodeStream", "location",
  "history", "navigator", "screen", "sessionStorage", "localStorage", "sandbox",
  "cloneNode", "appendChild", "removeChild", "insertBefore", "replaceChild", "tracks",
  "constraints", "capabilities", "settings", "clone", "removeNamedItem", "items",
  "selectedOptions", "styleNode", "updateSheet", "clearCache", "onSetAttribute", "onRemoveAttribute",
  "nodeArray", "elementArray", "cache", "affectsCache", "forms", "links",
  "affectsComputedStyleCache", "query", "computedStyle", "getFormControlItems", "getFormControlNamedItem", "dataset",
  "getNamespaceItemKey", "getNamedItemKey", "itemsByNamespaceURI", "proxy", "setNamedItem", "getTokenList",
  "attributeName", "selectedIndex", "self", "parent", "top", "areas",
  "defaultValue", "elementIdMap", "clonable", "delegatesFocus", "serializable", "slotAssignment",
  "assignedNodes", "assignedToSlot", "cells", "rows", "headers", "tBodies",
  "track", "controlsList", "mediaKeys", "remote", "sinkId", "srcObject",
  "cues", "activeCues", "kind", "label", "language", "id",
  "illegalConstructor", "state", "canvas", "popoverTargetElement", "composed", "bubbles",
  "cancelable", "defaultPrevented", "eventPhase", "timeStamp", "type", "detail",
  "globalObject", "destroyed", "aborted", "browserFrames", "windowInternalId", "getItemList",
  "requiredExtensions", "systemLanguage", "transform", "baseVal", "animVal", "pathLength",
  "unitType", "viewBox", "markerUnits", "markerWidth", "markerHeight", "values",
  "orientType", "orientAngle", "refX", "refY", "readOnly", "preserveAspectRatio",
  "animatedPoints", "points", "rx", "ry", "cx", "cy",
  "r", "clipPathUnits", "maskUnits", "maskContentUnits", "filterUnits", "primitiveUnits",
  "href", "x1", "y1", "x2", "y2", "gradientUnits",
  "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits", "patternTransform", "fx",
  "fy", "offset", "disabled", "textLength", "lengthAdjust", "getAttribute",
  "setAttribute", "z", "w", "toArray", "fromString", "fromArray",
  "angle", "m11", "m12", "m13", "m14", "m21",
  "m22", "m23", "m24", "m31", "m32", "m33",
  "m34", "m41", "m42", "m43", "m44", "setMatrixValue",
  "translateSelf", "rotateSelf", "rotateAxisAngleSelf", "scaleSelf", "scale3dSelf", "scaleNonUniformSelf",
  "skewXSelf", "skewYSelf", "multiplySelf", "matrix", "domMatrix", "getDOMMatrix",
  "setDOMMatrix", "attributeValue", "startOffset", "method", "spacing", "in1",
  "in2", "result", "bias", "divisor", "edgeMode", "kernelMatrix",
  "kernelUnitLengthX", "kernelUnitLengthY", "orderX", "orderY", "preserveAlpha", "targetX",
  "targetY", "diffuseConstant", "surfaceScale", "scale", "xChannelSelector", "yChannelSelector",
  "azimuth", "elevation", "dx", "dy", "stdDeviationX", "stdDeviationY",
  "tableValues", "slope", "intercept", "amplitude", "exponent", "crossOrigin",
  "operator", "radiusX", "radiusY", "specularConstant", "specularExponent", "pointsAtX",
  "pointsAtY", "pointsAtZ", "limitingConeAngle", "baseFrequencyX", "baseFrequencyY", "numOctaves",
  "seed", "stitchTiles", "rotateFromVectorSelf", "flipXSelf", "flipYSelf", "invertSelf",
  "getLength", "currentScale", "rotate", "bindMethods", "xmlProcessingInstruction", "root",
  "filterNode", "customElementReactionStack", "dispatching", "modules", "preloads", "body",
  "redirect", "referrerPolicy", "signal", "bodyUsed", "credentials", "blocking",
  "moduleImportMap", "dispatchError", "supports", "reason", "propertyEventListeners", "cssRules",
  "parentRule", "parentStyleSheet", "conditionText", "keyText", "media", "styleMap",
  "selectorText", "cssParser", "cssRule", "rulePrefix", "virtualServerFile", "frames",
  "disableEvaluation", "validateJavaScriptExecutionEnvironment", "currentNode", "openWebSockets", "webSocket", "moduleCache",
  "cookieStore", "context", "querySelectorCache",
];

// PropertySymbol keys that the facade owns a genuine symbol for. The vendored
// tests reach facade internals through these keys (e.g.
// `signal[PropertySymbol.abort](reason)` calls the facade's real abort), so the
// shim re-exports the facade symbol to keep identity — name/signature alignment
// only, never fabricated behavior. Keyed by PropertySymbol key.
const PROPERTY_SYMBOL_REEXPORT = {
  abort: { source: "js/facade/extensions/fetch.js", export: "ABORT_IMPL" },
  buffer: { source: "js/facade/extensions/lightweight.js", export: "BLOB_BUFFER" },
};

// Documented exclusions from the mappable coverage requirement.
//
// `mappable: true` in vendor-scan.json only means the module is re-exported by
// the upstream public entry; it does not mean T04 must emit a shim. Entries
// here are explicitly carved out by the T04 boundary and therefore excluded
// from the coverage gate. Everything else mappable MUST get a shim.
//
// PropertySymbol.js was excluded under T04; T12 reverses that carve-out and
// provides the honest-value symbol shim, so the exclusion table is now empty.
const EXCLUDED_MAPPABLE = {};

// ----------------------------------------------------------------------------
// PropertySymbol constructor-adaptation wrappers (T12).
//
// The vendored suite constructs these facade classes in the upstream internal
// form `new X(PropertySymbol.illegalConstructor, owner, options)`. Their shims
// are re-exports of the hand-written wrapper classes in
// tests/happy-dom/shim/adapters/property-symbol-classes.ts (which subclass the
// facade class and interpret the marker — name/signature alignment only, no DOM
// behavior). Keyed by upstream srcPath.
const PROPERTY_SYMBOL_WRAPPED = {
  "css/declaration/CSSStyleDeclaration.js": { export: "CSSStyleDeclaration" },
  "css/style-property-map/StylePropertyMap.js": { export: "StylePropertyMap" },
  "css/style-property-map/StylePropertyMapReadOnly.js": { export: "StylePropertyMapReadOnly" },
};

// ----------------------------------------------------------------------------
// Facade binding discovery (read-only — the shim never modifies facade code).
// ----------------------------------------------------------------------------

/** Named exports of the package entry (`js/entry.js` last `export { … };`). */
function packageExportNames() {
  const src = fs.readFileSync(ENTRY_PATH, "utf8");
  const statements = src.match(/export \{ [^}]+ \};/g) ?? [];
  if (statements.length === 0) {
    throw new Error("generate-happy-dom-shim: no `export { … };` found in js/entry.js");
  }
  return new Set(
    statements[statements.length - 1]
      .replace(/^export \{ /, "")
      .replace(/ \};$/, "")
      .split(",")
      .map((s) => s.trim().split(" as ")[1] || s.trim())
      .filter(Boolean),
  );
}

/** name → facade module (relative to ROOT) for every `export …` in js/facade. */
function facadeExportModules() {
  const result = {};
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) files.push(full);
    }
  })(FACADE_DIR);
  for (const file of files.sort()) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/export (?:abstract )?(?:class|const|function|enum) (\w+)/g)) {
      if (!(m[1] in result)) result[m[1]] = path.relative(ROOT, file);
    }
    for (const m of src.matchAll(/export \{([^}]+)\}/g)) {
      for (const name of m[1].split(",").map((s) => s.trim().split(" as ")[1] || s.trim())) {
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !(name in result)) {
          result[name] = path.relative(ROOT, file);
        }
      }
    }
  }
  return result;
}

/** srcPath (e.g. "exception/DOMExceptionNameEnum") → vendored enum module (abs). */
function vendoredEnums() {
  const map = new Map();
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) files.push(full);
    }
  })(ENUM_DIR);
  for (const file of files) {
    const rel = path.relative(ENUM_DIR, file).replace(/\.ts$/, "");
    map.set(rel, file);
  }
  return map;
}

const scan = JSON.parse(fs.readFileSync(SCAN_PATH, "utf8"));
const packageExports = packageExportNames();
const facadeExports = facadeExportModules();
const enumModules = vendoredEnums();

// ----------------------------------------------------------------------------
// Classification
// ----------------------------------------------------------------------------

/**
 * @returns {{ kind, source, note }} — kind ∈ {index, package, facade,
 *   vendor-enum, type-only, gap}; source is the module the shim re-exports
 *   from (null for type-only / gap).
 */
function classify(srcPath, entry) {
  const rel = srcPath.replace(/\.js$/, "");
  const basename = srcPath.split("/").pop().replace(/\.js$/, "");
  if (srcPath === "PropertySymbol.js") {
    return { kind: "property-symbol", source: null, note: "honest-value symbol key set (T12, upstream verbatim)" };
  }
  if (srcPath === "index.js") return { kind: "index", source: PACKAGE_SPECIFIER, note: "named-import surface" };
  if (packageExports.has(basename)) {
    return { kind: "package", source: PACKAGE_SPECIFIER, note: "facade public export" };
  }
  if (basename in facadeExports) {
    return { kind: "facade", source: facadeExports[basename], note: "facade internal class" };
  }
  if (enumModules.has(rel)) {
    return { kind: "vendor-enum", source: enumModules.get(rel), note: "honest-value enum/constant (T01 vendored literals)" };
  }
  if (/^I[A-Z]/.test(basename)) {
    return { kind: "type-only", source: null, note: "type-only interface; no runtime value upstream" };
  }
  return { kind: "gap", source: null, note: "no mad-dom facade class yet; recorded gap" };
}

const mappable = [];
for (const [srcPath, entry] of Object.entries(scan.srcModules.entries).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!entry.mappable) continue;
  const classification = classify(srcPath, entry);
  const excluded = EXCLUDED_MAPPABLE[srcPath] ?? null;
  mappable.push({ srcPath, shimPath: entry.shimPath, excluded, ...classification });
}

// Honest-value enum shims for not-mappable pure-enum modules that tests
// import at runtime (DOMExceptionNameEnum, NodeTypeEnum, CSSRuleTypeEnum, the
// SVG enum family, …). Only modules with a scan entry are shimmed; vendored
// enum files no vendored test imports (no scan entry) are left alone.
const extraEnums = [];
for (const [srcPath, entry] of Object.entries(scan.srcModules.entries).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (entry.mappable) continue;
  const rel = srcPath.replace(/\.js$/, "");
  const enumFile = enumModules.get(rel);
  if (!enumFile) continue;
  extraEnums.push({
    srcPath,
    shimPath: srcPath,
    enumFile,
    kind: "vendor-enum",
    note: "honest-value enum/constant (T01 vendored literals)",
    excluded: null,
  });
}

// ----------------------------------------------------------------------------
// Generation
// ----------------------------------------------------------------------------

function relPathTo(fromDir, target) {
  return path.relative(fromDir, target).split(path.sep).join("/");
}

function header(srcPath, classification, extraLines = []) {
  const lines = [
    "// ─────────────────────────────────────────────────────────────────────────────",
    "// HDUNIT SHIM — generated file, do not edit by hand.",
    "// Generator: scripts/generate-happy-dom-shim.mjs (mad-dom hdunit T04)",
    `// Upstream:  happy-dom ${UPSTREAM_TAG} @ ${UPSTREAM_COMMIT} (MIT), src/${srcPath}`,
    `// Kind:      ${classification.kind} — ${classification.note}`,
    "// Rule:      re-export + constructor adaptation ONLY. No DOM behavior is",
    "//            implemented in this shim (see tests/happy-dom/shim/README.md).",
    ...extraLines,
    "// ─────────────────────────────────────────────────────────────────────────────",
  ];
  return lines.join("\n") + "\n";
}

function writeShim(relShim, content) {
  const file = path.join(SHIM_SRC, relShim.replace(/\.js$/, ".ts"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing !== content) fs.writeFileSync(file, content);
  return file;
}

const generated = [];

for (const item of mappable) {
  const { srcPath, shimPath, excluded } = item;

  // Excluded paths (T04 boundary) are never generated.
  if (excluded) continue;

  const outRel = shimPath.replace(/\.js$/, ".ts");
  const outAbs = path.join(SHIM_SRC, outRel);
  const outDir = path.dirname(outAbs);

  let content;
  if (item.kind === "property-symbol") {
    // Keys the facade owns a genuine symbol for (identity, not fabrication) are
    // re-exported from the facade module; everything else is a fresh
    // `Symbol("<key>")` matching the upstream key set verbatim.
    const reexportsBySource = {};
    for (const key of PROPERTY_SYMBOL_KEYS) {
      const cfg = PROPERTY_SYMBOL_REEXPORT[key];
      if (!cfg) continue;
      (reexportsBySource[cfg.source] ??= []).push({ key, exportName: cfg.export });
    }
    const importLines = [];
    const exportLines = [];
    for (const [source, entries] of Object.entries(reexportsBySource)) {
      const rel = relPathTo(SHIM_SRC, path.join(ROOT, source));
      const names = entries.map((e) => e.exportName).join(", ");
      importLines.push(`import { ${names} } from "${rel}";`);
      for (const e of entries) exportLines.push(`export { ${e.exportName} as ${e.key} };`);
    }
    const freshKeys = PROPERTY_SYMBOL_KEYS.filter((key) => !PROPERTY_SYMBOL_REEXPORT[key]);
    content =
      header(srcPath, item, [
        "// The upstream module is pure symbol constants; the key SET is the behavior",
        "// contract the vendored tests import (`import * as PropertySymbol from",
        "// '.../src/PropertySymbol.js'`). Each key exports a unique Symbol(\"<key>\"),",
        "// copied verbatim from the locked upstream baseline. No DOM behavior is",
        "// attached to any key — symbol-keyed state access is a per-file triage",
        "// decision, never implemented here.",
        "//",
        "// Keys the mad-dom facade owns a genuine symbol for (abort, buffer) are",
        "// re-exported from the facade module so the vendored tests reach the real",
        "// implementation — name/signature alignment only.",
      ]) +
      [
        ...importLines,
        ...exportLines,
        ...freshKeys.map((key) => `export const ${key} = Symbol("${key}");`),
      ].join("\n") +
      "\n";
  } else if (item.kind === "index") {
    content =
      header(srcPath, item, [
        "// Corresponds to the upstream src/index.js named-import surface. Every",
        "// name points at a facade public export. PropertySymbol is provided by",
        "// its own honest-value shim (T12), never re-exported through index.",
      ]) +
      'export * from "' + PACKAGE_SPECIFIER + '";\n';
  } else if (item.kind === "package") {
    if (srcPath in PROPERTY_SYMBOL_WRAPPED) {
      // T12 constructor adaptation: the shim default is the hand-written
      // wrapper (a facade subclass that interprets the upstream
      // `PropertySymbol.illegalConstructor` marker). See
      // adapters/property-symbol-classes.ts.
      const { export: exportName } = PROPERTY_SYMBOL_WRAPPED[srcPath];
      const adapterRel = relPathTo(
        outDir,
        path.join(ROOT, "tests", "happy-dom", "shim", "adapters", "property-symbol-classes.ts"),
      );
      content =
        header(srcPath, item, [
          "// T12 constructor-signature adaptation: the shim default is the hand-written",
          "// wrapper (a facade subclass) that interprets the upstream",
          "// `PropertySymbol.illegalConstructor` marker and forwards to the facade's",
          "// genuine internal construction path — name/signature alignment only, no",
          "// DOM behavior (see adapters/property-symbol-classes.ts).",
        ]) +
        `export { ${exportName} as default } from "${adapterRel}";\n`;
    } else if (srcPath === "window/Window.js") {
      // Constructor-signature adaptation for the happy-dom `new Window({ settings })`
      // shape. The shim class IS the facade `Window` (reference-equal per the T04
      // acceptance), so the adaptation is a companion export: `adaptWindowSettings`
      // classifies which happy-dom settings map to facade capabilities and records
      // the ignored ones as warnings (see adapters/window-settings.ts). The facade
      // constructor already accepts a plain options object, so `new Window({ settings })`
      // returns a working facade Window instance.
      const adapterRel = relPathTo(outDir, path.join(ROOT, "tests", "happy-dom", "shim", "adapters", "window-settings.ts"));
      content =
        header(srcPath, item, [
          "// Constructor-signature adaptation: the shim class is the facade `Window`",
          "// (reference-equal). happy-dom `{ settings: { enableJavaScriptEvaluation, … } }`",
          "// is accepted by the facade constructor (settings are recorded, not silently",
          "// dropped). `adaptWindowSettings` maps the settings surface and reports the",
          "// unmappable toggles as warnings.",
        ]) +
        `export { Window as default } from "${PACKAGE_SPECIFIER}";\n` +
        `export { adaptWindowSettings } from "${adapterRel}";\n`;
    } else {
      content =
        header(srcPath, item, [
          `// Re-exports the facade public export \`${srcPath.split("/").pop().replace(/\.js$/, "")}\`;`,
          "// the shim default is reference-equal to `(await import('mad-dom')).<Name>`.",
        ]) +
        `export { ${srcPath.split("/").pop().replace(/\.js$/, "")} as default } from "${PACKAGE_SPECIFIER}";\n`;
    }
  } else if (item.kind === "facade") {
    if (srcPath in PROPERTY_SYMBOL_WRAPPED) {
      // T12 constructor adaptation for a facade-internal class (not a package
      // export): the shim default is the hand-written wrapper, same as the
      // package-kind wrappers above.
      const { export: exportName } = PROPERTY_SYMBOL_WRAPPED[srcPath];
      const adapterRel = relPathTo(
        outDir,
        path.join(ROOT, "tests", "happy-dom", "shim", "adapters", "property-symbol-classes.ts"),
      );
      content =
        header(srcPath, item, [
          "// T12 constructor-signature adaptation: the shim default is the hand-written",
          "// wrapper (a facade subclass) that interprets the upstream",
          "// `PropertySymbol.illegalConstructor` marker and forwards to the facade's",
          "// genuine internal construction path — name/signature alignment only, no",
          "// DOM behavior (see adapters/property-symbol-classes.ts).",
        ]) +
        `export { ${exportName} as default } from "${adapterRel}";\n`;
    } else {
      const rel = relPathTo(outDir, path.join(ROOT, item.source));
      content =
        header(srcPath, item, [
          `// The facade implements this class internally but does not export it from the`,
          `// package entry, so the shim re-exports the facade binding directly`,
          `// (reference-equal to the facade's own class). The leading \`import "mad-dom"\``,
          "// forces the facade module-init order so the internal module can be read.",
        ]) +
        `import "${PACKAGE_SPECIFIER}";\n` +
        `export { ${srcPath.split("/").pop().replace(/\.js$/, "")} as default } from "${rel}";\n`;
    }
  } else if (item.kind === "vendor-enum") {
    const rel = relPathTo(outDir, item.source);
    content =
      header(srcPath, item, [
        "// Honest-value shim: the literals are copied verbatim from the locked",
        "// upstream baseline by T01 (tests/happy-dom/vendor-src-enums/…). The values",
        "// ARE the behavior contract, so copying them is correct, not fabrication.",
        "// Delivered as a re-export of the vendored module to guarantee identity.",
      ]) +
      `export { default } from "${rel}";\n`;
  } else {
    // type-only or gap — faithful `undefined` default + explicit record.
    const isTypeOnly = item.kind === "type-only";
    const basename = srcPath.split("/").pop().replace(/\.js$/, "");
    const extraLines = isTypeOnly
      ? [
          "// Type-only module: the default export is `undefined` at runtime in upstream",
          "// (an interface erases at compile time); this shim mirrors that faithfully and",
          "// exists so `.js` import specifiers resolve to this `.ts`.",
        ]
      : [
          `// GAP: the mad-dom facade provides no binding named \`${basename}\` yet.`,
          "// This shim exists so rewritten imports resolve; the default export is",
          "// intentionally `undefined` and using it fails with the standard TypeError.",
          "// Tracked as a known gap for wave triage (T06+); see shim-manifest.json",
          "// and tests/happy-dom/shim/README.md.",
        ];
    content = header(srcPath, item, extraLines) + "export default undefined;\n";
  }

  generated.push(writeShim(shimPath, content));
}

for (const item of extraEnums) {
  const outRel = item.shimPath.replace(/\.js$/, ".ts");
  const outAbs = path.join(SHIM_SRC, outRel);
  const outDir = path.dirname(outAbs);
  const rel = relPathTo(outDir, item.enumFile);
  const content =
    header(item.srcPath, item, [
      "// Honest-value shim for a not-mappable pure enum/constant module the vendored",
      "// tests reference at runtime. Values are copied verbatim from the locked",
      "// upstream baseline by T01 (vendor-src-enums); delivering them as a re-export",
      "// guarantees identity with the vendored literals.",
    ]) +
    `export { default } from "${rel}";\n`;
  generated.push(writeShim(item.shimPath, content));
}

// ----------------------------------------------------------------------------
// Coverage gate (fail with exit 1 when a required shim is missing)
// ----------------------------------------------------------------------------

// Every required mappable path (minus documented exclusions) plus every
// not-mappable honest-value enum must have been generated this run.
const required = [
  ...mappable.filter((i) => !i.excluded).map((i) => i.shimPath),
  ...extraEnums.map((i) => i.shimPath),
];
const writtenSet = new Set(generated.map((f) => path.relative(SHIM_SRC, f).replace(/\.ts$/, ".js")));

const missing = [...new Set(required.filter((shimPath) => !writtenSet.has(shimPath)))];

if (missing.length > 0) {
  console.error(
    `[generate-happy-dom-shim] COVERAGE FAILED: ${missing.length} required shim(s) missing:`,
  );
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    "Every mappable scan path (minus documented exclusions) must have a shim. Re-run to regenerate.",
  );
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Manifest (deterministic summary of what was generated and why)
// ----------------------------------------------------------------------------

const byKind = {};
for (const item of mappable) {
  if (item.excluded) continue;
  byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
}
const manifest = {
  generatedBy: "scripts/generate-happy-dom-shim.mjs",
  task: "T04/T12",
  shimBasePath: "tests/happy-dom/shim/src",
  upstream: {
    repository: "https://github.com/capricorn86/happy-dom",
    commit: UPSTREAM_COMMIT,
    tag: UPSTREAM_TAG,
    license: "MIT",
  },
  counts: {
    mappablePaths: mappable.length,
    shimmedMappable: mappable.filter((i) => !i.excluded).length,
    excluded: mappable.filter((i) => i.excluded).map((i) => i.srcPath),
    honestValueEnums: extraEnums.length,
    propertySymbolKeys: PROPERTY_SYMBOL_KEYS.length,
    byKind,
  },
  gaps: mappable
    .filter((i) => i.kind === "gap" && !i.excluded)
    .map((i) => ({ srcPath: i.srcPath, reason: "no mad-dom facade binding yet (wave triage)" })),
  exclusions: mappable
    .filter((i) => i.excluded)
    .map((i) => ({ srcPath: i.srcPath, reason: i.excluded })),
};
const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
if (!fs.existsSync(MANIFEST_PATH) || fs.readFileSync(MANIFEST_PATH, "utf8") !== manifestJson) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, manifestJson);
}

console.log(
  `[generate-happy-dom-shim] ok — ${generated.length} shims written ` +
    `(${mappable.length} mappable paths, ${mappable.filter((i) => !i.excluded).length} shimmed, ` +
    `${mappable.filter((i) => i.excluded).length} excluded, ${extraEnums.length} honest-value enums); coverage gate passed.`,
);
