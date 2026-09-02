#!/usr/bin/env bun
// scripts/rewrite-happy-dom-tests.mjs — hdunit T02 mechanical rewrite pipeline.
//
// Reads the vendored happy-dom test suite (tests/happy-dom/vendor/) and the
// T01 module manifest (tests/happy-dom/vendor-scan.json) and writes a
// mechanically rewritten mirror to tests/happy-dom/rewritten/ plus a machine
// readable report tests/happy-dom/rewrite-report.json.
//
// The rewrite is strictly fidelity-preserving — it only touches the import and
// vitest→bun:test / vi→adapter API surface. It never edits assertions, runtime
// behavior or file structure, and it never fixes test behavior (T05+ waves do).
//
// Transformations applied to every rewritten source file:
//   - `src/…` internal imports whose `shimPath` is mapped by vendor-scan.json
//     are re-pointed at tests/happy-dom/shim/src/<shimPath> (a path the T04
//     shim layer must create). Unmapped `src/…` imports are left untouched so
//     the file cannot run — the T05 triage gate records them.
//   - `import { … } from 'vitest'` becomes `import { … } from 'bun:test'`;
//     `vi` is imported from the T03 adapter (tests/happy-dom/adapter/).
//   - `vi.fn`→`mock`, `vi.spyOn`→`spyOn`, `vi.clearAllMocks`→`clearAllMocks`
//     (bun:test has no top-level `clearAllMocks`, so it comes from the
//     adapter), `vi.restoreAllMocks`→adapter `restoreAllMocks`.
//   - `vi.mock(...)` call sites cannot be mechanically mapped (bun has no lazy
//     `importOriginal`); they are registered in the adapter-gap report list.
//     setup-class files (tests/happy-dom/vendor/setup.ts) are skipped and
//     marked — T03 hand-ports them.
//   - local-helper imports (vendor-internal relative imports such as
//     `../CustomElement.js`) are preserved verbatim because the rewritten tree
//     mirrors the vendor tree; a single upstream path bug
//     (`window/Window.test.ts` importing `../../test/CustomElement.js`) is
//     repaired to the mirrored target and recorded.
//   - `import type` and the `.js` suffix are preserved (Bun resolves `.js`
//     imports to same-named `.ts` shims).
//
// Every rewritten file gets a fixed provenance header (no timestamps, so the
// pipeline is reproducible). Content-only fixtures (images, css, json, maps,
// snapshots, type declarations) are byte-copied without a header because their
// byte content is behavior (line numbers / exact module source are asserted).
//
// rewritten/ is a generated artifact and is not committed; run this script to
// (re)build it. Generation is deterministic and idempotent:
//   bun scripts/rewrite-happy-dom-tests.mjs                # generate
// Exit codes: 0 = ok, 1 = failure, 2 = usage error.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (paths are T01/T03/T04 frozen contract)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const VENDOR_DIR = join(REPO_ROOT, "tests", "happy-dom", "vendor");
const SCAN_PATH = join(REPO_ROOT, "tests", "happy-dom", "vendor-scan.json");
const REWRITTEN_DIR = join(REPO_ROOT, "tests", "happy-dom", "rewritten");
const REPORT_PATH = join(REPO_ROOT, "tests", "happy-dom", "rewrite-report.json");

// `shimPath` values in vendor-scan.json are relative to tests/happy-dom/shim/src/.
const SHIM_BASE = join("shim", "src");
// The adapter module (T03) is tests/happy-dom/adapter/index.ts; imported with a
// `.js` suffix that Bun resolves to the same-named `.ts` file.
const ADAPTER_IMPORT = join("adapter", "index.js");

const SCHEMA_VERSION = "1.0.0";
const UPSTREAM_TEST_DIR = "packages/happy-dom/test";

// vi method → replacement mapping. `clearAllMocks` is not a top-level bun:test
// export (only `mock.clearAllMocks`), so it is provided by the adapter, exactly
// like `restoreAllMocks`.
const VI_METHOD_MAP = {
	"vi.fn": "mock",
	"vi.spyOn": "spyOn",
	"vi.clearAllMocks": "clearAllMocks",
	"vi.restoreAllMocks": "restoreAllMocks",
};
const VI_MOCK = "vi.mock";

const BUN_TEST_NAMES = ["beforeAll", "afterAll", "beforeEach", "afterEach", "describe", "it", "expect", "test"];
const ADAPTER_NAME_ORDER = ["vi", "restoreAllMocks", "clearAllMocks"];

// Report-level unmapped-import categories (todo T02), derived from the
// vendor-scan `shimReason`. `propertysymbol` is reserved for `internal-symbol`
// (PropertySymbol.js is currently mappable via the public entry, so it is
// unused in this baseline but kept in the schema for T05).
const REASON_TO_CATEGORY = {
	"internal-symbol": "propertysymbol",
	"internal-enum": "internal-only-module",
	"internal-utility": "internal-only-module",
	"internal-parser": "internal-only-module",
	"internal-config": "internal-only-module",
	"internal-class": "internal-only-module",
	"internal-type": "internal-only-module",
	"internal-other": "internal-only-module",
};

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

function countNewlines(s) {
	let n = 0;
	for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
	return n;
}

// Convert a relative path to a forward-slash form, ensuring it is import-safe
// (imports must start with `.` to be treated as relative).
function toImportSpec(p) {
	let s = p.split(sep).join("/");
	if (!s.startsWith(".")) s = "./" + s;
	return s;
}

// The `isCodeLineStart(i)` helper scans the original source backward from `i`
// to the previous newline; a position is a statement-position line start when
// only whitespace sits between the newline and `i`. Template/string/comment
// content spanning the newline therefore yields false, which is exactly what we
// want (real imports are always at top-level statement position).
function isCodeLineStart(source, i) {
	let j = i - 1;
	while (j >= 0 && source.charCodeAt(j) !== 10) j--;
	for (let k = j + 1; k < i; k++) {
		const c = source.charCodeAt(k);
		if (c !== 32 && c !== 9) return false;
	}
	return true;
}

function isRegexStart(source, i) {
	let j = i - 1;
	while (j >= 0 && /[ \t\n\r]/.test(source[j])) j--;
	if (j < 0) return true;
	const c = source[j];
	// `)` and `]` close expressions/indices, so `/` after them is division (the
	// common case like `Date.now() / 1000`). Everything else in the set biases
	// toward a regex literal at statement/operator position.
	if (/[)\]A-Za-z0-9_$]/.test(c)) {
		let k = j;
		while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k--;
		const word = source.slice(k + 1, j + 1);
		return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(word);
	}
	return /[([{,:=;!&|?+\-*%^~<>]/.test(c);
}

function consumeString(source, i) {
	const quote = source[i];
	let j = i + 1;
	while (j < source.length) {
		const c = source[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === quote) return j + 1;
		j++;
	}
	return source.length;
}

// Consume a template literal, recursing into `${ … }` expression regions so
// braces and quotes inside expressions do not terminate the template early.
function consumeTemplate(source, i) {
	let j = i + 1;
	let depth = 0;
	while (j < source.length) {
		const c = source[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "$" && source[j + 1] === "{") {
			depth++;
			j += 2;
			continue;
		}
		if (depth > 0 && c === "{") {
			depth++;
			j++;
			continue;
		}
		if (depth > 0 && c === "}") {
			depth--;
			j++;
			continue;
		}
		if (depth === 0 && c === "`") return j + 1;
		j++;
	}
	return source.length;
}

function consumeRegex(source, i) {
	let j = i + 1;
	let inClass = false;
	while (j < source.length) {
		const c = source[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) {
			j++;
			while (j < source.length && /[a-z]/i.test(source[j])) j++;
			return j;
		}
		j++;
	}
	return source.length;
}

function parseImportLine(line) {
	const m = /^import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{\s*([^}]*)\s*\}\s*)?(?:\*\s+as\s+([\w$]+)\s*)?from\s*['"]([^'"]+)['"]/.exec(line);
	if (m) {
		return {
			isType: !!m[1],
			defaultName: m[2] || null,
			named: m[3] ? m[3].split(",").map((s) => s.trim()).filter(Boolean) : [],
			namespace: m[4] || null,
			spec: m[5],
		};
	}
	const se = /^import\s*['"]([^'"]+)['"]/.exec(line);
	if (se) {
		return { isType: false, defaultName: null, named: [], namespace: null, spec: se[1], sideEffect: true };
	}
	return null;
}

function replaceSpec(line, newSpec) {
	return line.replace(/from\s*['"][^'"]+['"]/, `from '${newSpec}'`);
}

function reasonToCategory(reason) {
	return REASON_TO_CATEGORY[reason] || "other";
}

function provenanceHeader(upstream, vendorPath) {
	return [
		"// ─────────────────────────────────────────────────────────────────────────────",
		"// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite",
		"// Upstream repository: https://github.com/capricorn86/happy-dom",
		`// Upstream commit:    ${upstream.commit}`,
		`// Upstream tag:       ${upstream.tag}`,
		`// Upstream path:      ${UPSTREAM_TEST_DIR}/${vendorPath}`,
		"// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)",
		"//",
		"// This file is a generated, fidelity-preserving rewrite: only import",
		"// statements and the vitest → bun:test / vi → adapter API surface changed;",
		"// assertions, behavior and structure are untouched. Do not edit by hand;",
		"// regenerate with `bun run compat:hdunit:rewrite`.",
		`// License: MIT — https://github.com/capricorn86/happy-dom/blob/${upstream.commit}/LICENSE`,
		"// ─────────────────────────────────────────────────────────────────────────────",
		"",
	].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Lexer: split a source file into raw text / import statements / vi call tokens
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(source) {
	const segments = [];
	const n = source.length;
	let i = 0;
	let line = 1;

	while (i < n) {
		const c = source[i];

		// Import statement (top-level, code state, single-line in this suite).
		if (isCodeLineStart(source, i)) {
			const ws = /^[ \t]*/.exec(source.slice(i))[0];
			if (source.startsWith("import", i + ws.length)) {
				const after = source[i + ws.length + 6] || "";
				if (!/[A-Za-z0-9_$]/.test(after)) {
					let k = i + ws.length + 6;
					while (k < n && /[ \t]/.test(source[k])) k++;
					const nc = source[k];
					if (nc !== "(" && nc !== ".") {
						let end = source.indexOf("\n", i);
						if (end === -1) end = n;
						const text = source.slice(i, end);
						segments.push({ type: "import", text, line });
						i = end;
						continue;
					}
				}
			}
		}

		// vi.* method call tokens (code state only).
		let matched = false;
		for (const method of Object.keys(VI_METHOD_MAP)) {
			if (source.startsWith(method, i) && source[i + method.length] === "(") {
				segments.push({ type: "vi", method, line });
				i += method.length;
				matched = true;
				break;
			}
		}
		if (!matched && source.startsWith(VI_MOCK, i) && source[i + VI_MOCK.length] === "(") {
			segments.push({ type: "vi", method: VI_MOCK, line });
			i += VI_MOCK.length;
			matched = true;
		}
		if (matched) continue;

		if (c === "'" || c === '"') {
			const end = consumeString(source, i);
			segments.push({ type: "raw", text: source.slice(i, end) });
			line += countNewlines(source.slice(i, end));
			i = end;
			continue;
		}
		if (c === "`") {
			const end = consumeTemplate(source, i);
			const t = source.slice(i, end);
			segments.push({ type: "raw", text: t });
			line += countNewlines(t);
			i = end;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			let end = source.indexOf("\n", i);
			if (end === -1) end = n;
			segments.push({ type: "raw", text: source.slice(i, end) });
			i = end;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			let end = source.indexOf("*/", i + 2);
			if (end === -1) end = n;
			else end += 2;
			const t = source.slice(i, end);
			segments.push({ type: "raw", text: t });
			line += countNewlines(t);
			i = end;
			continue;
		}
		if (c === "/" && isRegexStart(source, i)) {
			const end = consumeRegex(source, i);
			const t = source.slice(i, end);
			segments.push({ type: "raw", text: t });
			line += countNewlines(t);
			i = end;
			continue;
		}

		segments.push({ type: "raw", text: c });
		if (c === "\n") line++;
		i++;
	}

	return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Import transformation
// ─────────────────────────────────────────────────────────────────────────────

function relativeTo(rewrittenDirAbs, targetAbs) {
	return toImportSpec(relative(rewrittenDirAbs, targetAbs));
}

function shimSpecFor(vendorPath, shimPath) {
	const rewrittenDirAbs = join(REWRITTEN_DIR, dirname(vendorPath));
	const targetAbs = resolve(REPO_ROOT, "tests", "happy-dom", SHIM_BASE, shimPath);
	return relativeTo(rewrittenDirAbs, targetAbs);
}

function adapterSpecFor(vendorPath) {
	const rewrittenDirAbs = join(REWRITTEN_DIR, dirname(vendorPath));
	const targetAbs = resolve(REPO_ROOT, "tests", "happy-dom", ADAPTER_IMPORT);
	return relativeTo(rewrittenDirAbs, targetAbs);
}

// Transform one import segment. `entry` is the matched vendor-scan import
// record ({spec, kind, isType?, srcPath?, shimPath?, shimReason?}) or null.
function transformImportSegment(ctx, seg, entry, usage) {
	const { vendorPath, line, parsed } = ctx;
	const { spec } = parsed;

	if (entry && entry.kind === "vitest-api") {
		return transformVitestImport(ctx, seg, usage);
	}

	if (entry && (entry.kind === "src-runtime" || entry.kind === "src-type")) {
		if (entry.shimPath != null) {
			const newSpec = shimSpecFor(vendorPath, entry.shimPath);
			return {
				output: replaceSpec(seg.text, newSpec),
				mapped: { file: vendorPath, line, spec, srcPath: entry.srcPath, newSpec, kind: entry.kind, isType: parsed.isType },
			};
		}
		// The authoritative "not mappable" classification lives on the module
		// entry (scan.srcModules). Per-import records can degrade to
		// `internal-other` for extensionless specs (T01 quirk), so we prefer the
		// module-level reason for cross-consistency with vendor-scan.json.
		const reason = ctx.srcModuleReason(entry.srcPath) || entry.shimReason;
		return {
			output: seg.text,
			unmapped: {
				file: vendorPath,
				line,
				spec,
				srcPath: entry.srcPath,
				kind: entry.kind,
				isType: parsed.isType,
				reason,
				category: reasonToCategory(reason),
			},
		};
	}

	if (entry && entry.kind === "local-helper") {
		return transformLocalHelper(ctx, seg);
	}

	// External import (or an unmatched record) — leave untouched.
	return { output: seg.text };
}

// Local-helper imports are preserved verbatim because the rewritten tree
// mirrors the vendor tree. The single upstream path bug that escapes the
// mirrored root (`../../test/CustomElement.js`) is repaired to the actual
// mirrored file found by basename and recorded as a path repair. Deliberately
// dangling fixture imports (e.g. `./notFound.js` in the not-found-error
// fixture) are left untouched because they are part of the test scenario.
// Filesystem access goes through ctx.vendorLookup so the selftest can run
// against fabricated layouts without the vendored suite.
function transformLocalHelper(ctx, seg) {
	const { vendorPath, line, vendorLookup } = ctx;
	const abs = resolve(VENDOR_DIR, dirname(vendorPath), ctx.parsed.spec);
	const rel = relative(VENDOR_DIR, abs);
	const insideTree = !rel.startsWith("..") && vendorLookup.resolveTs(abs);
	if (insideTree) {
		// The target lives inside the vendor tree → the mirror preserves it.
		return { output: seg.text };
	}

	// The mirrored anchor path does not exist (upstream path bug). Look the
	// target file up by basename in the vendor tree.
	const base = basenameOfSpec(ctx.parsed.spec);
	if (!base) return { output: seg.text };
	const candidates = vendorLookup.findByBasename(base);
	if (candidates.length === 1) {
		const relVendor = relative(VENDOR_DIR, candidates[0]).replace(/\.ts$/, ".js");
		const rewrittenDirAbs = join(REWRITTEN_DIR, dirname(vendorPath));
		const targetAbs = resolve(REWRITTEN_DIR, relVendor);
		const newSpec = toImportSpec(relative(rewrittenDirAbs, targetAbs));
		return {
			output: replaceSpec(seg.text, newSpec),
			pathRepair: { file: vendorPath, line, spec: ctx.parsed.spec, newSpec },
		};
	}
	return { output: seg.text };
}

function resolveTsTarget(abs) {
	const js = abs;
	if (existsSync(js)) return js;
	if (js.endsWith(".js")) {
		const t = js.replace(/\.js$/, ".ts");
		if (existsSync(t)) return t;
		const d = js.replace(/\.js$/, "/index.ts");
		if (existsSync(d)) return d;
	}
	return null;
}

// Default vendor-tree lookup backed by the real filesystem.
function findVendorByBasename(base) {
	return walk(VENDOR_DIR).filter((p) => statSync(p).isFile() && basename(p).replace(/\.ts$/, ".js") === base);
}

function basenameOfSpec(spec) {
	const m = /([^/]+)\.[jt]s$/.exec(spec);
	return m ? m[1] + ".js" : null;
}

// Rewrite a vitest import line into up to two import lines: one from
// `bun:test` (original non-vi names plus usage-driven `mock`/`spyOn`) and one
// from the adapter (`restoreAllMocks`, `clearAllMocks`, `vi` for `vi.mock`).
function transformVitestImport(ctx, seg, usage) {
	const { vendorPath, parsed } = ctx;
	if (parsed.defaultName || parsed.namespace) {
		throw new Error(
			`[rewrite] unexpected vitest import shape in ${vendorPath}: default/namespace imports from 'vitest' are not supported by the mechanical rewrite.`
		);
	}

	const bunNames = [];
	const unknownNames = [];
	for (const name of parsed.named) {
		const local = name.split(/\s+as\s+/)[0].trim();
		if (!local || local === "vi") continue;
		if (BUN_TEST_NAMES.includes(local)) bunNames.push(local);
		else unknownNames.push(local);
	}
	for (const local of unknownNames) bunNames.push(local);

	if (usage.fn > 0 && !bunNames.includes("mock")) bunNames.push("mock");
	if (usage.spyOn > 0 && !bunNames.includes("spyOn")) bunNames.push("spyOn");

	const adapterNames = ADAPTER_NAME_ORDER.filter((name) => {
		if (name === "vi") return usage.mock > 0;
		if (name === "restoreAllMocks") return usage.restoreAllMocks > 0;
		if (name === "clearAllMocks") return usage.clearAllMocks > 0;
		return false;
	});

	const lines = [];
	if (bunNames.length > 0) lines.push(`import { ${bunNames.join(", ")} } from 'bun:test';`);
	if (adapterNames.length > 0) lines.push(`import { ${adapterNames.join(", ")} } from '${adapterSpecFor(vendorPath)}';`);

	return { output: lines.join("\n") };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file rewrite
// ─────────────────────────────────────────────────────────────────────────────

// Aggregated vi usage, collected from the segments before import rewriting so
// that a top-of-file vitest import can be split correctly.
function collectViUsage(segments) {
	const usage = { fn: 0, spyOn: 0, clearAllMocks: 0, restoreAllMocks: 0, mock: 0 };
	for (const seg of segments) {
		if (seg.type !== "vi") continue;
		if (seg.method === VI_MOCK) usage.mock++;
		else {
			const key = seg.method.replace(/^vi\./, "");
			usage[key]++;
		}
	}
	return usage;
}

// Rewrite a single vendored source file. `scanFile` is the vendor-scan files[]
// record for the file. `srcModuleReason` is a `(srcPath) => shimReason | null`
// resolver backed by scan.srcModules.entries, used to keep unmapped-import
// reasons cross-consistent with the authoritative module classification.
// `vendorLookup` abstracts local-helper filesystem resolution so the selftest
// can run against fabricated layouts. Returns { output, meta } where meta
// carries the report entries for this file. Pure and deterministic — the unit
// under selftest.
function rewriteSource({ vendorPath, source, scanImports, upstream, srcModuleReason, vendorLookup }) {
	const segments = tokenize(source);
	const usage = collectViUsage(segments);
	const lookup = vendorLookup || { resolveTs: resolveTsTarget, findByBasename: findVendorByBasename };

	const meta = {
		mappedImports: [],
		unmappedImports: [],
		adapterGaps: [],
		pathRepairs: [],
		vitestNames: [],
		vitestImports: 0,
		viRewrites: { fn: usage.fn, spyOn: usage.spyOn, clearAllMocks: usage.clearAllMocks, restoreAllMocks: usage.restoreAllMocks, mock: usage.mock },
	};

	const scanEntries = scanImports ? [...scanImports] : [];
	const used = new Array(scanEntries.length).fill(false);

	const findScanEntry = (spec, isType) => {
		for (let k = 0; k < scanEntries.length; k++) {
			if (used[k]) continue;
			if (scanEntries[k].spec === spec && !!scanEntries[k].isType === isType) return k;
		}
		return -1;
	};

	const out = [];
	for (const seg of segments) {
		if (seg.type === "raw") {
			out.push(seg.text);
			continue;
		}
		if (seg.type === "import") {
			const parsed = parseImportLine(seg.text.trim());
			if (!parsed) {
				out.push(seg.text);
				continue;
			}
			const entryIdx = findScanEntry(parsed.spec, parsed.isType);
			const entry = entryIdx !== -1 ? scanEntries[entryIdx] : null;
			if (entryIdx !== -1) used[entryIdx] = true;

			const ctx = { vendorPath, parsed, line: seg.line, source, srcModuleReason, vendorLookup: lookup };
			const result = transformImportSegment(ctx, seg, entry, usage);
			out.push(result.output);

			if (result.mapped) meta.mappedImports.push(result.mapped);
			if (result.unmapped) meta.unmappedImports.push(result.unmapped);
			if (result.pathRepair) meta.pathRepairs.push(result.pathRepair);
			if (entry && entry.kind === "vitest-api") {
				meta.vitestImports++;
				meta.vitestNames = parsed.named.map((n) => n.split(/\s+as\s+/)[0].trim()).filter(Boolean);
			}
			continue;
		}
		if (seg.type === "vi") {
			if (seg.method === VI_MOCK) {
				// Kept as-is; the adapter `vi.mock` throws at runtime with guidance.
				out.push(seg.method);
				const moduleName = extractMockedModule(source, seg.line) || null;
				meta.adapterGaps.push({
					file: vendorPath,
					line: seg.line,
					module: moduleName,
					reason: "vi.mock-not-mechanically-mappable",
					note: "vi.mock needs lazy importOriginal semantics that Bun mock.module does not provide; T03 hand-ports setup files or records this as a gap.",
				});
			} else {
				out.push(VI_METHOD_MAP[seg.method]);
			}
			continue;
		}
		out.push(seg.text);
	}

	return { output: out.join(""), meta };
}

function extractMockedModule(source, line) {
	// Find the first `vi.mock(` on/after the recorded line and read the first
	// string literal argument.
	const lines = source.split("\n");
	const start = Math.min(line - 1, lines.length - 1);
	for (let k = start; k < lines.length; k++) {
		const idx = lines[k].indexOf("vi.mock");
		if (idx === -1) continue;
		const rest = lines[k].slice(idx + "vi.mock".length);
		const m = /\(\s*['"]([^'"]+)['"]/.exec(rest);
		return m ? m[1] : null;
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

function skipReasonFor(scanFile) {
	if (scanFile.vendorPath === "setup.ts") return "setup-handported-by-t03";
	if (scanFile.fileKind === "compiled-type") return "upstream-compiled-artifact";
	if (scanFile.fileKind === "fixture-data" && /\.map$/.test(scanFile.vendorPath)) return "upstream-compiled-artifact";
	if (scanFile.fileKind === "fixture-source" && /\.test\.js$/.test(scanFile.vendorPath)) return "upstream-compiled-artifact";
	return null;
}

// Only actual test/helper source (`.test.ts` and helper `.ts`) gets the
// import/API rewrite plus provenance header. Content fixtures — `.js` module
// fixtures served over mocked HTTP, images, css, json, maps, snapshots and
// type declarations — are byte-copied because their byte content is behavior
// (exact served source / asserted line numbers).
function isRewriteSource(scanFile) {
	return (scanFile.fileKind === "test-source" || scanFile.fileKind === "helper-source") && !skipReasonFor(scanFile);
}

// Build a `(srcPath) => shimReason | null` resolver from the scan's srcModules
// entries (the authoritative not-mappable classification).
function makeSrcModuleReason(scan) {
	const entries = scan.srcModules?.entries || {};
	return (srcPath) => {
		const e = entries[srcPath];
		return e && !e.mappable ? e.shimReason : null;
	};
}

function build(scan) {
	const upstream = scan.upstream;
	const files = [];
	const unmappedImports = [];
	const adapterGaps = [];
	const skippedFiles = [];
	const notes = [];

	const stats = {
		vendorFiles: scan.files.length,
		rewritten: 0,
		byteCopied: 0,
		skipped: 0,
		srcImportsMapped: 0,
		srcImportsUnmapped: 0,
		vitestImports: 0,
		viCallRewrites: 0,
		adapterGaps: 0,
		pathRepairs: 0,
	};

	for (const scanFile of scan.files) {
		const abs = join(VENDOR_DIR, scanFile.vendorPath);
		const source = readFileSync(abs, "utf8");

		const skipReason = skipReasonFor(scanFile);
		if (skipReason) {
			files.push({
				vendorPath: scanFile.vendorPath,
				upstreamPath: scanFile.upstreamPath,
				fileKind: scanFile.fileKind,
				mode: "skipped",
				skipReason,
			});
			skippedFiles.push({
				file: scanFile.vendorPath,
				reason: skipReason,
				note:
					skipReason === "setup-handported-by-t03"
						? "T03 hand-ports tests/happy-dom/vendor/setup.ts into the bun adapter."
						: "Upstream build artifact (compiled test / declaration / sourcemap). Not part of the test suite proper; excluded to keep bun test discovery clean.",
			});
			stats.skipped++;
			continue;
		}

		if (!isRewriteSource(scanFile)) {
			files.push({
				vendorPath: scanFile.vendorPath,
				upstreamPath: scanFile.upstreamPath,
				fileKind: scanFile.fileKind,
				mode: "byte-copied",
			});
			stats.byteCopied++;
			continue;
		}

		const { output, meta } = rewriteSource({
			vendorPath: scanFile.vendorPath,
			source,
			scanImports: scanFile.imports,
			upstream,
			srcModuleReason: makeSrcModuleReason(scan),
		});

		const outputWithHeader = provenanceHeader(upstream, scanFile.vendorPath) + output;

		stats.rewritten++;
		stats.srcImportsMapped += meta.mappedImports.length;
		stats.srcImportsUnmapped += meta.unmappedImports.length;
		stats.vitestImports += meta.vitestImports;
		stats.adapterGaps += meta.adapterGaps.length;
		stats.pathRepairs += meta.pathRepairs.length;
		stats.viCallRewrites += meta.viRewrites.fn + meta.viRewrites.spyOn + meta.viRewrites.clearAllMocks + meta.viRewrites.restoreAllMocks;

		files.push({
			vendorPath: scanFile.vendorPath,
			upstreamPath: scanFile.upstreamPath,
			fileKind: scanFile.fileKind,
			mode: "rewritten",
			importsMapped: meta.mappedImports.length,
			importsUnmapped: meta.unmappedImports.length,
			viRewrites: meta.viRewrites,
		});
		unmappedImports.push(...meta.unmappedImports);
		adapterGaps.push(...meta.adapterGaps);
		notes.push(...meta.pathRepairs.map((r) => ({ ...r, kind: "local-helper-path-repair" })));
	}

	return { files, unmappedImports, adapterGaps, skippedFiles, notes, stats };
}

function makeReport(scan, built) {
	return {
		generatedBy: "scripts/rewrite-happy-dom-tests.mjs",
		schemaVersion: SCHEMA_VERSION,
		task: "T02",
		upstream: {
			repository: scan.upstream.repository,
			commit: scan.upstream.commit,
			tag: scan.upstream.tag,
			license: scan.upstream.license,
		},
		paths: {
			shimBasePath: join("tests", "happy-dom", SHIM_BASE),
			adapterImport: join("tests", "happy-dom", ADAPTER_IMPORT),
		},
		stats: built.stats,
		files: built.files,
		unmappedImports: built.unmappedImports,
		adapterGaps: built.adapterGaps,
		skippedFiles: built.skippedFiles,
		notes: built.notes,
	};
}

function writeOutputs(scan, built) {
	mkdirSync(dirname(REWRITTEN_DIR), { recursive: true });
	rmSync(REWRITTEN_DIR, { recursive: true, force: true });
	mkdirSync(REWRITTEN_DIR, { recursive: true });

	const sourceFiles = new Set(scan.files.filter((f) => isRewriteSource(f)).map((f) => f.vendorPath));

	for (const scanFile of scan.files) {
		const skipReason = skipReasonFor(scanFile);
		if (skipReason) continue;
		const abs = join(VENDOR_DIR, scanFile.vendorPath);
		const target = join(REWRITTEN_DIR, scanFile.vendorPath);
		mkdirSync(dirname(target), { recursive: true });
		if (sourceFiles.has(scanFile.vendorPath)) {
			const source = readFileSync(abs, "utf8");
			const { output } = rewriteSource({
				vendorPath: scanFile.vendorPath,
				source,
				scanImports: scanFile.imports,
				upstream: scan.upstream,
				srcModuleReason: makeSrcModuleReason(scan),
			});
			writeFileSync(target, provenanceHeader(scan.upstream, scanFile.vendorPath) + output);
		} else {
			writeFileSync(target, readFileSync(abs));
		}
	}

	writeFileSync(REPORT_PATH, JSON.stringify(makeReport(scan, built), null, 2) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (self-checks + vendor-scan cross-consistency)
// ─────────────────────────────────────────────────────────────────────────────

// Cross-check: every src-runtime / src-type import in a REWRITTEN file with
// `shimPath === null` in the scan must appear exactly once in the report's
// unmappedImports, and every report entry must correspond to such a scan entry.
function validateCrossConsistency(scan, built) {
	const problems = [];

	const reportByFile = {};
	for (const u of built.unmappedImports) {
		(reportByFile[u.file] ||= []).push(u);
	}

	for (const scanFile of scan.files) {
		if (!isRewriteSource(scanFile)) continue;
		const expected = scanFile.imports.filter((i) => (i.kind === "src-runtime" || i.kind === "src-type") && i.shimPath === null);
		const actual = (reportByFile[scanFile.vendorPath] || []).map((u) => ({ spec: u.spec, srcPath: u.srcPath, isType: !!u.isType }));

		const expectedKey = expected.map((i) => `${i.spec}|${i.srcPath}|${!!i.isType}`).sort().join("\n");
		const actualKey = actual.map((u) => `${u.spec}|${u.srcPath}|${u.isType}`).sort().join("\n");
		if (expectedKey !== actualKey) {
			problems.push(`[cross] ${scanFile.vendorPath}: unmapped src imports in report do not match vendor-scan (shimPath===null)`);
		}
	}

	// Every report entry must resolve to a scan src module that is not mappable,
	// with a matching reason.
	for (const u of built.unmappedImports) {
		const mod = scan.srcModules.entries[u.srcPath];
		if (!mod) {
			problems.push(`[cross] ${u.file}:${u.line} srcPath ${u.srcPath} not present in scan.srcModules`);
			continue;
		}
		if (mod.mappable !== false) {
			problems.push(`[cross] ${u.file}:${u.line} srcPath ${u.srcPath} is marked mappable in the scan but reported as unmapped`);
		}
		if (u.reason !== mod.shimReason) {
			problems.push(`[cross] ${u.file}:${u.line} reason ${u.reason} does not match scan shimReason ${mod.shimReason}`);
		}
	}

	return problems;
}

// Post-generation sanity checks over the written tree + report.
function validateOutputs(scan, built) {
	const problems = [];
	const files = walk(REWRITTEN_DIR).filter((p) => statSync(p).isFile());

	// The rewritten tree must mirror the vendor tree exactly (skipped excluded).
	const expectedPaths = scan.files.filter((f) => !skipReasonFor(f)).map((f) => f.vendorPath).sort();
	const actualPaths = files.map((p) => relative(REWRITTEN_DIR, p)).sort();
	if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
		problems.push("rewritten/ tree does not mirror vendor/ (minus skipped files)");
	}

	for (const rel of actualPaths) {
		const content = readFileSync(join(REWRITTEN_DIR, rel), "utf8");
		if (/\.(ts|js)$/.test(rel)) {
			if (/from\s*['"]vitest['"]/.test(content)) {
				problems.push(`${rel}: still imports from 'vitest'`);
			}
			// The only `vi.` tokens allowed to survive the rewrite are `vi.mock`
			// call sites (adapter-gap files) and literal `vi.X` inside strings,
			// templates or comments (test content). Re-tokenize the output so the
			// check is string-aware.
			for (const seg of tokenize(content)) {
				if (seg.type !== "vi") continue;
				if (seg.method !== VI_MOCK) {
					problems.push(`${rel}: unexpected bare vi. call '${seg.method}' in code`);
				}
			}
		}
		// Determinism: the provenance header (the first 14 lines) must not carry
		// timestamps or randomness; date-like strings deeper in the body are test
		// data and are allowed.
		const header = content.split("\n").slice(0, 14).join("\n");
		if (/\b20\d{2}-\d{2}-\d{2}T\d{2}/.test(header)) {
			problems.push(`${rel}: provenance header contains a timestamp (determinism violation)`);
		}
	}

	// Mapped src imports must point at the shim base path. Re-derive each
	// rewritten file's mapped imports and assert every generated spec appears in
	// the output and is relative to the shim base (path existence itself is
	// verified after T04; the frozen T01 contract is what we validate here).
	const shimBaseAbs = resolve(REPO_ROOT, "tests", "happy-dom", SHIM_BASE);
	for (const f of built.files) {
		if (f.mode !== "rewritten") continue;
		const scanFile = scan.files.find((x) => x.vendorPath === f.vendorPath);
		if (!scanFile) continue;
		const { meta } = rewriteSource({
			vendorPath: f.vendorPath,
			source: readFileSync(join(VENDOR_DIR, f.vendorPath), "utf8"),
			scanImports: scanFile.imports,
			upstream: scan.upstream,
			srcModuleReason: makeSrcModuleReason(scan),
		});
		const content = readFileSync(join(REWRITTEN_DIR, f.vendorPath), "utf8");
		for (const m of meta.mappedImports) {
			if (!content.includes(m.newSpec)) {
				problems.push(`${f.vendorPath}: mapped import ${m.spec} → ${m.newSpec} not found in output`);
				continue;
			}
			const targetAbs = resolve(join(REWRITTEN_DIR, dirname(f.vendorPath)), m.newSpec);
			const underShim = relative(shimBaseAbs, targetAbs).split(sep).every((c) => c !== "..");
			if (!underShim) problems.push(`${f.vendorPath}: mapped import ${m.newSpec} does not resolve under the shim base`);
		}
	}

	// Adapter gaps must be mirrored by adapter-imported `vi` in the file.
	for (const gap of built.adapterGaps) {
		const rel = gap.file;
		const content = readFileSync(join(REWRITTEN_DIR, rel), "utf8");
		const importLine = [...content.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*adapter\/index\.js)'/g)].map((m) => m[1]);
		const hasVi = importLine.some((names) => names.split(",").map((n) => n.trim()).includes("vi"));
		if (!hasVi) problems.push(`${rel}: adapter-gap file does not import vi from the adapter`);
	}

	return problems;
}

function printStats(built, scan) {
	const s = built.stats;
	console.log("");
	console.log("─────────────────────────────");
	console.log("happy-dom test-suite rewrite (hdunit T02)");
	console.log("─────────────────────────────");
	console.log(`vendored files    ${s.vendorFiles}`);
	console.log(`rewritten         ${s.rewritten}  (provenance header + import/API rewrite)`);
	console.log(`byte-copied       ${s.byteCopied}  (content fixtures / type decls / snapshots)`);
	console.log(`skipped           ${s.skipped}  (setup.ts → T03, upstream compiled artifacts)`);
	console.log(`src imports       ${s.srcImportsMapped} mapped → shim, ${s.srcImportsUnmapped} unmapped (recorded)`);
	console.log(`vitest imports    ${s.vitestImports} → bun:test (+ adapter)`);
	console.log(`vi call rewrites  ${s.viCallRewrites}`);
	console.log(`adapter gaps      ${s.adapterGaps} (vi.mock call sites)`);
	console.log(`path repairs      ${s.pathRepairs} (local-helper path bug)`);
	console.log(`shim base         tests/happy-dom/${SHIM_BASE}/ (frozen contract)`);
	console.log(`adapter import    tests/happy-dom/${ADAPTER_IMPORT}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function loadScan() {
	return JSON.parse(readFileSync(SCAN_PATH, "utf8"));
}

function main() {
	const args = process.argv.slice(2);
	if (args.length > 0) {
		console.error("usage: bun scripts/rewrite-happy-dom-tests.mjs  (no flags; rewritten/ is generated, not committed)");
		process.exit(2);
	}
	const scan = loadScan();
	const built = build(scan);
	writeOutputs(scan, built);

	const cross = validateCrossConsistency(scan, built);
	const outputs = validateOutputs(scan, built);
	if (cross.length > 0 || outputs.length > 0) {
		console.error("\nGENERATION FAILED VALIDATION:");
		for (const p of cross) console.error(`  - ${p}`);
		for (const p of outputs) console.error(`  - ${p}`);
		process.exitCode = 1;
		return;
	}

	printStats(built, scan);
	console.log(`\n[rewrite] wrote ${built.stats.rewritten} rewritten files, ${built.stats.byteCopied} byte-copied files to tests/happy-dom/rewritten/`);
	console.log(`[rewrite] wrote tests/happy-dom/rewrite-report.json`);
	console.log(`[rewrite] done. Re-running in place is idempotent.`);
}

if (import.meta.main) {
	main();
}

// Exported for the selftest (tests/happy-dom/rewrite-selftest/).
export {
	REPO_ROOT,
	REWRITTEN_DIR,
	SHIM_BASE,
	ADAPTER_IMPORT,
	VI_METHOD_MAP,
	VI_MOCK,
	BUN_TEST_NAMES,
	ADAPTER_NAME_ORDER,
	parseImportLine,
	provenanceHeader,
	reasonToCategory,
	rewriteSource,
	tokenize,
	collectViUsage,
	adapterSpecFor,
	shimSpecFor,
	toImportSpec,
};
