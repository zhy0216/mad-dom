#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// happy-dom src-path shim generator (mad-dom hdunit T04)
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
//      named-import surface.
//
// Explicitly out of scope (never generated, recorded as exclusions):
//   - PropertySymbol.js — private-symbol mechanism, semantically not portable;
//     its dependent test files are triaged not-applicable in T10.
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
// Documented exclusions from the mappable coverage requirement.
//
// `mappable: true` in vendor-scan.json only means the module is re-exported by
// the upstream public entry; it does not mean T04 must emit a shim. Entries
// here are explicitly carved out by the T04 boundary and therefore excluded
// from the coverage gate. Everything else mappable MUST get a shim.
const EXCLUDED_MAPPABLE = {
  "PropertySymbol.js":
    "T04 boundary: no PropertySymbol shim (private-symbol mechanism, semantics not portable). " +
    "Dependent test files are triaged not-applicable in T10.",
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
  if (item.kind === "index") {
    content =
      header(srcPath, item, [
        "// Corresponds to the upstream src/index.js named-import surface. Every",
        "// name points at a facade public export. PropertySymbol (excluded by the",
        "// T04 boundary) is intentionally absent; its importers are triaged in T10.",
      ]) +
      'export * from "' + PACKAGE_SPECIFIER + '";\n';
  } else if (item.kind === "package") {
    if (srcPath === "window/Window.js") {
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
  task: "T04",
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
