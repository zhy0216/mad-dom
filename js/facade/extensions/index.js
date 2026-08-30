// Facade registry / extension contract (T22B).
//
// Per js/facade/CONTRACT.md every capability extension is an ESM module that
// exports one named `install(ctx)` function; this registry drives them. It is
// called exactly once at facade initialization by js/facade/window.js with the
// `ctx` that window.js builds:
//
//   - `ctx.wrap(nativeHandle)` — the unique native handle → facade wrapper
//     conversion entry;
//   - `ctx.defineMethod(target, name, fn, descriptor)` /
//     `ctx.defineAccessor(target, name, get, set, descriptor)` — the only
//     sanctioned property-definition helpers for installers;
//   - `ctx.documentContext` — frozen, read-only access to the document
//     ownership reference a wrapper carries;
//   - `ctx.registerHandleType(name, makeWrapper)` — wrapper-type registry.
//
// The registry imports every extension file and calls its `install` when the
// module exports one. Placeholder modules (T20A) export only frozen `seam`
// metadata and are skipped, so the registry runs cleanly before any capability
// lands; a later subtask picks itself up by adding `install` to its own file —
// nothing in this registry needs to change (T22B acceptance: later facade
// subtasks only add or modify their own extension file).
//
// The `seam` metadata below is flipped to `"implemented"` by the T22 gate;
// tests/bun/seam.test.js pins that shape.

import * as attributeNodesExtension from "./attribute-nodes.js";
import * as attributesExtension from "./attributes.js";
import * as childNodeListExtension from "./child-nodelist.js";
import * as eventsExtension from "./events.js";
import * as extendedNodesExtension from "./extended-nodes.js";
import * as fetchExtension from "./fetch.js";
import * as formsExtension from "./forms.js";
import * as htmlElementExtension from "./html-element.js";
import * as htmlExtension from "./html.js";
import * as liveCollectionsExtension from "./live-collections.js";
import * as mutationExtension from "./mutation.js";
import * as mutationObserverExtension from "./mutation-observer.js";
import * as nodeExtension from "./node.js";
import * as queryExtension from "./query.js";
import * as rangeSelectionExtension from "./range-selection.js";
import * as templateExtension from "./template.js";
import * as textContentExtension from "./text-content.js";
import * as treeTraversalExtension from "./tree-traversal.js";
import * as windowPlatformExtension from "./window-platform.js";

export const seam = Object.freeze({
  id: "facade/extensions/index",
  owner: "T22B",
  gate: "T22",
  status: "implemented",
});

const EXTENSIONS = [
  nodeExtension,
  mutationExtension,
  attributesExtension,
  textContentExtension,
  childNodeListExtension,
  htmlExtension,
  queryExtension,
  liveCollectionsExtension,
  extendedNodesExtension,
  fetchExtension,
  eventsExtension,
  attributeNodesExtension,
  htmlElementExtension,
  treeTraversalExtension,
  windowPlatformExtension,
  mutationObserverExtension,
  templateExtension,
  formsExtension,
  rangeSelectionExtension,
];

/**
 * Installs every capability extension onto the facade surface.
 *
 * Each extension module is inspected for a named `install(ctx)` export and
 * invoked exactly once when present. Modules that still only carry `seam`
 * metadata (placeholders) are skipped; owning subtasks add `install` to their
 * own file and are picked up here automatically.
 */
export function installExtensions(ctx) {
  for (const extension of EXTENSIONS) {
    if (typeof extension.install === "function") {
      extension.install(ctx);
    }
  }
}
