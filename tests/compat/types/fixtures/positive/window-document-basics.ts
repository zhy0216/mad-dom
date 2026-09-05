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
const defaultView = document.defaultView;
const elementNode: number = window.Node.ELEMENT_NODE;
const documentNode: number = document.DOCUMENT_NODE;
const classAttribute = element.getAttributeNode("class");
const label = document.createElement("label");
if (label instanceof window.HTMLLabelElement) {
  label.htmlFor = "main";
  const control = label.control;
  const form = label.form;
  void [control, form];
}
void [defaultView, elementNode, documentNode, classAttribute];
const input = document.createElement("input");
if (input instanceof window.HTMLInputElement) {
  const labels = input.labels;
  const firstLabel = labels?.item(0);
  void firstLabel;
}

if (body) {
  body.appendChild(element);
}

export const result = { element, firstMatch, title, matches };
