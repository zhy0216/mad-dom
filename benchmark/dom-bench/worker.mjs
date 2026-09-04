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
//   buildMixed   — createElement/setAttribute/appendChild loop (20k elements)
//   queryHot     — selector batch rerun on the shared (warmed) document
//   queryCold    — same batch, first run on a freshly parsed document
//   getById      — 100 distinct-id querySelector hits on the shared document
//   getByTag     — 20x getElementsByTagName("li").length (live-collection cost)
//   serialize    — body.innerHTML read
//   traverseWarm — full firstChild/nextSibling walk of the shared document
//   traverseCold — same walk, first traversal of a freshly parsed document
//   buildCreate  — createElement 20k, no attributes, unmounted (create cost)
//   buildAttr    — createElement + id/class setAttribute, unmounted (attr cost)
//   buildAppend  — createElement + appendChild into a shallow root (append cost)
//   buildText    — createTextNode 20k, unmounted
//   buildBulk    — one div.innerHTML parse of a 20k-element fragment (bulk cost)
//   readHeavy    — per-node nodeName/id/className/getAttribute/textContent reads
//                  over 5000 sampled li nodes of the shared document
//   mutationChurn — 2000 sampled nodes x set/remove/remove+append/replace pair
//                  on a dedicated freshly parsed document per round
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

// Bulk fragment: 20k small elements parsed in one innerHTML assignment by the
// buildBulk phase. Decomposition ids use the nb-<phase>-<i> prefix so they can
// never collide with buildMixed's node-<i> ids.
const BULK_HTML = Array.from(
  { length: BUILD_NODES },
  (_, i) => `<span id="nb-bulk-${i}" class="item-${i % 7}">text-${i}</span>`,
).join("");

const READ_NODES = 5000;
const MUTATION_NODES = 2000;

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

function runBuildMixed(Window) {
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

// Pure createElement cost: 20k elements, no attributes, never mounted. The
// array keeps every wrapper alive so the count below proves the work happened.
function runBuildCreate(Window) {
  const window = new Window();
  const document = window.document;
  const t0 = performance.now();
  const created = new Array(BUILD_NODES);
  for (let i = 0; i < BUILD_NODES; i++) {
    created[i] = document.createElement(i % 3 === 0 ? "section" : i % 2 === 0 ? "div" : "span");
  }
  const ms = performance.now() - t0;
  return { ms, acc: created.length, count: created.length, tag0: created[0].tagName, tagLast: created[BUILD_NODES - 1].tagName };
}

// createElement + one id + one class per node, never mounted: attribute FFI.
function runBuildAttr(Window) {
  const window = new Window();
  const document = window.document;
  const t0 = performance.now();
  const created = new Array(BUILD_NODES);
  for (let i = 0; i < BUILD_NODES; i++) {
    const el = document.createElement(i % 3 === 0 ? "section" : i % 2 === 0 ? "div" : "span");
    el.setAttribute("id", `nb-attr-${i}`);
    el.setAttribute("class", `item-${i % 7}`);
    created[i] = el;
  }
  const ms = performance.now() - t0;
  return {
    ms,
    acc: created.length,
    count: created.length,
    firstId: created[0].getAttribute("id"),
    firstClass: created[0].getAttribute("class"),
    lastId: created[BUILD_NODES - 1].getAttribute("id"),
    lastClass: created[BUILD_NODES - 1].getAttribute("class"),
  };
}

// Pure append cost: createElement + appendChild into a shallow root, no
// attributes (id/class live in buildAttr). Verified by walk count + child tags.
function runBuildAppend(Window) {
  const window = new Window();
  const document = window.document;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const t0 = performance.now();
  for (let i = 0; i < BUILD_NODES; i++) {
    root.appendChild(document.createElement(i % 3 === 0 ? "section" : i % 2 === 0 ? "div" : "span"));
  }
  const ms = performance.now() - t0;
  // Same transient-gap discipline as runBuildMixed: walk once right after the
  // build (firstChild/nextSibling walk, never a childNodes snapshot).
  const treeNodes = countNodes(root) - 1;
  const firstTag = root.firstChild ? root.firstChild.tagName : "";
  const lastTag = root.lastChild ? root.lastChild.tagName : "";
  return { ms, acc: treeNodes, treeNodes, firstTag, lastTag };
}

// createTextNode 20k, never mounted.
function runBuildText(Window) {
  const window = new Window();
  const document = window.document;
  const t0 = performance.now();
  const created = new Array(BUILD_NODES);
  for (let i = 0; i < BUILD_NODES; i++) created[i] = document.createTextNode(`text-${i}`);
  const ms = performance.now() - t0;
  const textOf = (node) => String(node.data ?? node.textContent);
  return { ms, acc: created.length, count: created.length, firstData: textOf(created[0]), lastData: textOf(created[BUILD_NODES - 1]) };
}

// One-shot bulk parse: a single innerHTML assignment of the 20k-element
// fragment, then one append of the host. Native-parser path, no per-node FFI.
function runBuildBulk(Window) {
  const window = new Window();
  const document = window.document;
  const host = document.createElement("div");
  const t0 = performance.now();
  host.innerHTML = BULK_HTML;
  document.body.appendChild(host);
  const ms = performance.now() - t0;
  const treeNodes = countNodes(host) - 1;
  const probeIds = ["nb-bulk-0", `nb-bulk-${BUILD_NODES - 1}`].map((id) => (host.querySelector("#" + id) ? 1 : 0)).join("");
  return { ms, acc: treeNodes, treeNodes, probeIds };
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

// Read-heavy sample: the li nodes plus their div.item-body children, sliced to
// READ_NODES (2500 + 2500 = 5000 on the fixed workload page). Two scoped
// selector queries, outside the measured window.
function snapshotReadNodes(document, n) {
  const lis = document.querySelectorAll("li");
  const divs = document.querySelectorAll("div.item-body");
  const sample = new Array(Math.min(n, lis.length + divs.length));
  let k = 0;
  for (let i = 0; i < lis.length && k < sample.length; i++) sample[k++] = lis[i];
  for (let i = 0; i < divs.length && k < sample.length; i++) sample[k++] = divs[i];
  return sample;
}

// Read-heavy FFI: per-node nodeName + id + className + getAttribute + the
// firstChild textContent length. The sampling query above runs outside the
// window; only the reads are timed. Hash covers attributes; text goes in as a
// total length (serialization equality is already proven by serializeHash).
function runReadHeavy(sample) {
  const t0 = performance.now();
  let hash = 0;
  let textLen = 0;
  for (let i = 0; i < sample.length; i++) {
    const el = sample[i];
    const s = `${el.nodeName}|${el.id}|${el.className}|${el.getAttribute("class")}`;
    for (let k = 0; k < s.length; k++) hash = (hash * 31 + s.charCodeAt(k)) | 0;
    const first = el.firstChild;
    textLen += first ? first.textContent.length : 0;
  }
  return { ms: performance.now() - t0, acc: sample.length, count: sample.length, hash, textLen };
}

// Mutation churn on a dedicated freshly parsed document per round (structure
// mutation bumps the navigation-memo epoch, so rounds must not share the
// document — same手法 as traverseCold). Each of MUTATION_NODES nodes gets:
// setAttribute overwrite, removeAttribute, removeChild + appendChild, and a
// replaceChild out-and-back pair (replacements pre-created outside the
// window so the window measures only mutation calls). Snapshot + replacements
// are taken in one go, never incrementally (handle.rs transient-gap discipline).
function runMutationChurn(Window) {
  const document = parseColdDocument(Window);
  const list = document.querySelectorAll("li");
  const n = Math.min(MUTATION_NODES, list.length);
  const sample = new Array(n);
  for (let i = 0; i < n; i++) sample[i] = list[i];
  const replacements = new Array(n);
  for (let i = 0; i < n; i++) {
    replacements[i] = document.createElement("span");
    replacements[i].setAttribute("id", `nb-mut-${i}`);
  }
  const t0 = performance.now();
  let ops = 0;
  for (let i = 0; i < n; i++) {
    const node = sample[i];
    node.setAttribute("data-x", String(i));
    ops++;
    node.removeAttribute("class");
    ops++;
    const parent = node.parentNode;
    parent.removeChild(node);
    ops++;
    parent.appendChild(node);
    ops++;
    parent.replaceChild(replacements[i], node);
    ops++;
    parent.replaceChild(node, replacements[i]);
    ops++;
  }
  const ms = performance.now() - t0;
  // End-state fingerprint outside the window. classNull normalizes the
  // null/undefined/"" spread for "attribute absent" across engines.
  const absent = sample[0].getAttribute("class");
  const classNull = absent == null ? "null" : absent === "" ? "empty" : absent;
  const fp = `${sample[0].getAttribute("data-x")}|${sample[n - 1].getAttribute("data-x")}|${classNull}|${document.querySelectorAll("li").length}`;
  let fpHash = 0;
  for (let i = 0; i < fp.length; i++) fpHash = (fpHash * 31 + fp.charCodeAt(i)) | 0;
  return { ms, acc: ops, ops, fp, fpHash };
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

  // Round-major loop: each round runs the full pipeline (parse → buildMixed →
  // queryHot → getById → getByTag → serialize → traverseWarm, then a fresh
  // cold document for queryCold → traverseCold, then the build decomposition
  // (each phase its own fresh window), readHeavy on the round's shared
  // document, and mutationChurn on its own dedicated fresh document) so the
  // per-round wall time is a real pipeline total instead of a sum of phase
  // medians. Warmup rounds (count = max of the old per-phase warmups = 2) are
  // fully discarded.
  // Query / serialize run against the round's own freshly parsed shared
  // document, and traverseWarm times the second walk of it (an untimed first
  // pass resides wrappers + navigation memo) — warm semantics: elementCount
  // plus repeat visits pin wrappers and memo. queryCold / traverseCold run on a
  // second document parsed fresh every round and never elementCounted, so
  // the walk casts cold wrappers and misses memo.
  const WARMUP_ROUNDS = 2;
  const samples = {
    parse: [],
    buildMixed: [],
    queryHot: [],
    queryCold: [],
    getById: [],
    getByTag: [],
    serialize: [],
    traverseWarm: [],
    traverseCold: [],
    buildCreate: [],
    buildAttr: [],
    buildAppend: [],
    buildText: [],
    buildBulk: [],
    readHeavy: [],
    mutationChurn: [],
  };
  const roundTotals = [];
  const sink = {
    parse: 0,
    buildMixed: 0,
    queryHot: 0,
    queryCold: 0,
    getById: 0,
    getByTag: 0,
    serialize: 0,
    traverseWarm: 0,
    traverseCold: 0,
    buildCreate: 0,
    buildAttr: 0,
    buildAppend: 0,
    buildText: 0,
    buildBulk: 0,
    readHeavy: 0,
    mutationChurn: 0,
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
    // transient-gap discipline as the build verification in runBuildMixed (read
    // once right after the tree exists, never again later).
    const elementCount = sharedDocument.querySelectorAll("*").length;
    await collectAndDrain();

    const built = runBuildMixed(Window);
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
    await collectAndDrain();
    const created = runBuildCreate(Window);
    await collectAndDrain();
    const attributed = runBuildAttr(Window);
    await collectAndDrain();
    const appended = runBuildAppend(Window);
    await collectAndDrain();
    const texted = runBuildText(Window);
    await collectAndDrain();
    const bulked = runBuildBulk(Window);
    await collectAndDrain();
    // readHeavy sampling runs outside the window on the round's shared
    // (warm, resident) document; mutationChurn parses its own dedicated
    // document per round inside its phase (same手法 as traverseCold).
    const readSample = snapshotReadNodes(sharedDocument, READ_NODES);
    const read = runReadHeavy(readSample);
    await collectAndDrain();
    const churned = runMutationChurn(Window);
    const roundTotal = performance.now() - tRound0;
    await collectAndDrain();

    if (!measured) continue;
    samples.parse.push(parseMs);
    samples.buildMixed.push(built.ms);
    samples.queryHot.push(hot.ms);
    samples.queryCold.push(cold.ms);
    samples.getById.push(byId.ms);
    samples.getByTag.push(byTag.ms);
    samples.serialize.push(serialized.ms);
    samples.traverseWarm.push(warm.ms);
    samples.traverseCold.push(traversedCold.ms);
    samples.buildCreate.push(created.ms);
    samples.buildAttr.push(attributed.ms);
    samples.buildAppend.push(appended.ms);
    samples.buildText.push(texted.ms);
    samples.buildBulk.push(bulked.ms);
    samples.readHeavy.push(read.ms);
    samples.mutationChurn.push(churned.ms);
    roundTotals.push(roundTotal);
    sink.parse += 1;
    sink.buildMixed += built.acc;
    sink.queryHot += hot.acc;
    sink.queryCold += cold.acc;
    sink.getById += byId.acc;
    sink.getByTag += byTag.acc;
    sink.serialize += serialized.acc;
    sink.traverseWarm += warm.acc;
    sink.traverseCold += traversedCold.acc;
    sink.buildCreate += created.acc;
    sink.buildAttr += attributed.acc;
    sink.buildAppend += appended.acc;
    sink.buildText += texted.acc;
    sink.buildBulk += bulked.acc;
    sink.readHeavy += read.acc;
    sink.mutationChurn += churned.acc;
    workloadBuild = built;
    checksRounds.push({
      queryHits: { hot: hot.hits, cold: cold.hits, byId: byId.hits, byTag: byTag.count },
      buildMixed: { treeNodes: built.treeNodes, probeIds: built.probeIds },
      buildDecomp: {
        create: { count: created.count, tag0: created.tag0, tagLast: created.tagLast },
        attr: { count: attributed.count, firstId: attributed.firstId, firstClass: attributed.firstClass, lastId: attributed.lastId, lastClass: attributed.lastClass },
        append: { treeNodes: appended.treeNodes, firstTag: appended.firstTag, lastTag: appended.lastTag },
        text: { count: texted.count, firstData: texted.firstData, lastData: texted.lastData },
        bulk: { treeNodes: bulked.treeNodes, probeIds: bulked.probeIds },
      },
      readHeavy: { count: read.count, hash: read.hash, textLen: read.textLen },
      mutation: { ops: churned.ops, fp: churned.fp, fpHash: churned.fpHash },
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
      readNodes: READ_NODES,
      mutationNodes: MUTATION_NODES,
      runs: ARGS.runs,
    },
    phases: {
      parse: summarize(samples.parse),
      buildMixed: summarize(samples.buildMixed),
      queryHot: summarize(samples.queryHot),
      queryCold: summarize(samples.queryCold),
      getById: summarize(samples.getById),
      getByTag: summarize(samples.getByTag),
      serialize: summarize(samples.serialize),
      traverseWarm: summarize(samples.traverseWarm),
      traverseCold: summarize(samples.traverseCold),
      buildCreate: summarize(samples.buildCreate),
      buildAttr: summarize(samples.buildAttr),
      buildAppend: summarize(samples.buildAppend),
      buildText: summarize(samples.buildText),
      buildBulk: summarize(samples.buildBulk),
      readHeavy: summarize(samples.readHeavy),
      mutationChurn: summarize(samples.mutationChurn),
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
