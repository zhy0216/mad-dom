// Positive fixture: Window construction and document element basics.
// Covers: value export reference, constructor signature, property access,
// method signatures (setAttribute / querySelectorAll / appendChild).
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { Window } from "dom-under-test";

const window = new Window({ width: 1024, height: 768, url: "https://mad-dom.test/" });
const document = window.document;
const element = document.createElement("div");

element.setAttribute("class", "container");
element.id = "main";

const matches = document.querySelectorAll("div.main");
const firstMatch = matches.item(0);
const title: string = document.title;
const body = document.body;

if (body) {
  body.appendChild(element);
}

export const result = { element, firstMatch, title, matches };
