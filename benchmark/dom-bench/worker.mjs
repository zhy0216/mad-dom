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
// Round-major loop: each round runs the full pipeline below (2 warmup rounds
// discarded); per-phase raw samples plus the per-round pipeline wall time are
// reported with median/min/p90/MAD summaries.
//   parse        — document.write of a generated ~10k-element page
//   build        — createElement/setAttribute/appendChild loop (20k elements)
//   queryHot     — selector batch rerun on the shared (warmed) document
//   queryCold    — same batch, first run on a freshly parsed document
//   getById      — 100 distinct-id querySelector hits on the shared document
//   getByTag     — 20x getElementsByTagName("li").length (live-collection cost)
//   serialize    — body.innerHTML read
//   traverseWarm — full firstChild/nextSibling walk of the shared document
//   traverseCold — same walk, first traversal of a freshly parsed document
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

// p90 over an ascending-sorted array (ceil rank; small samples take the top).
function p90Sorted(sorted) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
}

// Robust per-phase summary over raw per-round samples. MAD = median(|x-median|).
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = median(sorted);
  const madMs = median(sorted.map((x) => Math.abs(x - medianMs)));
  return { samples: [...samples], medianMs, minMs: sorted[0], p90Ms: p90Sorted(sorted), madMs };
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

// Shared selector batch for queryHot (shared document) and queryCold (fresh
// document). The single-id querySelector and the getElementsByTagName read
// live in their own getById / getByTag phases now.
function runQueryBatch(document) {
  const t0 = performance.now();
  const item3 = document.querySelectorAll(".item-3").length;
  const descendant = document.querySelectorAll("section > ul > li").length;
  const acc = item3 + descendant;
  return { ms: performance.now() - t0, acc, hits: { item3, descendant } };
}

// 100 distinct ids at uniform stride over node-0..node-2475: the single-id
// querySelector moved out of the query batch so id-hit cost is timed alone.
function runGetById(document) {
  const t0 = performance.now();
  let hits = 0;
  for (let k = 0; k < 100; k++) {
    const id = `node-${k * 25}`;
    const node = document.querySelector(`#${id}`);
    if (node && node.id === id) hits++;
  }
  return { ms: performance.now() - t0, acc: hits, hits };
}

// 20x live-collection length read: each `.length` pays the eager scope check
// plus a second native query, kept separate so that cost is visible instead
// of polluting the selector batch.
function runGetByTag(document) {
  const t0 = performance.now();
  let acc = 0;
  let count = 0;
  for (let k = 0; k < 20; k++) {
    count = document.getElementsByTagName("li").length;
    acc += count;
  }
  return { ms: performance.now() - t0, acc, count };
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

// Warm walk: the shared document was already walked once (untimed pass
// outside the window, residing wrappers + navigation memo), so the timed
// pass re-reads memoized wrappers instead of casting — the steady-state
// traversal cost. Same countNodes code path as the cold walk.
function runTraverseWarm(document) {
  countNodes(document.body);
  const t0 = performance.now();
  const count = countNodes(document.body);
  return { ms: performance.now() - t0, acc: count };
}

function runTraverse(document) {
  const t0 = performance.now();
  const count = countNodes(document.body);
  return { ms: performance.now() - t0, acc: count };
}

// Cold document: parsed fresh every round, outside any timing window, and
// never elementCounted — so queryCold casts cold wrappers with selector
// caches unhit, and the traverseCold walk right after still finds most of
// the tree uncast (querying first warms only the matched subset; traversing
// first would warm the queries fully).
function parseColdDocument(Window) {
  const window = new Window();
  window.document.write(HTML);
  return window.document;
}

// --- Main -----------------------------------------------------------------------

async function main() {
  const { Window } = await ENGINE_LOADERS[ARGS.engine]();

  // Round-major loop: each round runs the full pipeline (parse → build →
  // queryHot → getById → getByTag → serialize → traverseWarm, then a fresh
  // cold document for queryCold → traverseCold) so the per-round wall time is
  // a real pipeline total instead of a sum of phase medians. Warmup rounds
  // (count = max of the old per-phase warmups = 2) are fully discarded.
  // Query / serialize run against the round's own freshly parsed shared
  // document, and traverseWarm times the second walk of it (an untimed first
  // pass resides wrappers + navigation memo) — warm semantics: elementCount
  // plus repeat visits pin wrappers and memo. queryCold / traverseCold run on a
  // second document parsed fresh every round and never elementCounted, so
  // the walk casts cold wrappers and misses memo.
  const WARMUP_ROUNDS = 2;
  const samples = {
    parse: [],
    build: [],
    queryHot: [],
    queryCold: [],
    getById: [],
    getByTag: [],
    serialize: [],
    traverseWarm: [],
    traverseCold: [],
  };
  const roundTotals = [];
  const sink = {
    parse: 0,
    build: 0,
    queryHot: 0,
    queryCold: 0,
    getById: 0,
    getByTag: 0,
    serialize: 0,
    traverseWarm: 0,
    traverseCold: 0,
  };
  const checksRounds = [];
  let workloadBuild = null;

  for (let round = 0; round < WARMUP_ROUNDS + ARGS.runs; round++) {
    const measured = round >= WARMUP_ROUNDS;
    const tRound0 = performance.now();

    const { ms: parseMs, document: sharedDocument } = runParse(Window);
    // Element count is read immediately after parsing, before the build/query
    // churn: a late `querySelectorAll("*")` over the whole tree hits mad-dom's
    // wrapper-cache gap under peak GC pressure (tracked separately). Same
    // transient-gap discipline as the build verification in runBuild (read
    // once right after the tree exists, never again later).
    const elementCount = sharedDocument.querySelectorAll("*").length;
    await collectAndDrain();

    const built = runBuild(Window);
    await collectAndDrain();
    const hot = runQueryBatch(sharedDocument);
    await collectAndDrain();
    const byId = runGetById(sharedDocument);
    await collectAndDrain();
    const byTag = runGetByTag(sharedDocument);
    await collectAndDrain();
    const serialized = runSerialize(sharedDocument);
    await collectAndDrain();
    const warm = runTraverseWarm(sharedDocument);
    await collectAndDrain();
    const coldDocument = parseColdDocument(Window);
    const cold = runQueryBatch(coldDocument);
    await collectAndDrain();
    const traversedCold = runTraverse(coldDocument);
    const roundTotal = performance.now() - tRound0;
    await collectAndDrain();

    if (!measured) continue;
    samples.parse.push(parseMs);
    samples.build.push(built.ms);
    samples.queryHot.push(hot.ms);
    samples.queryCold.push(cold.ms);
    samples.getById.push(byId.ms);
    samples.getByTag.push(byTag.ms);
    samples.serialize.push(serialized.ms);
    samples.traverseWarm.push(warm.ms);
    samples.traverseCold.push(traversedCold.ms);
    roundTotals.push(roundTotal);
    sink.parse += 1;
    sink.build += built.acc;
    sink.queryHot += hot.acc;
    sink.queryCold += cold.acc;
    sink.getById += byId.acc;
    sink.getByTag += byTag.acc;
    sink.serialize += serialized.acc;
    sink.traverseWarm += warm.acc;
    sink.traverseCold += traversedCold.acc;
    workloadBuild = built;
    checksRounds.push({
      queryHits: { hot: hot.hits, cold: cold.hits, byId: byId.hits, byTag: byTag.count },
      build: { treeNodes: built.treeNodes, probeIds: built.probeIds },
      serializeHash: serialized.serializeHash,
      traverseCount: warm.acc,
      traverseColdCount: traversedCold.acc,
      elementCount,
    });
  }

  // Deterministic workload: every measured round must see identical checks.
  const firstChecksJson = JSON.stringify(checksRounds[0]);
  const roundsIdentical = checksRounds.every((c) => JSON.stringify(c) === firstChecksJson);

  const report = {
    schema: "mad-dom-dom-bench/2",
    engine: ARGS.engine,
    host: { os: process.platform, arch: process.arch, bun: process.versions.bun },
    workload: {
      sections: SECTIONS,
      itemsPerSection: ITEMS_PER_SECTION,
      htmlBytes: Buffer.byteLength(HTML, "utf8"),
      elementCount: checksRounds[0].elementCount,
      buildNodes: BUILD_NODES,
      builtElements: workloadBuild.builtElements,
      builtTextNodes: workloadBuild.builtTextNodes,
      buildRoots: workloadBuild.buildRoots,
      runs: ARGS.runs,
    },
    phases: {
      parse: summarize(samples.parse),
      build: summarize(samples.build),
      queryHot: summarize(samples.queryHot),
      queryCold: summarize(samples.queryCold),
      getById: summarize(samples.getById),
      getByTag: summarize(samples.getByTag),
      serialize: summarize(samples.serialize),
      traverseWarm: summarize(samples.traverseWarm),
      traverseCold: summarize(samples.traverseCold),
    },
    // Per-round pipeline wall time (parse start → traverse end), not a sum of
    // phase medians.
    total: summarize(roundTotals),
    // Acc sinks, reported so a dead-code-elimination surprise is visible.
    sink,
    // Structured validity checks: exact per-selector hits, real built-tree
    // counts, content hash, and traversal size prove both engines ran the
    // same correct workload (not a length coincidence).
    checks: { ...checksRounds[0], roundsIdentical },
  };
  console.log(JSON.stringify(report, null, 2));
}

await main();
