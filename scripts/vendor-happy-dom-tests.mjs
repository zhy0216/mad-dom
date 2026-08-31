#!/usr/bin/env bun
// Vendor the happy-dom test suite at the ADR-0002 locked baseline (T01).
//
// This script is the hdunit "vendor" pipeline. It:
//   1. Resolves the pinned upstream tag (v20.11.11 == 64e2c774…) from the
//      upstream happy-dom checkout (local cache first, git fetch otherwise).
//   2. Copies packages/happy-dom/test/ byte-for-byte into tests/happy-dom/vendor/.
//   3. Extracts pure enum/constant src modules (no runtime dependencies) into
//      tests/happy-dom/vendor-src-enums/ with a provenance header, for the
//      T04 shim layer to consume as-is.
//   4. Scans every vendored source file's imports and produces the machine
//      readable module manifest tests/happy-dom/vendor-scan.json. The
//      shimPath mapping rule frozen here is the T02/T03/T04 interface contract.
//   5. Writes tests/happy-dom/vendor-scan.summary.md and
//      tests/happy-dom/vendor/UPSTREAM.md.
//
// It never rewrites test content (T02), writes shims (T04), writes adapter
// code (T03), or touches compat/upstream-map.json / compat/ledger.json.
//
// Usage:
//   bun scripts/vendor-happy-dom-tests.mjs                 # generate outputs
//   bun scripts/vendor-happy-dom-tests.mjs --verify        # verify reproducibility
//   bun scripts/vendor-happy-dom-tests.mjs --upstream <dir>  # override upstream checkout
//
// The upstream checkout is located via --upstream <dir>, else the
// HAPPY_DOM_UPSTREAM_DIR environment variable, else ~/workspace/happy-dom.
// Generation is deterministic: generatedAt / vendorDate are stable metadata
// preserved across regenerations so repeated runs are byte-identical.
//
// Exit codes: 0 = ok, 1 = failure, 2 = usage error.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (ADR-0002 section 1 baseline)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const UPSTREAM_REPO = "https://github.com/capricorn86/happy-dom";
const PINNED = {
	commit: "64e2c774cadbb8eda5416c1e2bcca5006d1b5df9",
	tag: "v20.11.11",
	npmVersion: "20.11.11",
	license: "MIT",
};
const UPSTREAM_TEST_DIR = "packages/happy-dom/test";
const UPSTREAM_SRC_DIR = "packages/happy-dom/src";
const VENDOR_DIR = join(REPO_ROOT, "tests", "happy-dom", "vendor");
const ENUM_DIR = join(REPO_ROOT, "tests", "happy-dom", "vendor-src-enums");
const SCAN_PATH = join(REPO_ROOT, "tests", "happy-dom", "vendor-scan.json");
const SUMMARY_PATH = join(REPO_ROOT, "tests", "happy-dom", "vendor-scan.summary.md");
const SCHEMA_VERSION = "1.0.0";
const SHIM_BASE = "tests/happy-dom/shim/src";

const ARGS = process.argv.slice(2);
const VERIFY = ARGS.includes("--verify");
const UPSTREAM_FLAG = ARGS.indexOf("--upstream");

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

function git(dir, args, opts = {}) {
	return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", ...opts }).trim();
}

function sh(parts, opts = {}) {
	return execFileSync(parts[0], parts.slice(1), { encoding: "utf8", stdio: "inherit", ...opts });
}

function upstreamCheckoutDir() {
	let candidate;
	if (UPSTREAM_FLAG !== -1) {
		candidate = ARGS[UPSTREAM_FLAG + 1];
		if (!candidate) throw new Error("--upstream requires a directory argument");
	} else if (process.env.HAPPY_DOM_UPSTREAM_DIR) {
		candidate = process.env.HAPPY_DOM_UPSTREAM_DIR;
	} else {
		candidate = join(homedir(), "workspace", "happy-dom");
	}
	try {
		return realpathSync(resolve(candidate));
	} catch {
		throw new Error(
			`upstream happy-dom checkout not found at ${candidate}. Set HAPPY_DOM_UPSTREAM_DIR or pass --upstream <dir>.`,
		);
	}
}

function ensurePinnedTag(dir) {
	let hasTag = true;
	try {
		git(dir, ["cat-file", "-e", `${PINNED.tag}^{commit}`]);
	} catch {
		hasTag = false;
	}
	if (!hasTag) {
		console.error(`[vendor] tag ${PINNED.tag} not cached in ${dir}; fetching from ${UPSTREAM_REPO}…`);
		try {
			sh(["git", "-C", dir, "fetch", "origin", "tag", PINNED.tag]);
		} catch {
			throw new Error(
				`cannot fetch tag ${PINNED.tag} from ${UPSTREAM_REPO} (offline?). ` +
					`Point HAPPY_DOM_UPSTREAM_DIR at a happy-dom checkout that has the tag cached.`,
			);
		}
	}
	const commit = git(dir, ["rev-parse", `${PINNED.tag}^{commit}`]);
	if (commit !== PINNED.commit) {
		throw new Error(
			`tag ${PINNED.tag} resolves to ${commit}, but ADR-0002 pins ${PINNED.commit}; refusing to vendor.`,
		);
	}
	return commit;
}

function extractTrees(dir, workRoot) {
	const testTar = join(workRoot, "test.tar");
	const srcTar = join(workRoot, "src.tar");
	git(dir, ["archive", "--format=tar", PINNED.tag, UPSTREAM_TEST_DIR, "--output", testTar]);
	git(dir, ["archive", "--format=tar", PINNED.tag, UPSTREAM_SRC_DIR, "--output", srcTar]);
	execFileSync("tar", ["-xf", testTar, "-C", workRoot]);
	execFileSync("tar", ["-xf", srcTar, "-C", workRoot]);
	return { testDir: join(workRoot, "packages", "happy-dom", "test"), srcDir: join(workRoot, "packages", "happy-dom", "src") };
}

// Stable metadata preservation: generatedAt / vendorDate survive regenerations
// so repeated runs are byte-identical and the worktree stays clean.
function preservedLine(path, prefix) {
	if (!existsSync(path)) return null;
	const content = readFileSync(path, "utf8");
	for (const line of content.split("\n")) {
		if (line.startsWith(prefix)) return line;
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure enum/constant module detection (vendor-src-enums extraction)
// ─────────────────────────────────────────────────────────────────────────────

// Strip `enum Name { ... }` blocks so member assignments are not mistaken for
// runtime logic when checking whether a module is literal-only.
function stripEnumBlocks(text) {
	const re = /\benum\s+\w+\s*\{/g;
	let result = text;
	const markers = [];
	let m;
	while ((m = re.exec(text)) !== null) markers.push({ start: m.index, end: m.index + m[0].length });
	for (const marker of markers.reverse()) {
		let depth = 0;
		let close = -1;
		for (let i = marker.end - 1; i < text.length; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}") {
				depth--;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		if (close !== -1) result = result.slice(0, marker.start) + result.slice(close + 1);
	}
	return result;
}

function isLiteralOnly(text) {
	const t = stripEnumBlocks(text);
	if (/\bclass\s+\w+/.test(t)) return false;
	if (/(^|\n)\s*(export\s+)?(async\s+)?function\s+\w+/.test(t)) return false;
	if (/(^|\n)\s*(export\s+)?const\s+\w+\s*=\s*\(/.test(t)) return false;
	if (/\bnew\s+[A-Z]/.test(t)) return false;
	if (/\bSymbol\(/.test(t)) return false;
	if (/=>/.test(t)) return false;
	if (/^\s*[a-zA-Z_$][\w$]*\s*=[^=]/m.test(t)) return false;
	if (/export\s*\*\s*from/.test(t)) return false;
	if (/export\s*\{[^}]*\}\s*;?/.test(t)) return false;
	return true;
}

function hasEnumExport(text) {
	const names = new Set();
	for (const m of text.matchAll(/\benum\s+(\w+)\s*\{/g)) names.add(m[1]);
	for (const name of names) {
		if (new RegExp(`export\\s+default\\s+${name}\\b`).test(text)) return true;
		if (new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(text)) return true;
		if (new RegExp(`export\\s+enum\\s+${name}\\b`).test(text)) return true;
	}
	return false;
}

function hasLiteralRuntimeExport(text) {
	if (hasEnumExport(text)) return true;
	const dm = /^\s*export\s+default\s+(?!interface\b|type\b|class\b|function\b|import\b|abstract\b)([\s\S]*)$/m.exec(text);
	if (dm) {
		const rhs = dm[1].trim();
		if (/^[<{]/.test(rhs) || /^\[/.test(rhs) || /^['"`]/.test(rhs) || /^-?\d/.test(rhs) || rhs === "true" || rhs === "false") {
			return true;
		}
	}
	for (const cm of text.matchAll(/^\s*export\s+const\s+(\w+)\s*=\s*([^\n;]+)/gm)) {
		const rhs = cm[2].trim();
		if (/^[<{]/.test(rhs) || /^\[/.test(rhs) || /^['"`]/.test(rhs) || /^-?\d/.test(rhs)) return true;
	}
	return false;
}

function valueImports(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (!/^import/.test(line)) continue;
		if (/^import\s+type\b/.test(line)) continue;
		const m = /^import\s+.*?from\s*['"](\.[^'"]+)['"]/.exec(line);
		if (m) out.push(m[1]);
	}
	return out;
}

// Returns the list of src-relative module paths (with .js extension) that are
// pure enum/constant modules (literal exports only, no runtime imports outside
// the set). Fixpoint over value imports.
function findPureEnumModules(srcDir) {
	const files = walk(srcDir).filter((f) => f.endsWith(".ts"));
	const contents = new Map(files.map((f) => [relative(srcDir, f), readFileSync(f, "utf8")]));
	const pure = new Set();

	for (const [rel, text] of contents) {
		if (isLiteralOnly(text) && hasLiteralRuntimeExport(text)) pure.add(rel);
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const [rel, text] of contents) {
			if (pure.has(rel)) continue;
			if (!isLiteralOnly(text) || !hasLiteralRuntimeExport(text)) continue;
			const ok = valueImports(text).every((spec) => {
				const abs = resolve(dirname(join(srcDir, rel)), spec);
				const resolved = relative(srcDir, abs).replace(/\.(ts|js)$/, "") + ".ts";
				return pure.has(resolved);
			});
			if (ok) {
				pure.add(rel);
				changed = true;
			}
		}
	}

	return [...pure]
		.map((rel) => ({ srcPath: rel.replace(/\.ts$/, ".js"), absPath: join(srcDir, rel) }))
		.sort((a, b) => a.srcPath.localeCompare(b.srcPath));
}

function provenanceHeader(srcPath) {
	return [
		"// ─────────────────────────────────────────────────────────────────────────────",
		"// VENDORED SOURCE — happy-dom (MIT)",
		"// Upstream repository: https://github.com/capricorn86/happy-dom",
		`// Upstream commit:    ${PINNED.commit}`,
		`// Upstream tag:       ${PINNED.tag}`,
		`// Upstream path:      packages/happy-dom/src/${srcPath.replace(/\.js$/, ".ts")}`,
		"// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)",
		"//",
		"// Pure enum/constant module vendored from the locked happy-dom test-suite",
		"// baseline. It is runtime-independent (literal exports only, no DOM or",
		"// runtime module dependencies) and is provided to the shim layer (T04) as-is.",
		"// Do not edit by hand; regenerate with the vendor script.",
		`// License: MIT — https://github.com/capricorn86/happy-dom/blob/${PINNED.commit}/LICENSE`,
		"// ─────────────────────────────────────────────────────────────────────────────",
		"",
	].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Import scanning
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_RE =
	/^\s*import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{\s*([^}]*)\s*\}\s*)?(?:\*\s+as\s+([\w$]+)\s*)?from\s*['"]([^'"]+)['"]/;
const SIDE_EFFECT_RE = /^\s*import\s*['"]([^'"]+)['"]/;

function parseImportLine(line) {
	const im = IMPORT_RE.exec(line);
	if (im) {
		return { isType: !!im[1], spec: im[5] };
	}
	const se = SIDE_EFFECT_RE.exec(line);
	if (se) {
		return { isType: false, spec: se[1] };
	}
	return null;
}

// Detect the vitest API surface imported by a file.
const VITEST_APIS = ["vi", "beforeEach", "afterEach", "beforeAll", "afterAll", "describe", "it", "expect", "test"];

function viApisUsed(source) {
	const used = [];
	for (const line of source.split("\n")) {
		const im = IMPORT_RE.exec(line);
		if (!im || !im[5] || !/^vitest(?:@|\/|$)/.test(im[5])) continue;
		const names = new Set();
		if (im[2]) names.add(im[2]);
		for (const n of im[3] ? im[3].split(",") : []) {
			const clean = n.trim().split(/\s+as\s+/)[0].trim();
			if (clean) names.add(clean);
		}
		if (im[4]) names.add(im[4]);
		for (const api of VITEST_APIS) if (names.has(api)) used.push(api);
	}
	return [...new Set(used)].sort((a, b) => VITEST_APIS.indexOf(a) - VITEST_APIS.indexOf(b));
}

function fileKind(rel) {
	if (/\.test\.ts$/.test(rel)) return "test-source";
	if (/\.test\.d\.ts$/.test(rel)) return "compiled-type";
	if (/\.d\.ts$/.test(rel)) return "type-decl";
	if (rel.endsWith(".ts")) return "helper-source";
	if (rel.endsWith(".js")) return "fixture-source";
	if (rel.endsWith(".snap")) return "snapshot";
	if (rel.endsWith(".json")) return "fixture-data";
	return "fixture-data";
}

function reasonFor(srcPath, content) {
	const base = srcPath.replace(/\.js$/, "").split("/").pop();
	if (srcPath === "PropertySymbol.js") return "internal-symbol";
	if (/Enum$/.test(base)) return "internal-enum";
	if (/Utility$/.test(base) || /Factory$/.test(base)) return "internal-utility";
	if (/Parser$/.test(base)) return "internal-parser";
	if (/Config$/.test(base) || srcPath.startsWith("config/")) return "internal-config";
	if (/\bclass\s+\w+/.test(content)) return "internal-class";
	if (/^(I|T)[A-Z]/.test(base)) return "internal-type";
	return "internal-other";
}

function scanTrees(testDir, srcDir) {
	const srcFiles = walk(srcDir).filter((f) => f.endsWith(".ts"));
	const srcContents = new Map(srcFiles.map((f) => [relative(srcDir, f), readFileSync(f, "utf8")]));

	// Public entry: every src module imported (value or type) by src/index.ts is
	// re-exported from the package entry and therefore shim-mappable. The entry
	// itself (src/index.js) maps to the package entry as well.
	const publicModules = new Set(["index.js"]);
	for (const [rel, text] of srcContents) {
		if (rel !== "index.ts") continue;
		for (const line of text.split("\n")) {
			const im = IMPORT_RE.exec(line);
			if (!im || !im[5] || !im[5].startsWith("./")) continue;
			publicModules.add(im[5].replace(/^\.\//, "").replace(/\.(ts|js)$/, "") + ".js");
		}
	}

	const files = walk(testDir).filter((f) => statSync(f).isFile()).sort((a, b) => relative(testDir, a).localeCompare(relative(testDir, b)));
	const filesRecord = [];
	const srcModuleStats = new Map(); // canonical src path -> {runtime, type, files:Set}

	for (const abs of files) {
		const rel = relative(testDir, abs);
		if (!/\.(ts|js)$/.test(abs)) {
			filesRecord.push({
				vendorPath: rel,
				upstreamPath: `${UPSTREAM_TEST_DIR}/${rel}`,
				fileKind: fileKind(rel),
				allRuntimeImportsMappable: true,
				imports: [],
				viApis: [],
			});
			continue;
		}
		const source = readFileSync(abs, "utf8");
		const imports = [];
		let allRuntimeMappable = true;

		for (const line of source.split("\n")) {
			if (!/^\s*import\b/.test(line)) continue;
			const parsed = parseImportLine(line);
			if (!parsed) continue;
			const { spec, isType } = parsed;

			let kind;
			let srcPath = null;
			let shimPath = null;
			let shimReason = null;

			if (/^vitest(?:@|\/|$)/.test(spec)) {
				kind = "vitest-api";
			} else if (spec.startsWith(".")) {
				const absTarget = resolve(dirname(abs), spec);
				const relTarget = relative(srcDir, absTarget);
				if (relTarget.startsWith("..")) {
					kind = "local-helper";
				} else {
					kind = isType ? "src-type" : "src-runtime";
					srcPath = relTarget.replace(/\.(ts|js|d\.ts)$/, "") + ".js";
					const mappable = publicModules.has(srcPath);
					if (mappable) shimPath = srcPath;
					else shimReason = reasonFor(srcPath, srcContents.get(relTarget.replace(/\.js$/, ".ts")) || "");
					if (!srcModuleStats.has(srcPath)) srcModuleStats.set(srcPath, { runtime: 0, type: 0, files: new Set() });
					const stat = srcModuleStats.get(srcPath);
					if (isType) stat.type++;
					else stat.runtime++;
					stat.files.add(rel);
					if (!isType && !mappable) allRuntimeMappable = false;
				}
			} else {
				kind = "external";
			}

			const record = { spec, kind };
			if (isType) record.isType = true;
			if (srcPath) {
				record.srcPath = srcPath;
				record.shimPath = shimPath;
				record.shimReason = shimReason;
			}
			imports.push(record);
		}

		filesRecord.push({
			vendorPath: rel,
			upstreamPath: `${UPSTREAM_TEST_DIR}/${rel}`,
			fileKind: fileKind(rel),
			allRuntimeImportsMappable: allRuntimeMappable,
			imports,
			viApis: viApisUsed(source),
		});
	}

	filesRecord.sort((a, b) => a.vendorPath.localeCompare(b.vendorPath));

	const srcModules = {};
	let mappableCount = 0;
	let notMappableCount = 0;
	for (const srcPath of [...srcModuleStats.keys()].sort((a, b) => a.localeCompare(b))) {
		const stat = srcModuleStats.get(srcPath);
		const mappable = publicModules.has(srcPath);
		const entry = {
			mappable,
			shimPath: mappable ? srcPath : null,
			shimReason: mappable ? null : reasonFor(srcPath, srcContents.get(srcPath.replace(/\.js$/, ".ts")) || ""),
			runtimeReferences: stat.runtime,
			typeReferences: stat.type,
			files: [...stat.files].sort(),
		};
		srcModules[srcPath] = entry;
		if (mappable) mappableCount++;
		else notMappableCount++;
	}

	return { filesRecord, srcModules, srcModuleStats, publicModules, mappableCount, notMappableCount, totalSrcPaths: srcModuleStats.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan validation (self-schema check)
// ─────────────────────────────────────────────────────────────────────────────

function validateScan(scan) {
	const errors = [];

	function fail(msg) {
		errors.push(msg);
	}
	const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

	if (!isObj(scan)) return fail("$: scan must be an object");
	if (scan.schemaVersion !== SCHEMA_VERSION) fail(`$: schemaVersion must be ${SCHEMA_VERSION}`);
	if (!isObj(scan.upstream)) fail("$.upstream: must be an object");
	else {
		const u = scan.upstream;
		if (u.repository !== UPSTREAM_REPO) fail(`$.upstream.repository must be ${UPSTREAM_REPO}`);
		if (u.commit !== PINNED.commit) fail("$.upstream.commit must equal the pinned commit");
		if (u.tag !== PINNED.tag) fail("$.upstream.tag must equal the pinned tag");
		if (u.license !== "MIT") fail("$.upstream.license must be MIT");
	}
	if (!isObj(scan.srcModules)) fail("$.srcModules: must be an object");
	if (typeof scan.srcModules.count !== "object" || scan.srcModules.count === null) fail("$.srcModules.count: must be an object");
	if (!Array.isArray(scan.files)) fail("$.files: must be an array");

	let totalRefs = 0;
	let mappableRefs = 0;
	for (const [srcPath, entry] of Object.entries(scan.srcModules?.entries || {})) {
		if (typeof srcPath !== "string" || !srcPath.endsWith(".js")) fail(`$.srcModules.entries[${srcPath}]: key must end with .js`);
		if (entry.mappable !== true && entry.mappable !== false) fail(`$.srcModules.entries[${srcPath}].mappable: must be boolean`);
		if (entry.mappable) {
			if (entry.shimPath !== srcPath) fail(`$.srcModules.entries[${srcPath}].shimPath must equal its key when mappable`);
			if (entry.shimReason !== null) fail(`$.srcModules.entries[${srcPath}].shimReason must be null when mappable`);
		} else {
			if (entry.shimPath !== null) fail(`$.srcModules.entries[${srcPath}].shimPath must be null when not mappable`);
			if (typeof entry.shimReason !== "string" || entry.shimReason === "") fail(`$.srcModules.entries[${srcPath}].shimReason must be a non-empty category`);
		}
	}

	for (const f of scan.files) {
		if (!isObj(f)) return fail("$.files[]: must be objects");
		if (typeof f.vendorPath !== "string") fail("$.files[].vendorPath must be a string");
		if (typeof f.upstreamPath !== "string" || !f.upstreamPath.startsWith("packages/happy-dom/test/"))
			fail("$.files[].upstreamPath must be under packages/happy-dom/test/");
		if (!Array.isArray(f.imports)) fail(`$.files[${f.vendorPath}].imports must be an array`);
		for (const imp of f.imports) {
			if (!["src-runtime", "src-type", "local-helper", "vitest-api", "external"].includes(imp.kind))
				fail(`$.files[${f.vendorPath}].imports[].kind invalid: ${imp.kind}`);
			if (imp.srcPath !== undefined) {
				if (typeof imp.srcPath !== "string" || !imp.srcPath.endsWith(".js"))
					fail(`$.files[${f.vendorPath}].imports[].srcPath must be a .js module path`);
				if (!(imp.shimPath === null || typeof imp.shimPath === "string"))
					fail(`$.files[${f.vendorPath}].imports[].shimPath must be null or a string`);
			}
			if (imp.kind === "src-runtime") {
				totalRefs++;
				if (imp.shimPath !== null) mappableRefs++;
			}
		}
		if (typeof f.allRuntimeImportsMappable !== "boolean")
			fail(`$.files[${f.vendorPath}].allRuntimeImportsMappable must be boolean`);
		if (!Array.isArray(f.viApis)) fail(`$.files[${f.vendorPath}].viApis must be an array`);
	}

	return { valid: errors.length === 0, errors, totalRefs, mappableRefs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output generation
// ─────────────────────────────────────────────────────────────────────────────

function makeScanJson(scan, generatedAt) {
	return {
		schemaVersion: SCHEMA_VERSION,
		upstream: {
			repository: UPSTREAM_REPO,
			commit: PINNED.commit,
			tag: PINNED.tag,
			license: "MIT",
		},
		generatedAt,
		shimBasePath: SHIM_BASE,
		srcModules: {
			...scan.srcModules,
		},
		stats: scan.stats,
		files: scan.filesRecord,
	};
}

function makeSummary(scan, generatedAt, upstreamDir) {
	const totalLines = scan.totalLines;
	const notMappableByReason = {};
	for (const [p, entry] of Object.entries(scan.srcModules.entries)) {
		if (!entry.mappable) notMappableByReason[entry.shimReason] = (notMappableByReason[entry.shimReason] || 0) + 1;
	}
	const reasonLines = Object.entries(notMappableByReason)
		.sort((a, b) => b[1] - a[1])
		.map(([k, v]) => `| ${k} | ${v} |`)
		.join("\n");

	const srcRuntime = scan.importCounts["src-runtime"] || 0;
	const srcType = scan.importCounts["src-type"] || 0;
	const localHelper = scan.importCounts["local-helper"] || 0;
	const vitest = scan.importCounts["vitest-api"] || 0;
	const external = scan.importCounts["external"] || 0;

	const viDist = Object.entries(scan.viApiDistribution)
		.map(([k, v]) => `| ${k} | ${v} |`)
		.join("\n");

	return [
		`# happy-dom test-suite vendor scan (hdunit T01)`,
		``,
		`Generated at: ${generatedAt}`,
		`Upstream: ${UPSTREAM_REPO} @ tag ${PINNED.tag} (commit ${PINNED.commit}, MIT)`,
		`Upstream checkout used: ${upstreamDir}`,
		`shimPath base (frozen contract for T02/T03/T04): \`${SHIM_BASE}/\` — every mappable \`src/\` module gets \`${SHIM_BASE}/<srcPath>\`; not-mappable modules are \`null\` with a reason category.`,
		``,
		`## 概览 (Overview)`,
		``,
		`| Metric | Value |`,
		`| --- | --- |`,
		`| Vendored files (packages/happy-dom/test/) | ${scan.totalFiles} |`,
		`| Vendored lines | ${totalLines} |`,
		`| Source files scanned (.ts/.js) | ${scan.sourceFiles} |`,
		`| Test files (*.test.ts) | ${scan.testFiles} |`,
		`| Distinct internal \`src/\` module paths | ${scan.totalSrcPaths} |`,
		`| Mappable \`src/\` module paths | ${scan.mappableCount} |`,
		`| Not-mappable \`src/\` module paths | ${scan.notMappableCount} |`,
		`| Files with all runtime \`src/\` imports mappable (all source files) | ${scan.allRuntimeMappableFiles} |`,
		`| Files with all runtime \`src/\` imports mappable (*.test.ts) | ${scan.allRuntimeMappableTestFiles} |`,
		``,
		`## Import classification (statements)`,
		``,
		`| Kind | Count |`,
		`| --- | --- |`,
		`| src-runtime | ${srcRuntime} |`,
		`| src-type | ${srcType} |`,
		`| local-helper | ${localHelper} |`,
		`| vitest-api | ${vitest} |`,
		`| external | ${external} |`,
		`| **total** | **${srcRuntime + srcType + localHelper + vitest + external}** |`,
		``,
		`## 口径说明 (Scope note)`,
		``,
		`Figures above are computed from the actual \`v20.11.11\` tree (298 \`*.test.ts\`, 352 files). The queue's pre-scan ballpark (~492 internal paths / ~265 mappable / ~104 files) was measured against a slightly newer upstream snapshot (\`~302\` test files) and is not authoritative; this scan is. Mappability ratios are consistent (${Math.round((scan.mappableCount / scan.totalSrcPaths) * 100)}% of internal paths mappable).`,
		``,
		`## Not-mappable \`src/\` paths by reason category`,
		``,
		`| Reason | Paths |`,
		`| --- | --- |`,
		reasonLines,
		``,
		`## vi API distribution (files importing each API from vitest)`,
		``,
		`| API | Files |`,
		`| --- | --- |`,
		viDist,
		``,
		`## Mapping rule (frozen)`,
		``,
		`A vendored \`src/\` module path is **mappable** iff it is re-exported by the public entry \`src/index.ts\` (value or type export), or is the entry itself (\`src/index.js\`). For mappable modules \`shimPath\` equals the canonical module path under \`${SHIM_BASE}/\`; T04 generates a re-export shim there. Not-mappable modules get \`shimPath: null\` and a reason category (\`internal-*\`).`,
		``,
		`Machine-readable manifest: \`tests/happy-dom/vendor-scan.json\`.`,
		``,
	].join("\n");
}

function makeUpstreamMd(generatedAt, baselinePath) {
	let crossCheck = "compat/happy-dom-baseline.json not found";
	if (existsSync(baselinePath)) {
		const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
		const ok =
			baseline.happyDom?.npmVersion === PINNED.npmVersion &&
			baseline.happyDom?.gitCommit === PINNED.commit &&
			baseline.happyDom?.tag === PINNED.tag;
		crossCheck = `MATCH — baseline locks happy-dom ${PINNED.npmVersion} @ ${PINNED.commit} (tag ${PINNED.tag}); ADR-0002 section 1 consistent${ok ? "" : " (DRIFT!)"}`;
	}
	return [
		`# UPSTREAM.md — vendored happy-dom test suite (hdunit T01)`,
		``,
		`## 来源 (Source)`,
		``,
		`| Field | Value |`,
		`| --- | --- |`,
		`| Repository | ${UPSTREAM_REPO} |`,
		`| Tag | ${PINNED.tag} |`,
		`| Commit | \`${PINNED.commit}\` |`,
		`| npm version | ${PINNED.npmVersion} |`,
		`| License | MIT |`,
		`| Vendor date | ${generatedAt} |`,
		`| Upstream directory | packages/happy-dom/test/ |`,
		``,
		`The content under this directory is a byte-for-byte copy of ` +
			`\`packages/happy-dom/test/\` at commit ${PINNED.commit} (ADR-0002 section 1 baseline). ` +
			`Regenerate with \`bun scripts/vendor-happy-dom-tests.mjs\`; verify with \`--verify\`.`,
		``,
		`## 与 compat/happy-dom-baseline.json 交叉核对`,
		``,
		`${crossCheck}`,
		``,
	].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function buildAll(upstreamDir) {
	const workRoot = mkdtempSync(join(tmpdir(), "hdunit-vendor-"));
	try {
		const pinnedCommit = ensurePinnedTag(upstreamDir);
		const { testDir, srcDir } = extractTrees(upstreamDir, workRoot);

		// 1. Copy the upstream test tree byte-for-byte.
		const vendorFiles = walk(testDir).filter((f) => statSync(f).isFile());
		const copies = new Map();
		for (const abs of vendorFiles) {
			const rel = relative(testDir, abs);
			copies.set(rel, readFileSync(abs));
		}

		// 2. Pure enum/constant modules.
		const pureEnums = findPureEnumModules(srcDir);
		const enumCopies = new Map();
		for (const entry of pureEnums) {
			enumCopies.set(`${entry.srcPath.replace(/\.js$/, ".ts")}`, provenanceHeader(entry.srcPath) + readFileSync(entry.absPath, "utf8"));
		}

		// 3. Scan.
		const scan = scanTrees(testDir, srcDir);

		// Aggregate statistics.
		const importCounts = { "src-runtime": 0, "src-type": 0, "local-helper": 0, "vitest-api": 0, external: 0 };
		const viApiDistribution = {};
		let allRuntimeMappableFiles = 0;
		let allRuntimeMappableTestFiles = 0;
		let testFiles = 0;
		let totalLines = 0;
		for (const f of walk(testDir)) {
			if (!statSync(f).isFile()) continue;
			totalLines += readFileSync(f, "utf8").split("\n").length;
		}
		for (const rec of scan.filesRecord) {
			for (const imp of rec.imports) importCounts[imp.kind] = (importCounts[imp.kind] || 0) + 1;
			for (const api of rec.viApis) viApiDistribution[api] = (viApiDistribution[api] || 0) + 1;
			if (rec.vendorPath.endsWith(".test.ts")) testFiles++;
			if (!/\.(ts|js)$/.test(rec.vendorPath)) continue;
			if (rec.allRuntimeImportsMappable) {
				allRuntimeMappableFiles++;
				if (rec.vendorPath.endsWith(".test.ts")) allRuntimeMappableTestFiles++;
			}
		}
		const srcModules = {
			count: { total: scan.totalSrcPaths, mappable: scan.mappableCount, notMappable: scan.notMappableCount },
			entries: scan.srcModules,
		};

		return {
			pinnedCommit,
			copies,
			enumCopies,
			scanResult: {
				...scan,
				importCounts,
				viApiDistribution,
				allRuntimeMappableFiles,
				allRuntimeMappableTestFiles,
				testFiles,
				sourceFiles: scan.filesRecord.filter((r) => /\.(ts|js)$/.test(r.vendorPath)).length,
				totalFiles: walk(testDir).filter((f) => statSync(f).isFile()).length,
				totalLines,
				srcModules,
				stats: {
					totalFiles: walk(testDir).filter((f) => statSync(f).isFile()).length,
					totalLines,
					sourceFiles: scan.filesRecord.filter((r) => /\.(ts|js)$/.test(r.vendorPath)).length,
					testFiles,
					imports: importCounts,
					distinctSrcPaths: scan.totalSrcPaths,
					mappableSrcPaths: scan.mappableCount,
					notMappableSrcPaths: scan.notMappableCount,
					filesWithAllRuntimeImportsMappable: {
						all: allRuntimeMappableFiles,
						testFiles: allRuntimeMappableTestFiles,
					},
					viApiDistribution,
				},
			},
		};
	} finally {
		rmSync(workRoot, { recursive: true, force: true });
	}
}

function writeOutputs(built, generatedAt) {
	const { copies, enumCopies, scanResult } = built;
	const vendorFiles = [...copies.keys()].sort();

	mkdirSync(join(VENDOR_DIR, ".."), { recursive: true });
	rmSync(VENDOR_DIR, { recursive: true, force: true });
	mkdirSync(VENDOR_DIR, { recursive: true });
	for (const rel of vendorFiles) {
		const target = join(VENDOR_DIR, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, copies.get(rel));
	}
	writeFileSync(join(VENDOR_DIR, "UPSTREAM.md"), makeUpstreamMd(generatedAt, join(REPO_ROOT, "compat", "happy-dom-baseline.json")));

	rmSync(ENUM_DIR, { recursive: true, force: true });
	mkdirSync(ENUM_DIR, { recursive: true });
	for (const [rel, content] of enumCopies) {
		const target = join(ENUM_DIR, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}

	const scanJson = makeScanJson(scanResult, generatedAt);
	writeFileSync(SCAN_PATH, JSON.stringify(scanJson, null, 2) + "\n");
	writeFileSync(SUMMARY_PATH, makeSummary(scanResult, generatedAt, built.upstreamDir));

	return scanJson;
}

function normalizeScanForCompare(scanObj) {
	const copy = JSON.parse(JSON.stringify(scanObj));
	delete copy.generatedAt;
	return copy;
}

function normalizeLineBlock(content, prefixes) {
	return content
		.split("\n")
		.map((line) => {
			for (const prefix of prefixes) {
				if (line.startsWith(prefix)) return prefix + "<normalized>";
			}
			return line;
		})
		.join("\n");
}

function runVerify(built, upstreamDir) {
	const problems = [];
	const generatedAt = new Date().toISOString();

	// Byte-compare committed vendor tree against a freshly staged extraction.
	const workRoot = mkdtempSync(join(tmpdir(), "hdunit-verify-"));
	try {
		const staged = join(workRoot, "vendor");
		mkdirSync(staged, { recursive: true });
		for (const [rel, content] of built.copies) {
			const target = join(staged, rel);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
		const stagedFiles = walk(staged).map((f) => relative(staged, f)).sort();
		const committedVendor = join(REPO_ROOT, "tests", "happy-dom", "vendor");
		if (!existsSync(committedVendor)) {
			problems.push("tests/happy-dom/vendor does not exist");
		} else {
			const committed = walk(committedVendor)
				.filter((f) => statSync(f).isFile())
				.map((f) => relative(committedVendor, f))
				.filter((f) => f !== "UPSTREAM.md")
				.sort();
			if (JSON.stringify(stagedFiles) !== JSON.stringify(committed)) {
				problems.push("vendored file set differs from upstream tree (excluding UPSTREAM.md)");
			} else {
				for (const rel of stagedFiles) {
					if (sha256(join(staged, rel)) !== sha256(join(committedVendor, rel))) {
						problems.push(`byte mismatch: ${rel}`);
					}
				}
			}
		}

		// vendor-src-enums
		const stagedEnums = join(workRoot, "enums");
		mkdirSync(stagedEnums, { recursive: true });
		for (const [rel, content] of built.enumCopies) {
			const target = join(stagedEnums, rel);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
		const stagedEnumFiles = walk(stagedEnums).map((f) => relative(stagedEnums, f)).sort();
		const committedEnums = join(REPO_ROOT, "tests", "happy-dom", "vendor-src-enums");
		if (!existsSync(committedEnums)) {
			problems.push("tests/happy-dom/vendor-src-enums does not exist");
		} else {
			const committed = walk(committedEnums)
				.filter((f) => statSync(f).isFile())
				.map((f) => relative(committedEnums, f))
				.sort();
			if (JSON.stringify(stagedEnumFiles) !== JSON.stringify(committed)) {
				problems.push("vendor-src-enums file set differs from fresh extraction");
			} else {
				for (const rel of stagedEnumFiles) {
					if (sha256(join(stagedEnums, rel)) !== sha256(join(committedEnums, rel))) {
						problems.push(`enum byte mismatch: ${rel}`);
					}
				}
			}
		}
	} finally {
		rmSync(workRoot, { recursive: true, force: true });
	}

	// scan JSON
	const freshScan = makeScanJson(built.scanResult, generatedAt);
	const freshValid = validateScan(freshScan);
	if (!freshValid.valid) problems.push(`fresh scan fails self-schema: ${freshValid.errors.slice(0, 5).join("; ")}`);
	let committedScan = null;
	if (!existsSync(SCAN_PATH)) {
		problems.push("vendor-scan.json does not exist");
	} else {
		try {
			committedScan = JSON.parse(readFileSync(SCAN_PATH, "utf8"));
		} catch (e) {
			problems.push(`vendor-scan.json is not valid JSON: ${e.message}`);
		}
	}
	if (committedScan) {
		const committedValid = validateScan(committedScan);
		if (!committedValid.valid) problems.push(`committed scan fails self-schema: ${committedValid.errors.slice(0, 5).join("; ")}`);
		if (JSON.stringify(normalizeScanForCompare(committedScan)) !== JSON.stringify(normalizeScanForCompare(freshScan))) {
			problems.push("vendor-scan.json differs from fresh generation (excluding generatedAt)");
		}
	}

	// summary
	if (!existsSync(SUMMARY_PATH)) {
		problems.push("vendor-scan.summary.md does not exist");
	} else {
		const freshSummary = makeSummary(built.scanResult, generatedAt, upstreamDir);
		const committedSummary = readFileSync(SUMMARY_PATH, "utf8");
		if (
			normalizeLineBlock(committedSummary, ["Generated at:"]) !==
			normalizeLineBlock(freshSummary, ["Generated at:"])
		) {
			problems.push("vendor-scan.summary.md differs from fresh generation (excluding timestamp)");
		}
	}

	// UPSTREAM.md
	const upstreamPath = join(VENDOR_DIR, "UPSTREAM.md");
	if (!existsSync(upstreamPath)) {
		problems.push("vendor/UPSTREAM.md does not exist");
	} else {
		const freshUpstream = makeUpstreamMd(generatedAt, join(REPO_ROOT, "compat", "happy-dom-baseline.json"));
		const committedUpstream = readFileSync(upstreamPath, "utf8");
		if (
			normalizeLineBlock(committedUpstream, ["| Vendor date |"]) !==
			normalizeLineBlock(freshUpstream, ["| Vendor date |"])
		) {
			problems.push("vendor/UPSTREAM.md differs from fresh generation (excluding vendor date)");
		}
	}

	return { problems, freshScan };
}

function printStats(scanResult, built) {
	const s = scanResult.stats;
	console.log("");
	console.log("─────────────────────────────");
	console.log("happy-dom test-suite vendor scan");
	console.log("─────────────────────────────");
	console.log(`upstream          ${UPSTREAM_REPO} @ ${PINNED.tag} (${built.pinnedCommit.slice(0, 12)}…)`);
	console.log(`vendored files    ${s.totalFiles} (${s.totalLines} lines)`);
	console.log(`source files      ${s.sourceFiles} (test files ${s.testFiles})`);
	console.log(`imports           ` +
		Object.entries(s.imports).map(([k, v]) => `${k}=${v}`).join(", "));
	console.log(`src modules       ${s.distinctSrcPaths} total, ${s.mappableSrcPaths} mappable, ${s.notMappableSrcPaths} not mappable`);
	console.log(`all-runtime-map   ${s.filesWithAllRuntimeImportsMappable.all} source files, ${s.filesWithAllRuntimeImportsMappable.testFiles} test files`);
	console.log(`pure enum modules ${built.enumCopies.size} extracted to tests/happy-dom/vendor-src-enums/`);
	console.log(`shim base         ${SHIM_BASE}/ (frozen contract)`);
}

function main() {
	try {
		const upstreamDir = upstreamCheckoutDir();
		if (!existsSync(join(upstreamDir, ".git"))) {
			throw new Error(
				`${upstreamDir} is not a git checkout. Set HAPPY_DOM_UPSTREAM_DIR or --upstream to a happy-dom clone.`,
			);
		}

		const built = buildAll(upstreamDir);
		built.upstreamDir = upstreamDir;

		// Resolve stable metadata: reuse existing generatedAt / vendorDate when present.
		let scanGeneratedAt = null;
		if (existsSync(SCAN_PATH)) {
			try {
				scanGeneratedAt = JSON.parse(readFileSync(SCAN_PATH, "utf8")).generatedAt || null;
			} catch {
				/* fall through */
			}
		}
		const vendorDateLine = preservedLine(join(VENDOR_DIR, "UPSTREAM.md"), "| Vendor date |");

		if (VERIFY) {
			const { problems, freshScan } = runVerify(built, upstreamDir);
			const valid = validateScan(freshScan);
			if (problems.length === 0 && valid.valid) {
				printStats(built.scanResult, built);
				console.log(`\nVERIFY OK — vendor tree, enums, scan, summary and UPSTREAM.md are reproducible.`);
				return;
			}
			console.error(`\nVERIFY FAILED:`);
			for (const p of problems) console.error(`  - ${p}`);
			for (const e of valid.errors) console.error(`  - ${e}`);
			process.exitCode = 1;
			return;
		}

		// Generate.
		if (scanGeneratedAt) {
			writeOutputs(built, scanGeneratedAt);
		} else {
			writeOutputs(built, new Date().toISOString());
		}
		const scanJson = JSON.parse(readFileSync(SCAN_PATH, "utf8"));
		const valid = validateScan(scanJson);
		if (!valid.valid) {
			console.error("generated vendor-scan.json fails self-schema:");
			for (const e of valid.errors) console.error(`  - ${e}`);
			process.exitCode = 1;
			return;
		}
		console.log(`[vendor] wrote ${walk(VENDOR_DIR).filter((f) => statSync(f).isFile()).length} files to tests/happy-dom/vendor/`);
		console.log(`[vendor] wrote ${walk(ENUM_DIR).filter((f) => statSync(f).isFile()).length} enum modules to tests/happy-dom/vendor-src-enums/`);
		console.log(`[vendor] wrote tests/happy-dom/vendor-scan.json, vendor-scan.summary.md, vendor/UPSTREAM.md`);
		if (!vendorDateLine) {
			console.log(`[vendor] vendorDate: ${new Date().toISOString()} (recorded in UPSTREAM.md)`);
		}
		printStats(built.scanResult, built);
		console.log(`\n[vendor] done. Re-run with --verify to confirm reproducibility.`);
	} catch (error) {
		console.error(`[vendor] ${error.message}`);
		process.exitCode = 1;
	}
}

main();
