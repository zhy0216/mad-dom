// Negative fixture: unknown members and wrong assignment types.
// Every marked line below MUST be rejected by BOTH dom-under-test targets
// once their module-level imports resolve; on the happy-dom target tsc's
// "unused expect-error directive" check (TS2578) proves the rejections run.
import { Window } from "dom-under-test";

const window = new Window();
const document = window.document;
const element = document.createElement("div");

// @ts-expect-error - "doesNotExist" is not on the public Element surface
element.doesNotExist = true;

// @ts-expect-error - "title" is a string; a number must be rejected
document.title = 42;

// @ts-expect-error - "fakeMethod" is not on the public Element surface
element.fakeMethod();

// @ts-expect-error - "tagName" is a string and must not widen into number
const tagNameAsNumber: number = element.tagName;

export const exported = { window, document, element, tagNameAsNumber };
