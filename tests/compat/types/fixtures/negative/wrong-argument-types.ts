// Negative fixture: wrong argument types passed to public methods.
// Every marked line below MUST be rejected by BOTH dom-under-test targets
// once their module-level imports resolve; on the happy-dom target tsc's
// "unused expect-error directive" check (TS2578) proves the rejections run.
import { Window } from "dom-under-test";

const window = new Window();
const document = window.document;
const element = document.createElement("div");

// @ts-expect-error - createElement tag name must be a string, not a number
document.createElement(123);

// @ts-expect-error - setAttribute value must be a string, not a number
element.setAttribute("class", 123);

// @ts-expect-error - querySelectorAll requires a selector string
document.querySelectorAll(42);

// @ts-expect-error - resizeTo expects number width/height, not strings
window.resizeTo("1024", 768);

export const exported = { window, document, element };
