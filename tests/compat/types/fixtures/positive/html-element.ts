// Positive fixture: the T39 HTMLElement base surface. The reflected attribute
// accessors (id/className/title/dir/lang/hidden/inert/tabIndex/contentEditable/
// isContentEditable), the live dataset DOMStringMap, the click/focus/blur
// interaction and the window.HTMLElement prototype-hierarchy membership.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// The window is minted with `new Window()` like the other positive fixtures.
import { Window } from "dom-under-test";

const window = new Window();
const document = window.document;
const div = document.createElement("div");

div.id = "main";
div.className = "a b";
div.title = "hello";
div.dir = "rtl";
div.lang = "en";
div.hidden = true;
div.inert = false;
div.tabIndex = 3;
div.contentEditable = "true";

const title: string = div.title;
const hidden: boolean = div.hidden;
const tabIndex: number = div.tabIndex;
const editable: boolean = div.isContentEditable;
const data: string = div.dataset.fooBar;

div.dataset.newKey = "v";
div.click();
div.focus();
div.blur();

const isHtmlElement = div instanceof window.HTMLElement;
const htmlCtor: typeof window.HTMLElement = window.HTMLElement;

export const exported = { title, hidden, tabIndex, editable, data, isHtmlElement, htmlCtor };
