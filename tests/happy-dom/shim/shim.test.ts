// HDUNIT shim layer self-test (mad-dom hdunit T04).
//
// Verifies the T04 acceptance criteria against the generated shim tree
// (tests/happy-dom/shim/src):
//   1. every mappable vendor-scan path has a shim that bun can import
//      (PropertySymbol.js is a documented T04 exclusion, never generated);
//   2. facade-backed shims are reference-equal to the mad-dom facade export;
//   3. honest-value enum shims deliver the vendored upstream literals;
//   4. gap / type-only shims default to `undefined` and are recorded;
//   5. the `Window` settings constructor-signature adaptation works and records
//      unmappable toggles as warnings (never silently dropped).

import { test, expect, describe } from "bun:test";
import { isNativeAvailable } from "mad-dom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHIM_SRC = path.join(ROOT, "tests", "happy-dom", "shim", "src");
const ENUM_DIR = path.join(ROOT, "tests", "happy-dom", "vendor-src-enums");
const SCAN = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests", "happy-dom", "vendor-scan.json"), "utf8"),
);

const EXCLUDED = ["PropertySymbol.js"];

function packageExportNames() {
  const src = fs.readFileSync(path.join(ROOT, "js", "entry.js"), "utf8");
  const statements = src.match(/export \{ [^}]+ \};/g) ?? [];
  return new Set(
    statements[statements.length - 1]
      .replace(/^export \{ /, "")
      .replace(/ \};$/, "")
      .split(",")
      .map((s) => s.trim().split(" as ")[1] || s.trim())
      .filter(Boolean),
  );
}

function facadeExportModules() {
  const result = {};
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) files.push(full);
    }
  })(path.join(ROOT, "js", "facade"));
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

function vendoredEnumRels() {
  const rels = new Set();
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) rels.add(path.relative(ENUM_DIR, full).replace(/\.ts$/, ""));
    }
  })(ENUM_DIR);
  return rels;
}

const PACKAGE_EXPORTS = packageExportNames();
const FACADE_EXPORTS = facadeExportModules();
const ENUM_RELS = vendoredEnumRels();

function classify(srcPath, entry) {
  const rel = srcPath.replace(/\.js$/, "");
  const basename = srcPath.split("/").pop().replace(/\.js$/, "");
  if (srcPath === "index.js") return { kind: "index" };
  if (PACKAGE_EXPORTS.has(basename)) return { kind: "package", module: "mad-dom" };
  if (basename in FACADE_EXPORTS) return { kind: "facade", module: FACADE_EXPORTS[basename] };
  if (ENUM_RELS.has(rel)) return { kind: "vendor-enum" };
  if (/^I[A-Z]/.test(basename)) return { kind: "type-only" };
  return { kind: "gap" };
}

const mappable = Object.entries(SCAN.srcModules.entries)
  .filter(([, v]) => v.mappable)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([srcPath, v]) => ({ srcPath, ...classify(srcPath, v), excluded: EXCLUDED.includes(srcPath) }));

// Honest-value enum shims: every vendored enum with a scan entry (mappable or
// not) that is not backed by a facade binding.
const enumCases = [];
for (const [srcPath, entry] of Object.entries(SCAN.srcModules.entries)) {
  const rel = srcPath.replace(/\.js$/, "");
  if (!ENUM_RELS.has(rel)) continue;
  const basename = srcPath.split("/").pop().replace(/\.js$/, "");
  if (PACKAGE_EXPORTS.has(basename) || basename in FACADE_EXPORTS) continue;
  const vendored = (await import(path.join(ENUM_DIR, rel + ".ts"))).default;
  enumCases.push({ srcPath, vendored });
}

const shimTs = (shimPath) => path.join(SHIM_SRC, shimPath.replace(/\.js$/, ".ts"));
const shimSpec = (shimPath) => `./src/${shimPath.replace(/\.js$/, ".ts")}`;

// ---------------------------------------------------------------------------
// 1. Coverage — every mappable path (minus documented exclusions) has a shim.
// ---------------------------------------------------------------------------

describe("coverage", () => {
  test("every mappable scan path has a shim file (PropertySymbol excluded)", () => {
    const missing = mappable
      .filter((i) => !i.excluded && !fs.existsSync(shimTs(i.srcPath)))
      .map((i) => i.srcPath);
    expect(missing).toEqual([]);
  });

  test("excluded paths are only the documented T04 boundary exclusions", () => {
    const excluded = mappable.filter((i) => i.excluded).map((i) => i.srcPath);
    expect(excluded.sort()).toEqual(["PropertySymbol.js"]);
  });

  test("no PropertySymbol shim is generated", () => {
    expect(fs.existsSync(shimTs("PropertySymbol.js"))).toBe(false);
  });

  test("every not-mappable vendored enum with a scan entry gets an honest-value shim", () => {
    const missing = [];
    for (const [srcPath, entry] of Object.entries(SCAN.srcModules.entries)) {
      if (entry.mappable) continue;
      if (!ENUM_RELS.has(srcPath.replace(/\.js$/, ""))) continue;
      if (!fs.existsSync(shimTs(srcPath))) missing.push(srcPath);
    }
    expect(missing).toEqual([]);
  });

  test("every generated shim is importable", async () => {
    const files = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) files.push(full);
      }
    })(SHIM_SRC);
    for (const file of files) {
      await expect(import(file)).resolves.toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Reference equality — facade-backed shims are the facade bindings.
// ---------------------------------------------------------------------------

describe("reference equality", () => {
  for (const item of mappable) {
    if (item.excluded) continue;
    if (item.kind !== "package" && item.kind !== "facade") continue;
    const basename = item.srcPath.split("/").pop().replace(/\.js$/, "");
    const source = item.kind === "package" ? "mad-dom" : path.join(ROOT, item.module);
    test(`shim ${item.srcPath} === facade ${basename}`, async () => {
      const shim = (await import(shimSpec(item.srcPath))).default;
      const facade = (await import(source))[basename];
      expect(shim).toBe(facade);
    });
  }

  test("shim Window === (await import('mad-dom')).Window", async () => {
    const W = (await import("./src/window/Window.js")).default;
    expect(W).toBe((await import("mad-dom")).Window);
  });
});

// ---------------------------------------------------------------------------
// 3. Honest-value enum shims deliver the vendored upstream literals.
// ---------------------------------------------------------------------------

describe("honest-value enums", () => {
  for (const { srcPath, vendored } of enumCases) {
    test(`shim ${srcPath} delivers the vendored literals`, async () => {
      const shim = (await import(shimSpec(srcPath))).default;
      expect(shim).toEqual(vendored);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Gap / type-only shims are recorded `undefined` defaults.
// ---------------------------------------------------------------------------

describe("gap and type-only shims", () => {
  for (const item of mappable) {
    if (item.excluded) continue;
    if (item.kind !== "gap" && item.kind !== "type-only") continue;
    test(`shim ${item.srcPath} default is undefined (recorded ${item.kind})`, async () => {
      const shim = (await import(shimSpec(item.srcPath))).default;
      expect(shim).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Window settings constructor-signature adaptation.
// ---------------------------------------------------------------------------

describe("Window settings adaptation", () => {
  // Construction needs the native binding; skip when it is not built so the
  // self-test stays green in any checkout. The classification/warning half of
  // the adapter does not need native and always runs.
  test.skipIf(!isNativeAvailable())(
    "new Window({ settings }) returns a working facade Window instance",
    async () => {
      const { default: Window, adaptWindowSettings } = await import("./src/window/Window.js");
      const window = new Window({
        settings: {
          enableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
        },
      });
      expect(window).toBeInstanceOf(Window);
      expect(window.document).toBeDefined();
      window.destroy();
      expect(adaptWindowSettings).toBeTypeOf("function");
    },
  );

  test.skipIf(!isNativeAvailable())(
    "new Window({ url, settings }) honors the facade url mapping",
    async () => {
      const { default: Window } = await import("./src/window/Window.js");
      const window = new Window({ url: "https://example.com/page", settings: {} });
      expect(window.location.href).toBe("https://example.com/page");
      window.destroy();
    },
  );

  test("unmappable settings are recorded as warnings, not silently dropped", async () => {
    const { adaptWindowSettings } = await import("./src/window/Window.js");
    const result = adaptWindowSettings({
      url: "https://example.com/",
      settings: {
        enableJavaScriptEvaluation: false,
        canvasAdapter: { kind: "mock" },
        unknownToggle: 1,
      },
    });
    expect(result.mapped).toContain("url");
    expect(result.ignored).toEqual(["enableJavaScriptEvaluation", "canvasAdapter", "unknownToggle"]);
    expect(result.warnings.length).toBe(3);
    for (const warning of result.warnings) {
      expect(warning).toContain("no facade toggle yet and is ignored");
    }
  });

  test("adaptWindowSettings warns when warn:true", async () => {
    const { adaptWindowSettings } = await import("./src/window/Window.js");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      adaptWindowSettings({ settings: { disableIframePageLoading: true } }, { warn: true });
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("settings.disableIframePageLoading");
  });
});
