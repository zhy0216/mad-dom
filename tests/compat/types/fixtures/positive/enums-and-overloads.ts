// Positive fixture: enum members, generics and overload resolution shapes.
// Covers: enum constants (CSSRule, EventPhaseEnum), createElement tag-name
// overloads (HTMLDivElement narrowing), generic NodeList iteration.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { CSSRule, EventPhaseEnum, Window } from "dom-under-test";

const window = new Window();
const document = window.document;

const styleRule: number = CSSRule.STYLE_RULE;
const phase: number = EventPhaseEnum.capturing;

const div = document.createElement("div");
const divTagName: string = div.tagName;

const fallback = document.createElement("unknown-tag");
const genericElement = fallback;

let count = 0;
for (const node of document.querySelectorAll("div, p")) {
  count += 1;
}

export const exported = { styleRule, phase, divTagName, genericElement, count };
