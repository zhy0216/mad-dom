import { createHash } from "node:crypto";

export const SCHEMA = "mad-dom/bun-performance/1";
export const CORE = ["parse", "buildMixed", "queryHot", "queryCold", "getById", "getByTag",
  "serialize", "traverseWarm", "traverseCold", "buildCreate", "buildAttr", "buildAppend",
  "buildText", "buildBulk", "readHeavy", "mutationChurn"];
export const TESTING = ["fixtureLifecycle", "windowLifecycle", "testingLibraryText", "testingLibraryEvents",
  "testingLibraryRole", "testingLibraryLabel", "todoInteractions", "formSubmission", "templateClone",
  "keyedReconcile", "asyncObserver", "shadowComponent", "snapshotRoundTrip"];
export const POOLS = [1, 8, 32, 128, 256];
export const HOTSPOTS = ["query.small.cold", "query.small.hot", "query.large.cold", "query.large.hot",
  "child.cold", "preorder.cold", "child.grow-shrink", "preorder.grow-shrink",
  "innerHTML.ascii", "innerHTML.unicode", "outerHTML.ascii", "outerHTML.unicode",
  "innerHTML.grow-shrink", "outerHTML.grow-shrink", ...POOLS.map(n => `create.${n}`)];
export const SUITES = ["core", "testing", "raw", "adapter", "facade"];
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const fingerprint = value => sha256(JSON.stringify(value));
export const phasesFor = suite => suite === "core" ? CORE : suite === "testing" ? TESTING : HOTSPOTS;

export function fixture(count, ascii = false) {
  return Array.from({ length: count }, (_, i) =>
    `<span data-i="${i}" class="hit"><b>${ascii ? "Hello cafe" : "你好 café 🦀"} ${i}</b><!--edge--></span>`).join("");
}

export function hotWorkload(name, size, iterations) {
  const small = Math.max(1, Math.round(8 * size));
  const large = Math.max(2, Math.round(512 * size));
  const create = name.startsWith("create.");
  const shrink = name.endsWith("grow-shrink");
  const count = create ? Number(name.split(".")[1]) : name.includes("small") || shrink ? small : large;
  const html = create ? "" : fixture(count, name.endsWith("ascii"));
  const outer = `<section>${html}</section>`;
  return { name, size, iterations, count, small, large, htmlSha256: sha256(html),
    inputUtf8Bytes: Buffer.byteLength(html), innerUtf8Bytes: Buffer.byteLength(html), outerUtf8Bytes: Buffer.byteLength(outer),
    nonAscii: !create && !name.endsWith("ascii"), selector: 'span.hit[data-i]',
    cache: name.endsWith("hot") ? "one exact untimed query per fresh fixture; facade result cache hit" :
      create ? "fresh document; drain earlier pool tiers outside timing; time one complete tier" :
      shrink ? "same document: large result consumed, replace with small fixture outside timing" : "fresh document per operation; no descendant wrappers primed",
    consumption: create ? "retain every token/wrapper; validate all unique detached SPAN nodes outside timing" :
      /HTML/.test(name) ? "complete string generation and length; SHA256 and exact content check outside timing; raw FFI decode outside timing" :
      "retain full packed output / consume every public wrapper; ordered semantic digest outside timing",
    setupTimed: false, validationTimed: false, forcedGcTimed: false, normalGcTimed: true };
}

export function operationPath(suite, name, ffi) {
  const channel = ffi === "on" ? "FFI" : "Node-API";
  if (suite === "core" || suite === "testing") return `${channel} enabled surface; mixed public operations; document-root query remains Node-API; see diagnostic path audit`;
  if (name.endsWith("hot") && suite === "facade") return "public scoped query -> new StaticNodeList over cached wrappers -> full iteration (no boundary on hit)";
  if (name.startsWith("create.")) return suite === "facade"
    ? `public createElement -> tier ${name.split(".")[1]} -> ${name === "create.1" ? "Node-API scalar" : ffi === "on" ? "FFI exact token array" : "Node-API scalar range"} -> canonical wrappers`
    : `${suite} ${channel} ${ffi === "on" ? "create_elements exact caller buffer" : "createElementTokenRange scalar + local range consumption"}`;
  const operation = name.startsWith("query") ? "query_snapshot/querySelectorAllTokens" :
    name.startsWith("child") ? "child_tokens/childNodesTokens" : name.startsWith("preorder") ?
      "preorder_snapshot/preorderTokenSnapshot" : "serialize/NodeHandle HTML string";
  return `${suite} ${channel} ${operation}` + (suite === "facade" ? " -> decode/hydrate -> full public consumption" :
    suite === "adapter" ? " -> owned output (includes UTF-8 input and string decode)" : " -> preallocated output on FFI; no FFI string decode");
}
