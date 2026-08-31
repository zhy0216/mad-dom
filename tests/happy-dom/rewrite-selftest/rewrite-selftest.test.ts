// Selftest for the hdunit T02 mechanical rewrite pipeline
// (scripts/rewrite-happy-dom-tests.mjs).
//
// The tests run the pure rewrite core against fixed sample inputs and assert
// every rule branch without depending on the full vendored suite: src-path
// mapping, vitest→bun:test + adapter split, vi API rewrites, vi.mock
// adapter-gap registration, local-helper preservation / path repair, import
// type preservation, template/string awareness, provenance determinism and
// idempotency.

import { describe, expect, it } from "bun:test";
import {
	ADAPTER_IMPORT,
	REPO_ROOT,
	adapterSpecFor,
	parseImportLine,
	provenanceHeader,
	reasonToCategory,
	rewriteSource,
	shimSpecFor,
	toImportSpec,
} from "../../../scripts/rewrite-happy-dom-tests.mjs";

const UPSTREAM = {
	repository: "https://github.com/capricorn86/happy-dom",
	commit: "1111111111111111111111111111111111111111",
	tag: "v-fake",
	license: "MIT",
};

// Build a vendor-scan-style import record.
function imp(spec, kind, opts = {}) {
	const rec = { spec, kind };
	if (opts.isType) rec.isType = true;
	if (opts.srcPath !== undefined) rec.srcPath = opts.srcPath;
	if (opts.shimPath !== undefined) rec.shimPath = opts.shimPath;
	if (opts.shimReason !== undefined) rec.shimReason = opts.shimReason;
	return rec;
}

function rewrite(vendorPath, source, scanImports, opts = {}) {
	return rewriteSource({
		vendorPath,
		source,
		scanImports,
		upstream: UPSTREAM,
		srcModuleReason: opts.srcModuleReason,
		vendorLookup: opts.vendorLookup,
	});
}

// `rewriteSource` returns the transformed source without the provenance header
// (the pipeline prepends it when writing files), so the selftest asserts on the
// full output lines.
function body(output) {
	return output.split("\n");
}

describe("provenance header", () => {
	it("is fixed (no timestamps) and repeatable", () => {
		const a = provenanceHeader(UPSTREAM, "css/CSSParser.test.ts");
		const b = provenanceHeader(UPSTREAM, "css/CSSParser.test.ts");
		expect(a).toBe(b);
		expect(a).toContain("1111111111111111111111111111111111111111");
		expect(a).toContain("packages/happy-dom/test/css/CSSParser.test.ts");
		expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});
});

describe("src path mapping", () => {
	const SRC = imp("../../src/window/Window.js", "src-runtime", { srcPath: "window/Window.js", shimPath: "window/Window.js", shimReason: null });
	const SRC_NS = imp("../../src/PropertySymbol.js", "src-runtime", { srcPath: "PropertySymbol.js", shimPath: "PropertySymbol.js", shimReason: null });
	const SRC_NAMED = imp("../src/index.js", "src-runtime", { srcPath: "index.js", shimPath: "index.js", shimReason: null });
	const SRC_TYPE = imp("../../src/nodes/document/Document.js", "src-type", { isType: true, srcPath: "nodes/document/Document.js", shimPath: "nodes/document/Document.js", shimReason: null });

	it("rewrites default imports to the shim path", () => {
		const { output, meta } = rewrite("window/Window.test.ts", "import Window from '../../src/window/Window.js';\nconst w = new Window();\n", [SRC]);
		expect(body(output)[0]).toBe("import Window from '../../shim/src/window/Window.js';");
		expect(output).toContain("const w = new Window();");
		expect(meta.mappedImports).toHaveLength(1);
		expect(meta.mappedImports[0].newSpec).toBe("../../shim/src/window/Window.js");
	});

	it("rewrites namespace imports to the shim path", () => {
		const { output } = rewrite("dom/DOMTokenList.test.ts", "import * as PropertySymbol from '../../src/PropertySymbol.js';\n", [SRC_NS]);
		expect(body(output)[0]).toBe("import * as PropertySymbol from '../../shim/src/PropertySymbol.js';");
	});

	it("rewrites named imports from src/index.js to the shim index", () => {
		const { output } = rewrite("index.test.ts", "import { BrowserErrorCaptureEnum } from '../src/index.js';\n", [SRC_NAMED]);
		expect(body(output)[0]).toBe("import { BrowserErrorCaptureEnum } from '../shim/src/index.js';");
	});

	it("preserves `import type` for mapped type imports", () => {
		const { output } = rewrite("query-selector/QuerySelector.test.ts", "import type Document from '../../src/nodes/document/Document.js';\n", [SRC_TYPE]);
		expect(body(output)[0]).toBe("import type Document from '../../shim/src/nodes/document/Document.js';");
	});

	it("keeps unmapped src imports untouched and records them", () => {
		const { output, meta } = rewrite(
			"css/CSSParser.test.ts",
			"import CSSParser from '../../src/css/utilities/CSSParser.js';\nconst p = new CSSParser();\n",
			[imp("../../src/css/utilities/CSSParser.js", "src-runtime", { srcPath: "css/utilities/CSSParser.js", shimPath: null, shimReason: "internal-parser" })],
			{ srcModuleReason: () => "internal-parser" }
		);
		expect(body(output)[0]).toBe("import CSSParser from '../../src/css/utilities/CSSParser.js';");
		expect(output).toContain("const p = new CSSParser();");
		expect(meta.unmappedImports).toHaveLength(1);
		expect(meta.unmappedImports[0].reason).toBe("internal-parser");
		expect(meta.unmappedImports[0].category).toBe("internal-only-module");
	});

	it("prefers the authoritative module-level reason over the per-import record", () => {
		const { meta } = rewrite(
			"browser/BrowserFrame.test.ts",
			"import Fetch from '../../src/fetch/Fetch';\n",
			[imp("../../src/fetch/Fetch", "src-runtime", { srcPath: "fetch/Fetch.js", shimPath: null, shimReason: "internal-other" })],
			{ srcModuleReason: () => "internal-class" }
		);
		expect(meta.unmappedImports[0].reason).toBe("internal-class");
	});

	it("maps internal-symbol to the propertysymbol category", () => {
		const { meta } = rewrite(
			"event/Event.test.ts",
			"import * as PropertySymbol from '../../src/PropertySymbol.js';\n",
			[imp("../../src/PropertySymbol.js", "src-runtime", { srcPath: "PropertySymbol.js", shimPath: null, shimReason: "internal-symbol" })],
			{ srcModuleReason: () => "internal-symbol" }
		);
		expect(meta.unmappedImports[0].category).toBe("propertysymbol");
	});
});

describe("vitest → bun:test + adapter", () => {
	it("splits a vi-importing vitest line and rewrites vi.* calls", () => {
		const source = [
			"import { beforeEach, describe, it, expect, vi } from 'vitest';",
			"",
			"beforeEach(() => {",
			"\tvi.restoreAllMocks();",
			"});",
			"it('spies', () => {",
			"\tvi.fn(() => 1);",
			"\tvi.spyOn(obj, 'm');",
			"});",
			"",
		].join("\n");
		const { output, meta } = rewrite("console/VirtualConsole.test.ts", source, [imp("vitest", "vitest-api")]);
		const lines = body(output);
		expect(lines[0]).toBe("import { beforeEach, describe, it, expect, mock, spyOn } from 'bun:test';");
		expect(lines[1]).toBe("import { restoreAllMocks } from '../../adapter/index.js';");
		expect(lines[4]).toBe("\trestoreAllMocks();");
		expect(lines[7]).toBe("\tmock(() => 1);");
		expect(lines[8]).toBe("\tspyOn(obj, 'm');");
		expect(meta.vitestImports).toBe(1);
		expect(meta.viRewrites).toEqual({ fn: 1, spyOn: 1, clearAllMocks: 0, restoreAllMocks: 1, mock: 0 });
	});

	it("maps vi.clearAllMocks to the adapter clearAllMocks", () => {
		const source = ["import { afterEach, describe, it, expect, vi } from 'vitest';", "afterEach(() => {", "\tvi.clearAllMocks();", "});", ""].join("\n");
		const { output, meta } = rewrite("window/DetachedWindowAPI.test.ts", source, [imp("vitest", "vitest-api")]);
		const lines = body(output);
		expect(lines[0]).toBe("import { afterEach, describe, it, expect } from 'bun:test';");
		expect(lines[1]).toBe("import { clearAllMocks } from '../../adapter/index.js';");
		expect(lines[3]).toBe("\tclearAllMocks();");
		expect(meta.viRewrites.clearAllMocks).toBe(1);
	});

	it("emits only a bun:test line when no adapter name is needed", () => {
		const source = ["import { describe, it, expect } from 'vitest';", "describe('x', () => { it('y', () => {}); });", ""].join("\n");
		const { output } = rewrite("css/CSS.test.ts", source, [imp("vitest", "vitest-api")]);
		const lines = body(output);
		expect(lines[0]).toBe("import { describe, it, expect } from 'bun:test';");
		expect(lines.join("\n")).not.toContain("adapter");
	});
});

describe("vi.mock adapter gap", () => {
	it("keeps vi.mock, imports vi from the adapter and records the gap", () => {
		const source = ["import { beforeEach, describe, it, vi, expect } from 'vitest';", "", "vi.mock('ws', () => {", "\tclass WebSocketMock {}", "\treturn WebSocketMock;", "});", ""].join("\n");
		const { output, meta } = rewrite("web-socket/WebSocket.test.ts", source, [imp("vitest", "vitest-api")]);
		const lines = body(output);
		expect(lines[0]).toBe("import { beforeEach, describe, it, expect } from 'bun:test';");
		expect(lines[1]).toBe("import { vi } from '../../adapter/index.js';");
		expect(lines[3]).toBe("vi.mock('ws', () => {");
		expect(meta.adapterGaps).toHaveLength(1);
		expect(meta.adapterGaps[0].module).toBe("ws");
		expect(meta.adapterGaps[0].file).toBe("web-socket/WebSocket.test.ts");
	});
});

describe("local-helper imports", () => {
	it("preserves in-tree local-helper imports verbatim", () => {
		const { output } = rewrite(
			"custom-element/CustomElementRegistry.test.ts",
			"import CustomElement from '../CustomElement.js';\n",
			[imp("../CustomElement.js", "local-helper")],
			{ vendorLookup: { resolveTs: () => true, findByBasename: () => [] } }
		);
		expect(body(output)[0]).toBe("import CustomElement from '../CustomElement.js';");
	});

	it("leaves deliberately dangling fixture imports untouched", () => {
		const { output, meta } = rewrite(
			"nodes/html-script-element/modules-with-not-found-error/utilities/stringUtility.js",
			"import { notFound } from './notFound.js';\n",
			[imp("./notFound.js", "local-helper")],
			{ vendorLookup: { resolveTs: () => null, findByBasename: () => [] } }
		);
		expect(body(output)[0]).toBe("import { notFound } from './notFound.js';");
		expect(meta.pathRepairs).toHaveLength(0);
	});

	it("repairs the upstream path bug and records it", () => {
		const { output, meta } = rewrite(
			"window/Window.test.ts",
			"import CustomElement from '../../test/CustomElement.js';\n",
			[imp("../../test/CustomElement.js", "local-helper")],
			{ vendorLookup: { resolveTs: () => null, findByBasename: () => [`${REPO_ROOT}/tests/happy-dom/vendor/CustomElement.ts`] } }
		);
		expect(body(output)[0]).toBe("import CustomElement from '../CustomElement.js';");
		expect(meta.pathRepairs).toHaveLength(1);
		expect(meta.pathRepairs[0].newSpec).toBe("../CustomElement.js");
	});
});

describe("external imports", () => {
	it("leaves external and side-effect imports untouched", () => {
		const source = ["import vm from 'vm';", "import { Blob as NodeJSBlob } from 'buffer';", "import '../types.d.js';", ""].join("\n");
		const { output } = rewrite(
			"fetch/Fetch.test.ts",
			source,
			[imp("vm", "external"), imp("buffer", "external"), imp("../types.d.js", "local-helper")],
			{ vendorLookup: { resolveTs: () => true, findByBasename: () => [] } }
		);
		const lines = body(output);
		expect(lines[0]).toBe("import vm from 'vm';");
		expect(lines[1]).toBe("import { Blob as NodeJSBlob } from 'buffer';");
		expect(lines[2]).toBe("import '../types.d.js';");
	});
});

describe("string/template awareness (fidelity)", () => {
	it("does not rewrite vi.* inside strings", () => {
		const source = ["import { describe, it, expect } from 'vitest';", "describe('vi.spyOn()', () => {});", ""].join("\n");
		const { output } = rewrite("storage/Storage.test.ts", source, [imp("vitest", "vitest-api")]);
		expect(body(output)[1]).toBe("describe('vi.spyOn()', () => {});");
	});

	it("does not touch import-looking text inside template literals", () => {
		const source = [
			"import Window from '../../src/window/Window.js';",
			"const code = `",
			"import StringUtility from \"../utilities/StringUtility.js\";",
			"import CSS from '../css/data.css' with { type: \"css\" };",
			"`;",
			"",
		].join("\n");
		const srcImp = imp("../../src/window/Window.js", "src-runtime", { srcPath: "window/Window.js", shimPath: "window/Window.js", shimReason: null });
		const { output } = rewrite("module/ECMAScriptModuleCompiler.test.ts", source, [srcImp]);
		const lines = body(output);
		expect(lines[0]).toBe("import Window from '../../shim/src/window/Window.js';");
		expect(lines[2]).toBe("import StringUtility from \"../utilities/StringUtility.js\";");
		expect(lines[3]).toBe("import CSS from '../css/data.css' with { type: \"css\" };");
	});

	it("does not touch vi.* inside templates or comments", () => {
		const source = ["const s = `x${a} vi.fn() y`;", "// vi.spyOn(a, 'b')", "const ok = true;", ""].join("\n");
		const { output } = rewrite("dummy/x.test.ts", source, []);
		expect(body(output)[0]).toBe("const s = `x${a} vi.fn() y`;");
		expect(body(output)[1]).toBe("// vi.spyOn(a, 'b')");
		expect(body(output)[2]).toBe("const ok = true;");
	});
});

describe("parse/edge helpers", () => {
	it("parses import line shapes used by the suite", () => {
		expect(parseImportLine("import Window from '../../src/window/Window.js';").spec).toBe("../../src/window/Window.js");
		expect(parseImportLine("import type Document from '../../src/nodes/document/Document.js';").isType).toBe(true);
		expect(parseImportLine("import * as PropertySymbol from '../../src/PropertySymbol.js';").namespace).toBe("PropertySymbol");
		expect(parseImportLine("import { beforeEach, describe, it, expect, vi } from 'vitest';").named).toContain("vi");
		expect(parseImportLine("import '../types.d.js';").sideEffect).toBe(true);
		expect(parseImportLine("import { Blob as NodeJSBlob } from 'buffer';").named[0]).toBe("Blob as NodeJSBlob");
	});

	it("computes correct shim and adapter specs at different depths", () => {
		expect(shimSpecFor("index.test.ts", "index.js")).toBe("../shim/src/index.js");
		expect(shimSpecFor("css/CSSParser.test.ts", "css/CSSStyleSheet.js")).toBe("../../shim/src/css/CSSStyleSheet.js");
		expect(shimSpecFor("nodes/html-slot-element/CustomElementWithSlot.ts", "nodes/html-element/HTMLElement.js")).toBe("../../../shim/src/nodes/html-element/HTMLElement.js");
		expect(adapterSpecFor("index.test.ts")).toBe("../adapter/index.js");
		expect(adapterSpecFor("console/VirtualConsole.test.ts")).toBe("../../adapter/index.js");
		expect(ADAPTER_IMPORT).toBe("adapter/index.js");
		expect(toImportSpec("shim/src/x.js")).toBe("./shim/src/x.js");
	});

	it("maps every scan reason category", () => {
		expect(reasonToCategory("internal-symbol")).toBe("propertysymbol");
		for (const r of ["internal-enum", "internal-utility", "internal-parser", "internal-config", "internal-class", "internal-type", "internal-other"]) {
			expect(reasonToCategory(r)).toBe("internal-only-module");
		}
		expect(reasonToCategory("mystery")).toBe("other");
	});
});

describe("idempotency", () => {
	it("rewriting twice produces identical output", () => {
		const source = [
			"import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';",
			"import Window from '../../src/window/Window.js';",
			"import Fetch from '../../src/fetch/Fetch.js';",
			"beforeEach(() => { vi.fn(); vi.spyOn(x, 'y'); });",
			"afterEach(() => { vi.restoreAllMocks(); });",
			"",
		].join("\n");
		const scanImports = [
			imp("vitest", "vitest-api"),
			imp("../../src/window/Window.js", "src-runtime", { srcPath: "window/Window.js", shimPath: "window/Window.js", shimReason: null }),
			imp("../../src/fetch/Fetch.js", "src-runtime", { srcPath: "fetch/Fetch.js", shimPath: null, shimReason: "internal-class" }),
		];
		const first = rewrite("browser/Browser.test.ts", source, scanImports, { srcModuleReason: () => "internal-class" });
		// Rewriting the same input again yields the identical output (pure function).
		const again = rewrite("browser/Browser.test.ts", source, scanImports, { srcModuleReason: () => "internal-class" });
		expect(again.output).toBe(first.output);
		// Feeding the already-rewritten output back into the rewrite is a no-op.
		const second = rewrite("browser/Browser.test.ts", first.output, scanImports, { srcModuleReason: () => "internal-class" });
		expect(second.output).toBe(first.output);
	});
});
