// Fixed facade workload shared by the FFI loader scenario probe and the
// hot-path tests (todo 03). The digest is the result-equivalence proof the
// benchmark cannot give: every value must be identical whether the facade
// resolved each operation through the Bun FFI channel or through Node-API,
// including the post-destroy error taxonomy.
//
// Runs as a child process (`bun fixtures/ffi-facade-workload.mjs`) under a
// forced loader state, printing `WORKLOAD {json}` on stdout; the function is
// also imported in-process by tests/bun/ffi-facade-hot-path.test.js.

import { Window, isNativeAvailable } from "../../../index.js";
import { nodeDocumentStateOf } from "../../../js/facade/extensions/classes.js";

function errorCode(operation) {
  try {
    operation();
    return "no-throw";
  } catch (error) {
    return error?.code ?? error?.name ?? String(error);
  }
}

// The FFI adapter methods mounted for a live document. The facade exposes the
// FFI adapter per document (js/facade/window.js docStateOf), and a method is
// only attached when the exact backing C symbol resolved, so this is the
// path-hit proof: an FFI-enabled run must show the query/preorder/serialize/
// child methods here, while disabled/missing/mismatch/partial runs show the
// subset the loader actually resolved. The digest itself stays byte-identical
// across every state.
function mountedFfiMethods(wrapper) {
  const adapter = nodeDocumentStateOf(wrapper)?.ffi;
  if (adapter === null || adapter === undefined) return [];
  return [
    "querySnapshot",
    "preorderSnapshot",
    "childSnapshot",
    "serialize",
    "createElements",
    "readBatch",
  ].filter((name) => adapter[name] !== undefined);
}

export function facadeWorkloadDigest() {
  if (!isNativeAvailable()) return { status: "no-native", bunVersion: Bun.version };
  const win = new Window();
  try {
    const { document } = win;
    document.body.innerHTML =
      '<ul id="list"><li class="a">one</li><li class="b">two</li><li class="a">three</li></ul>';
    const list = document.querySelector("#list");
    const items = list.querySelectorAll("li");
    const span = document.createElement("span");
    const span2 = document.createElement("span");
    span.textContent = "s";
    const fragment = document.createDocumentFragment();
    fragment.append(span, span2);
    // Wide tree: the single-result querySelector must keep first-match
    // semantics (no full snapshot scan + materialization) and both channels
    // must return the identical first wrapper even with thousands of matches.
    const wideRows = Array.from({ length: 2000 }, (_, i) => `<li class="wide">w${i}</li>`).join("");
    const wideList = document.createElement("ul");
    wideList.id = "wide";
    wideList.innerHTML = wideRows;
    document.body.append(wideList);
    const wideAll = wideList.querySelectorAll(".wide");
    const wideFirst = wideList.querySelector(".wide");
    const digest = {
      status: "ok",
      bunVersion: Bun.version,
      ffiMethods: mountedFfiMethods(list),
      queryCount: items.length,
      queryTexts: Array.from(items, (li) => li.textContent),
      queryClasses: Array.from(items, (li) => li.className),
      scopedFirst: list.querySelector(".b")?.textContent ?? null,
      documentQueryCount: document.querySelectorAll("li").length,
      identity: list === document.querySelector("#list"),
      childCount: list.childNodes.length,
      childNames: Array.from(list.childNodes, (node) => node.nodeName),
      firstChild: list.firstChild?.textContent ?? null,
      lastChildText: list.lastChild?.textContent ?? null,
      nextSiblingText: items[1].nextElementSibling?.textContent ?? null,
      previousSiblingText: items[2].previousElementSibling?.textContent ?? null,
      matches: items[0].matches("li.a"),
      outerHTML: list.outerHTML,
      innerHTML: list.innerHTML,
      bodyHTML: document.body.innerHTML,
      created: [span.outerHTML, span2.outerHTML],
      fragmentCount: fragment.childNodes.length,
      fragmentFirst: fragment.firstChild?.outerHTML ?? null,
      fragmentHTML: fragment.innerHTML,
      wideCount: wideAll.length,
      wideFirstText: wideFirst?.textContent ?? null,
      wideFirstIsFirst: wideFirst === wideAll.item(0),
      wideFirstIsCanonical: wideFirst === wideList.querySelector(".wide"),
      wideNoMatch: wideList.querySelector(".nope") ?? null,
    };
    // Post-destroy lifecycle errors must stay identical across channels.
    win.destroy();
    digest.destroyedQuery = errorCode(() => list.querySelectorAll("li"));
    digest.destroyedHTML = errorCode(() => list.outerHTML);
    digest.destroyedChildren = errorCode(() => list.childNodes.length);
    digest.destroyedCreate = errorCode(() => document.createElement("span"));
    return digest;
  } catch (error) {
    return { status: "threw", bunVersion: Bun.version, code: error?.code ?? null, message: error?.message ?? String(error) };
  }
}

if (import.meta.main) {
  console.log("WORKLOAD " + JSON.stringify(facadeWorkloadDigest()));
}