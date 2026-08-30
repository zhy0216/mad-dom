// WPT case probe (T48).
//
// Runs one vendored WPT case in a fresh Bun process against a freshly minted
// MAD DOM window. The parent (runner.js) never imports the implementation; this
// child performs the whole case run and writes a `mad-dom-wpt-case/1` envelope.
// The globals injected here are exactly what the vendored cases reference and
// what MAD DOM can honestly provide: `window` / `document` from a fresh window,
// the facade `Node` / `NodeList` / `Document` classes, the assertion/test
// surface from the testharness shim, and a `document.implementation` stub that
// represents the not-yet-implemented DOMImplementation API (dependent tests
// then fail individually instead of cascading).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createWindow, Document as DocumentFacade } from "../../index.js";
import { Node as NodeFacade } from "../../js/facade/extensions/node.js";
import { NodeList as NodeListFacade } from "../../js/facade/extensions/child-nodelist.js";
import { createHarness } from "./testharness.js";

const RUNNER_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(RUNNER_DIR, "..", "..");

const ENVELOPE_SCHEMA = "mad-dom-wpt-case/1";
const ASYNC_TIMEOUT_MS = 5_000;

function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = match[1] ?? "";
    if (/\bsrc\s*=/.test(attributes)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

async function waitForPending(harness) {
  const deadline = Date.now() + ASYNC_TIMEOUT_MS;
  while (harness.pending > 0 && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  }
}

function evaluateBody(body, harness, globals) {
  const parameterNames = [
    "window",
    "document",
    "Node",
    "NodeList",
    "Element",
    "Text",
    "Comment",
    "Document",
    "DocumentFragment",
    "HTMLDocument",
    "DOMTokenList",
    "DOMException",
    "setup",
    "test",
    "async_test",
    "promise_test",
    "done",
    "assert_true",
    "assert_false",
    "assert_equals",
    "assert_not_equals",
    "assert_array_equals",
    "assert_own_property",
    "assert_inherits",
    "assert_throws",
    "assert_throws_dom",
    "assert_unreached",
    "format_value",
    "fail",
    "assert",
  ];
  const parameterValues = [
    globals.window,
    globals.document,
    globals.Node,
    globals.NodeList,
    globals.Element,
    globals.Text,
    globals.Comment,
    globals.Document,
    globals.DocumentFragment,
    globals.HTMLDocument,
    globals.DOMTokenList,
    globals.DOMException,
    harness.setup,
    harness.test,
    harness.async_test,
    harness.promise_test,
    harness.done,
    harness.assert_true,
    harness.assert_false,
    harness.assert_equals,
    harness.assert_not_equals,
    harness.assert_array_equals,
    harness.assert_own_property,
    harness.assert_inherits,
    harness.assert_throws,
    harness.assert_throws_dom,
    harness.assert_unreached,
    harness.format_value,
    harness.fail,
    harness.assert,
  ];
  const evaluate = new Function(...parameterNames, body);
  evaluate(...parameterValues);
}

async function main() {
  const [, , localPath, outPath] = process.argv;
  const casePath = join(REPO_ROOT, localPath);
  const envelope = { schema: ENVELOPE_SCHEMA, infraError: null, results: null };
  let html;
  try {
    html = readFileSync(casePath, "utf8");
  } catch (error) {
    envelope.infraError = { name: "Error", message: `cannot read case: ${error.message}` };
    writeFileSync(outPath, JSON.stringify(envelope));
    process.exit(1);
  }

  let windowFacade;
  try {
    windowFacade = createWindow();
  } catch (error) {
    envelope.infraError = { name: "Error", message: `cannot create window: ${error.message}` };
    writeFileSync(outPath, JSON.stringify(envelope));
    process.exit(1);
  }

  const documentFacade = windowFacade.document;
  // A stub for the not-yet-implemented DOMImplementation API: dependent tests
  // exercise it through plain objects and fail individually rather than
  // cascading a setup error over the whole file.
  const implementationStub = {
    createDocument() {
      return {};
    },
    createHTMLDocument() {
      return {};
    },
    createDocumentType() {
      return {};
    },
  };

  const globals = {
    window: windowFacade,
    document: documentFacade,
    Node: NodeFacade,
    NodeList: NodeListFacade,
    Element: undefined,
    Text: undefined,
    Comment: undefined,
    Document: DocumentFacade,
    DocumentFragment: undefined,
    HTMLDocument: undefined,
    DOMTokenList: undefined,
    DOMException: globalThis.DOMException,
  };

  // The injection is scoped to this child process only; globalThis pollution
  // here mirrors what a browser test harness would provide and is torn down by
  // the process boundary (runner.js spawns one fresh process per case).
  globalThis.window = windowFacade;
  globalThis.self = windowFacade;
  globalThis.document = documentFacade;
  globalThis.Node = NodeFacade;
  globalThis.NodeList = NodeListFacade;
  globalThis.Document = DocumentFacade;
  globalThis.DOMException = globalThis.DOMException;
  documentFacade.implementation = implementationStub;
  globalThis.document.implementation = implementationStub;

  const harness = createHarness();
  try {
    const bodies = extractInlineScripts(html);
    if (bodies.length === 0) {
      envelope.infraError = { name: "Error", message: "no inline <script> test bodies found" };
      writeFileSync(outPath, JSON.stringify(envelope));
      process.exit(1);
    }
    for (const body of bodies) {
      evaluateBody(body, harness, globals);
    }
    await waitForPending(harness);
    envelope.results = harness.results;
  } catch (error) {
    envelope.infraError = { name: "Error", message: `${error.name}: ${error.message}` };
  } finally {
    try {
      windowFacade.destroy();
    } catch {
      // A destroyed window is already torn down; nothing to report.
    }
  }
  writeFileSync(outPath, JSON.stringify(envelope));
}

await main();
