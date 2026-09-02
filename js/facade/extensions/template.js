// `HTMLTemplateElement.content` facade extension (T40).
//
// Implements the template slice of T40: the `template.content` read, the
// `getInnerHTML` / `getHTML` methods and the `window.HTMLTemplateElement`
// constructor accessor. Everything that makes template content behave correctly
// lives in Core — the parser routes `<template>` children into an HTML5
// template-contents `DocumentFragment` (T26/T27), `innerHTML` / `outerHTML`
// read and write that fragment, the serializer emits it inside the `<template>`
// tags, and clone/import/adopt carry it with the element — so this facade file
// is a thin accessor over the single native `templateContent()` entry
// (crates/mad-dom-bun/src/extensions/template_api.rs) plus the existing T29
// surface.
//
// # Single-class model
//
// Like the rest of the facade, every element is a `Node` wrapper, so the
// template surface is installed on `Node.prototype` and guarded by the tag
// name: a `<template>` element exposes `content` / `getInnerHTML` / `getHTML`,
// any other element reads `undefined` (the honest single-class deviation — in
// happy-dom those members simply do not exist on a `div`).
//
// # Recorded gaps (template)
//
// happy-dom redirects `firstChild` / `lastChild` / `appendChild` on a template
// into its content fragment; MAD DOM's single `Node` class shares those
// methods, so appending a child to a template writes the element's ordinary
// child list instead. The `content` fragment and the `innerHTML` / serialized
// surface are fully implemented; the child-navigation redirection is a known
// gap.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { Node } from "./node.js";
import { HTMLTemplateElement } from "./html-element.js";

export const seam = Object.freeze({
  id: "facade/extensions/template",
  owner: "T40",
  gate: "T40",
  status: "implemented",
});

export { HTMLTemplateElement };

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function isTemplate(handle) {
  return String(handle.nodeName()) === "template";
}

// --- HTML serialization (mirrors happy-dom HTMLSerializer) --------------------
//
// `getHTML(options)` serializes an element's children (a template's content
// fragment's children) with the same observable rules as happy-dom's
// `HTMLSerializer`: void (no-descendant) elements emit no closing tag, raw-text
// elements (`script` / `style`) emit their text unescaped, every other text
// node is entity-encoded (`&` / `<` / `>` / no-break space), attribute values
// escape `&` / `"`, and — on request — serializable shadow roots are emitted as
// a leading `<template shadowrootmode="…">` block.

// happy-dom `HTMLElementConfig` content models the serializer branches on.
const NO_DESCENDANTS_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);

function encodeTextContent(text) {
  if (text === null || text === undefined) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function encodeHTMLAttributeValue(value) {
  if (value === null || value === undefined) return "";
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function serializeAttributes(element) {
  let output = "";
  const attributes = element.attributes;
  if (attributes !== null && attributes !== undefined) {
    for (const attribute of attributes) {
      output += ` ${attribute.name}="${encodeHTMLAttributeValue(attribute.value)}"`;
    }
  }
  return output;
}

function serializeToString(node, options, parentLocalName) {
  switch (node.nodeType) {
    case 1: {
      // Element.
      const localName = node.localName;
      if (NO_DESCENDANTS_TAGS.has(localName)) {
        return `<${localName}${serializeAttributes(node)}>`;
      }
      let innerHTML = "";
      const shadowRoot = node.shadowRoot;
      if (
        shadowRoot &&
        (options.allShadowRoots ||
          (options.serializableShadowRoots && shadowRoot.serializable) ||
          options.shadowRoots?.includes(shadowRoot)) &&
        (!options.excludeShadowRootTags || !options.excludeShadowRootTags.includes(localName))
      ) {
        innerHTML += `<template shadowrootmode="${shadowRoot.mode}"${
          shadowRoot.serializable ? ' shadowrootserializable=""' : ""
        }>`;
        for (const childNode of shadowRoot.childNodes) {
          innerHTML += serializeToString(childNode, options, null);
        }
        innerHTML += "</template>";
      }
      const childNodes = localName === "template" ? node.content.childNodes : node.childNodes;
      for (const childNode of childNodes) {
        innerHTML += serializeToString(childNode, options, localName);
      }
      return `<${localName}${serializeAttributes(node)}>${innerHTML}</${localName}>`;
    }
    case 11:
    case 9: {
      // DocumentFragment / Document: serialize the children only.
      let html = "";
      for (const childNode of node.childNodes) {
        html += serializeToString(childNode, options, null);
      }
      return html;
    }
    case 8:
      // Comment.
      return `<!--${node.textContent}-->`;
    case 7:
      // Processing instruction.
      return `<!--?${node.target ?? ""} ${node.textContent}?-->`;
    case 3:
      // Text: raw inside `script` / `style`, entity-encoded anywhere else.
      if (parentLocalName !== null && RAW_TEXT_TAGS.has(parentLocalName)) {
        return node.textContent;
      }
      return encodeTextContent(node.textContent);
    case 10: {
      // DocumentType.
      const identifier = node.publicId ? " PUBLIC" : node.systemId ? " SYSTEM" : "";
      const publicId = node.publicId ? ` "${node.publicId}"` : "";
      const systemId = node.systemId ? ` "${node.systemId}"` : "";
      return `<!DOCTYPE ${node.name}${identifier}${publicId}${systemId}>`;
    }
  }
  return "";
}

/**
 * Installs the T40 template surface.
 */
export function install(ctx) {
  // `template.content`: the template-contents DocumentFragment, minted by Core
  // on first access (identity is stable through `ctx.wrap`).
  ctx.defineAccessor(Node.prototype, "content", function content() {
    const handle = facadeNodeHandle(ctx, this, "content");
    if (!isTemplate(handle)) return undefined;
    return ctx.wrap(handle.templateContent());
  }, undefined);

  // `template.getInnerHTML`: serialize the content fragment (the generic
  // `innerHTML` getter already routes through Core for a template, so the
  // method delegates to it).
  ctx.defineMethod(Node.prototype, "getInnerHTML", function getInnerHTML() {
    const handle = facadeNodeHandle(ctx, this, "getInnerHTML");
    if (!isTemplate(handle)) return undefined;
    return handle.innerHTML();
  });

  // `Element.getHTML(options)` (happy-dom parity): serializes the element's
  // children — a template serializes its content fragment — honoring the
  // `serializableShadowRoots` / `shadowRoots` / `allShadowRoots` /
  // `excludeShadowRootTags` options through the happy-dom HTMLSerializer rules
  // above. Ineligible nodes keep the honest single-class `undefined`.
  ctx.defineMethod(Node.prototype, "getHTML", function getHTML(options) {
    const handle = facadeNodeHandle(ctx, this, "getHTML");
    if (handle.nodeType() !== 1) return undefined;
    const serializerOptions = {
      serializableShadowRoots: Boolean(options?.serializableShadowRoots),
      shadowRoots: options?.shadowRoots ?? null,
      allShadowRoots: Boolean(options?.allShadowRoots),
      excludeShadowRootTags: options?.excludeShadowRootTags ?? null,
    };
    let html = "";
    const childNodes =
      isTemplate(handle) && this.content !== undefined
        ? this.content.childNodes
        : this.childNodes;
    const rootLocalName = typeof this.localName === "string" ? this.localName : null;
    for (const childNode of childNodes) {
      html += serializeToString(childNode, serializerOptions, rootLocalName);
    }
    return html;
  });
}
