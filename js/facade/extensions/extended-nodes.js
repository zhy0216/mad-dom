// `CharacterData` / `ProcessingInstruction` / `DocumentType` and clone family
// facade extension (T33).
//
// Installs the T33 surface on `Node.prototype` and `Document.prototype`,
// delegating every read and every write to the native T33 contract
// (crates/mad-dom-bun/src/extensions/character_data_api.rs) and through it to
// the Core CharacterData / split / doctype / clone-family contract. Like the
// rest of the facade, this module keeps **no second DOM state**: reads are
// produced on demand from Core and writes route through Core, so a change
// through `data` / `splitText` / `cloneNode` is immediately visible to the
// navigation, `textContent`, attribute and `innerHTML` reads (T23/T24/T25/T29)
// and vice versa.
//
// # CharacterData surface on the single Node class
//
// MAD DOM wraps every native node in one `Node` facade class, so the
// `CharacterData` / `ProcessingInstruction` / `DocumentType` surface is
// installed on `Node.prototype` and kind-guarded by Core: `data` / `length` /
// `nodeValue` read `undefined` / `null` on ineligible kinds (matching happy-dom,
// where those properties are absent), the mutators throw the frozen
// `ERR_MAD_DOM_HIERARCHY` taxonomy on ineligible kinds (the same pattern as
// the T25E attribute methods), and the kind-specific `target` / `name` /
// `publicId` / `systemId` reads return `undefined` for other kinds.
//
// # WebIDL argument shaping
//
// `data` / `nodeValue` setters and the data mutators coerce their string
// arguments with `String` exactly like a WebIDL `DOMString` (`t.data = 42`
// stores `"42"`); the `offset` / `count` arguments are shaped with `>>> 0`
// (WebIDL `unsigned long`), and `cloneNode` / `importNode` deep flags with
// `Boolean`. This is pure argument shaping — no DOM state is produced here —
// so the native handle still receives plain strings / unsigned integers and
// Core stays the single source of tree truth.
//
// # Errors
//
// The native contract owns the DOM rules (out-of-range `splitText` /
// `insertData` offsets fail with `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS` and an
// ineligible mutator receiver with `ERR_MAD_DOM_HIERARCHY`; character data is
// stored verbatim, including NUL bytes, since T48B); the facade only forwards
// the frozen error.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Node } from "./node.js";
import {
  flushCustomElementReactions,
  markSubtreeCustomAndUpgrade,
} from "./custom-elements.js";

export const seam = Object.freeze({
  id: "facade/extensions/extended-nodes",
  owner: "T33",
  gate: "T33",
  status: "implemented",
});

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. The extended-node methods accept
    // only wrappers for which the facade can recover the owning native handle,
    // so native affinity and ownership checks remain authoritative.
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function facadeDocumentHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isDocumentHandle(handle)) {
    throw new TypeError(`Document.${role} requires a genuine Document facade wrapper`);
  }
  return handle;
}

/**
 * Installs the T33 extended-node surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // Document surface: comment creation, PI creation, the clone family and the
  // doctype read.
  ctx.defineMethod(Document.prototype, "createComment", function createComment(data) {
    return ctx.wrap(facadeDocumentHandle(ctx, this, "createComment").createComment(String(data)));
  });

  ctx.defineMethod(
    Document.prototype,
    "createProcessingInstruction",
    function createProcessingInstruction(target, data) {
      return ctx.wrap(
        facadeDocumentHandle(ctx, this, "createProcessingInstruction").createProcessingInstruction(
          String(target),
          String(data),
        ),
      );
    },
  );

  ctx.defineMethod(Document.prototype, "importNode", function importNode(node, deep) {
    const imported = ctx.wrap(
      facadeDocumentHandle(ctx, this, "importNode").importNode(
        facadeNodeHandle(ctx, node, "importNode"),
        Boolean(deep),
      ),
    );
    // T42: an imported custom element keeps its class (happy-dom parity) —
    // mark the subtree custom and set the wrapper prototypes (no reactions).
    markSubtreeCustomAndUpgrade(ctx, ctx.documentContext.handleOf(imported));
    return imported;
  });

  ctx.defineMethod(Document.prototype, "adoptNode", function adoptNode(node) {
    const targetHandle = facadeDocumentHandle(ctx, this, "adoptNode");
    const nodeHandle = facadeNodeHandle(ctx, node, "adoptNode");
    const adopted = ctx.wrap(targetHandle.adoptNode(nodeHandle));
    // T42: the adopted element is a fresh wrapper in the target document; it
    // keeps its custom class when the target registry defines the name (no
    // reactions, happy-dom adopt parity), and the source document's
    // disconnected reactions (adopt removes the node) are flushed.
    markSubtreeCustomAndUpgrade(ctx, ctx.documentContext.handleOf(adopted));
    flushCustomElementReactions(ctx, nodeHandle);
    return adopted;
  });

  ctx.defineAccessor(
    Document.prototype,
    "doctype",
    function doctype() {
      return ctx.wrap(facadeDocumentHandle(ctx, this, "doctype").doctype());
    },
    undefined,
  );

  // Node surface: CharacterData accessors and mutators.
  ctx.defineAccessor(
    Node.prototype,
    "data",
    function data() {
      return facadeNodeHandle(ctx, this, "data").data() ?? undefined;
    },
    function data(value) {
      facadeNodeHandle(ctx, this, "data").setData(String(value));
    },
  );

  ctx.defineAccessor(
    Node.prototype,
    "nodeValue",
    function nodeValue() {
      return facadeNodeHandle(ctx, this, "nodeValue").nodeValue();
    },
    function nodeValue(value) {
      facadeNodeHandle(ctx, this, "nodeValue").setNodeValue(String(value));
    },
  );

  ctx.defineMethod(Node.prototype, "substringData", function substringData(offset, count) {
    return facadeNodeHandle(ctx, this, "substringData").substringData(offset >>> 0, count >>> 0);
  });

  ctx.defineMethod(Node.prototype, "appendData", function appendData(data) {
    facadeNodeHandle(ctx, this, "appendData").appendData(String(data));
  });

  ctx.defineMethod(Node.prototype, "insertData", function insertData(offset, data) {
    facadeNodeHandle(ctx, this, "insertData").insertData(offset >>> 0, String(data));
  });

  ctx.defineMethod(Node.prototype, "deleteData", function deleteData(offset, count) {
    facadeNodeHandle(ctx, this, "deleteData").deleteData(offset >>> 0, count >>> 0);
  });

  ctx.defineMethod(
    Node.prototype,
    "replaceData",
    function replaceData(offset, count, data) {
      facadeNodeHandle(ctx, this, "replaceData").replaceData(offset >>> 0, count >>> 0, String(data));
    },
  );

  ctx.defineMethod(Node.prototype, "splitText", function splitText(offset) {
    return ctx.wrap(facadeNodeHandle(ctx, this, "splitText").splitText(offset >>> 0));
  });

  ctx.defineMethod(Node.prototype, "cloneNode", function cloneNode(deep) {
    const clone = ctx.wrap(facadeNodeHandle(ctx, this, "cloneNode").cloneNode(Boolean(deep)));
    // T42: a clone of a custom element keeps its class (happy-dom parity) —
    // mark the clone subtree custom and set the wrapper prototypes (no
    // reactions; attributes are copied silently).
    markSubtreeCustomAndUpgrade(ctx, ctx.documentContext.handleOf(clone));
    return clone;
  });

  // Kind-specific read-only accessors (undefined for ineligible kinds).
  ctx.defineAccessor(
    Node.prototype,
    "target",
    function target() {
      return facadeNodeHandle(ctx, this, "target").target() ?? undefined;
    },
    undefined,
  );

  // `name` and `length` are defined configurable so the T40 forms extension can
  // redefine them: the single-class model shares `Node.prototype.name` /
  // `Node.prototype.length` between the T33 DocumentType/CharacterData reads and
  // the T40 form `name` reflection and `select.length` / `form.length`. T40's
  // redefinitions keep the T33 reads through the same native `handle.name()` /
  // `handle.dataLength()` calls.
  ctx.defineAccessor(
    Node.prototype,
    "name",
    function name() {
      return facadeNodeHandle(ctx, this, "name").name() ?? undefined;
    },
    undefined,
    { configurable: true },
  );

  ctx.defineAccessor(
    Node.prototype,
    "length",
    function length() {
      return facadeNodeHandle(ctx, this, "length").dataLength() ?? undefined;
    },
    undefined,
    { configurable: true },
  );

  ctx.defineAccessor(
    Node.prototype,
    "publicId",
    function publicId() {
      return facadeNodeHandle(ctx, this, "publicId").publicId() ?? undefined;
    },
    undefined,
  );

  ctx.defineAccessor(
    Node.prototype,
    "systemId",
    function systemId() {
      return facadeNodeHandle(ctx, this, "systemId").systemId() ?? undefined;
    },
    undefined,
  );
}
