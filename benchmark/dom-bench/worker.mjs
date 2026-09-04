#!/usr/bin/env bun
// DOM-intensive engine comparison worker: one engine per process.
//
// Runs a fixed, deterministic DOM workload through the public API shape that
// mad-dom and happy-dom share (`new Window()`, `document.write`,
// `createElement`, `appendChild`, `setAttribute`, `querySelector*`,
// `getElementsByTagName`, `innerHTML`, firstChild/nextSibling walk) and prints
// per-phase median timings as JSON. benchmark/dom-bench/run.mjs spawns one
// worker per engine and prints the comparison.
//
// Phases (each measured separately, warmup runs excluded, median reported):
//   parse      — document.write of a generated ~10k-element page
//   build      — createElement/setAttribute/appendChild loop (20k elements)
//   query      — querySelectorAll / querySelector / getElementsByTagName batch
//   serialize  — body.innerHTML read
//   traverse   — full firstChild/nextSibling walk of the parsed tree
//
// Between measured runs (and between phases) the worker forces a full GC and
// drains the event loop, outside the measured window and identical for both
// engines. This is required because Bun defers Node-API finalizers to the next
// event-loop tick: without the drain, mad-dom's weak wrapper cache accumulates
// stale "collected but not yet finalized" entries during synchronous churn and
// later node reads return undefined or fail array conversion (known gap, see
// crates/mad-dom-bun/src/handle.rs "transient gap"; a large childNodes
// snapshot read on a multi-thousand-child node crashes outright, so the build
// phase accumulates into a JS counter instead).
//
// Usage:
//   bun worker.mjs --engine mad-dom [--runs 5] [--json]

const ENGINE_LOADERS = {
  "mad-dom": () => import("../../index.js"),
  "happy-dom": () => import("happy-dom"),
};

const USAGE = "usage: bun benchmark/dom-bench/worker.mjs --engine <mad-dom|happy-dom> [--runs <n>] [--json]";

const ARGS = parseArgs(process.argv.slice(2));

// --- Workload sizes ----------------------------------------------------------

const SECTIONS = 100;
const ITEMS_PER_SECTION = 25; // ~10.3k elements total
const BUILD_NODES = 20_000;

// --- Deterministic HTML generation (identical input for both engines) --------

function generateHtml() {
  const parts = ['<!DOCTYPE html><html><head><title>dom-bench</title></head><body>'];
  let nodeId = 0;
  for (let s = 0; s < SECTIONS; s++) {
    parts.push(`<section class="section section-${s % 5}" id="section-${s}"><h2>Section ${s}</h2><ul>`);
    for (let i = 0; i < ITEMS_PER_SECTION; i++) {
      parts.push(
        `<li id="node-${nodeId}" class="item-${nodeId % 7}"><div class="item-body"><h3>Title ${nodeId}</h3>` +
          `<p>Paragraph text ${nodeId} lorem ipsum ${nodeId % 13}</p></div></li>`,
      );
      nodeId++;
    }
    parts.push("</ul></section>");
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

const HTML = generateHtml();

// --- Helpers ------------------------------------------------------------------

function parseRuns(raw) {
  const runs = Number(raw);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(USAGE);
    process.exit(2);
  }
  return runs;
}

function parseArgs(argv) {
  const args = { engine: null, runs: 5, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--engine") args.engine = argv[++i];
    else if (argv[i] === "--runs") args.runs = parseRuns(argv[++i]);
    else if (argv[i] === "--json") args.json = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!ENGINE_LOADERS[args.engine]) {
    throw new Error(`--engine must be one of: ${Object.keys(ENGINE_LOADERS).join(", ")}`);
  }
  return args;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Forced collection + two event-loop drains. Gives every run identical,
// clean starting state (both engines pay it outside the measured window) and
// is required for mad-dom: without it the deferred-finalizer wrapper-cache
// gap (see header) corrupts later phases under churn.
async function collectAndDrain() {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") Bun.gc(true);
  await drainEventLoop();
  await drainEventLoop();
}

// Runs `fn` (returning { ms, acc? }) `warmups` discarded times, then `runs`
// measured times; collects + drains after every run (see header). The acc
// sink keeps engines from discarding the work.
async function benchPhase(warmups, runs, fn) {
  let acc = 0;
  for (let i = 0; i < warmups; i++) {
    acc += fn().acc ?? 0;
    await collectAndDrain();
  }
  const samples = [];
  let last = null;
  for (let i = 0; i < runs; i++) {
    last = fn();
    samples.push(last.ms);
    acc += last.acc ?? 0;
    await collectAndDrain();
  }
  return { medianMs: median(samples), acc, last };
}

// --- Phases --------------------------------------------------------------------

function runParse(Window) {
  const window = new Window();
  const t0 = performance.now();
  window.document.write(HTML);
  const ms = performance.now() - t0;
  return { ms, document: window.document };
}

function runBuild(Window) {
  const window = new Window();
  const document = window.document;
  const t0 = performance.now();
  let builtElements = 0;
  let builtTextNodes = 0;
  const root = document.createElement("div");
  builtElements++;
  document.body.appendChild(root);
  let parent = root;
  for (let i = 0; i < BUILD_NODES; i++) {
    const el = document.createElement(i % 3 === 0 ? "section" : i % 2 === 0 ? "div" : "span");
    builtElements++;
    el.setAttribute("id", `node-${i}`);
    el.setAttribute("class", `item-${i % 7}`);
    parent.appendChild(el);
    if (i % 5 === 0) {
      el.appendChild(document.createTextNode(`text-${i}`));
      builtTextNodes++;
    }
    parent = i % 10 === 0 ? root : el;
  }
  // buildRoots: how many top-level nodes were mounted into body (here just root).
  const buildRoots = 1;
  // JS counter, not root.childNodes.length: the childNodes snapshot read on a
  // multi-thousand-child node crashes mad-dom in the wrapper-cache "collected
  // but not yet finalized" window (handle.rs transient gap); tracked separately.
  const ms = performance.now() - t0;
  // Real-tree verification, outside the measured window and read exactly once
  // right after the build (same transient-gap discipline as above): subtree
  // node count plus spot-probes of known ids.
  const treeNodes = countNodes(root) - 1;
  const probeIds = ["node-0", "node-9999", "node-19999"].map((id) => (root.querySelector("#" + id) ? 1 : 0)).join("");
  const probeIdSum = [...probeIds].reduce((sum, c) => sum + Number(c), 0);
  return { ms, acc: treeNodes + probeIdSum, treeNodes, probeIds, builtElements, builtTextNodes, buildRoots };
}

function runQuery(document) {
  const t0 = performance.now();
  const item3 = document.querySelectorAll(".item-3").length;
  const descendant = document.querySelectorAll("section > ul > li").length;
  const hit = document.querySelector("#node-1234");
  const idHit = hit && hit.id === "node-1234" ? 1 : 0;
  const byTag = document.getElementsByTagName("li").length;
  const acc = item3 + descendant + idHit + byTag;
  return { ms: performance.now() - t0, acc, hits: { item3, descendant, idHit, byTag } };
}

function runSerialize(document) {
  const t0 = performance.now();
  const html = document.body.innerHTML;
  const ms = performance.now() - t0;
  // Full-content fingerprint outside the measured window (timing stays a pure
  // length read so both engines pay the same measured cost).
  let serializeHash = 0;
  for (let i = 0; i < html.length; i++) serializeHash = (serializeHash * 31 + html.charCodeAt(i)) | 0;
  return { ms, acc: html.length, serializeHash };
}

function countNodes(node) {
  let count = 1;
  for (let child = node.firstChild; child; child = child.nextSibling) count += countNodes(child);
  return count;
}

function runTraverse(document) {
  const t0 = performance.now();
  const count = countNodes(document.body);
  return { ms: performance.now() - t0, acc: count };
}

// --- Main -----------------------------------------------------------------------

async function main() {
  const { Window } = await ENGINE_LOADERS[ARGS.engine]();

  // Parse phase: fresh window per run; the last parsed document feeds the
  // query / serialize / traverse phases.
  let sharedDocument = null;
  const parse = await benchPhase(2, ARGS.runs, () => {
    const { ms, document } = runParse(Window);
    sharedDocument = document;
    return { ms, acc: 1 };
  });

  // Element count is read immediately after parsing, before the build/query
  // churn: a late `querySelectorAll("*")` over the whole tree hits mad-dom's
  // wrapper-cache gap under peak GC pressure (tracked separately).
  await collectAndDrain();
  const elementCount = sharedDocument.querySelectorAll("*").length;

  await collectAndDrain();
  const build = await benchPhase(1, ARGS.runs, () => runBuild(Window));
  await collectAndDrain();
  const query = await benchPhase(2, ARGS.runs, () => runQuery(sharedDocument));
  await collectAndDrain();
  const serialize = await benchPhase(1, ARGS.runs, () => runSerialize(sharedDocument));
  await collectAndDrain();
  const traverse = await benchPhase(1, ARGS.runs, () => runTraverse(sharedDocument));

  const report = {
    schema: "mad-dom-dom-bench/1",
    engine: ARGS.engine,
    host: { os: process.platform, arch: process.arch, bun: process.versions.bun },
    workload: {
      sections: SECTIONS,
      itemsPerSection: ITEMS_PER_SECTION,
      htmlBytes: Buffer.byteLength(HTML, "utf8"),
      elementCount,
      buildNodes: BUILD_NODES,
      builtElements: build.last.builtElements,
      builtTextNodes: build.last.builtTextNodes,
      buildRoots: build.last.buildRoots,
      runs: ARGS.runs,
    },
    phases: {
      parse: parse.medianMs,
      build: build.medianMs,
      query: query.medianMs,
      serialize: serialize.medianMs,
      traverse: traverse.medianMs,
    },
    // Acc sinks, reported so a dead-code-elimination surprise is visible.
    sink: { parse: parse.acc, build: build.acc, query: query.acc, serialize: serialize.acc, traverse: traverse.acc },
    // Structured validity checks: exact per-selector hits, real built-tree
    // counts, content hash, and traversal size prove both engines ran the
    // same correct workload (not a length coincidence).
    checks: {
      queryHits: query.last.hits,
      build: { treeNodes: build.last.treeNodes, probeIds: build.last.probeIds },
      serializeHash: serialize.last.serializeHash,
      traverseCount: traverse.last.acc,
      elementCount,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

await main();
