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
import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/template",
  owner: "T40",
  gate: "T40",
  status: "implemented",
});

/**
 * `HTMLTemplateElement` facade base class (T40).
 *
 * Instances are never constructed directly: every node wrapper is a `Node`,
 * and the class exists so `window.HTMLTemplateElement` is a genuine constructor
 * accessor (the single-class model approximates the WHATWG class split the same
 * way `HTMLElement` does in T39).
 */
export class HTMLTemplateElement {}

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

/**
 * Installs the T40 template surface.
 */
export function install(ctx) {
  // `window.HTMLTemplateElement` — the WHATWG constructor accessor.
  ctx.defineAccessor(Window.prototype, "HTMLTemplateElement", function getHTMLTemplateElement() {
    return HTMLTemplateElement;
  }, undefined);

  // `template.content`: the template-contents DocumentFragment, minted by Core
  // on first access (identity is stable through `ctx.wrap`).
  ctx.defineAccessor(Node.prototype, "content", function content() {
    const handle = facadeNodeHandle(ctx, this, "content");
    if (!isTemplate(handle)) return undefined;
    return ctx.wrap(handle.templateContent());
  }, undefined);

  // `template.getInnerHTML` / `template.getHTML`: serialize the content
  // fragment (the generic `innerHTML` getter already routes through Core for a
  // template, so both methods delegate to it).
  ctx.defineMethod(Node.prototype, "getInnerHTML", function getInnerHTML() {
    const handle = facadeNodeHandle(ctx, this, "getInnerHTML");
    if (!isTemplate(handle)) return undefined;
    return handle.innerHTML();
  });

  ctx.defineMethod(Node.prototype, "getHTML", function getHTML() {
    const handle = facadeNodeHandle(ctx, this, "getHTML");
    if (!isTemplate(handle)) return undefined;
    return handle.innerHTML();
  });
}
