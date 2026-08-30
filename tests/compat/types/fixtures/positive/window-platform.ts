// Positive fixture: the T45 window platform surface.
// Covers: window.location / history / navigator, localStorage / sessionStorage,
// document.cookie / URL / documentURI, and the window.URL / window.DOMException
// constructors. Must typecheck with ZERO diagnostics against BOTH dom-under-test
// targets.
import { Window } from "dom-under-test";

const window = new Window({ width: 1024, height: 768, url: "https://mad-dom.test/" });
const location = window.location;
const history = window.history;
const navigator = window.navigator;

const href: string = location.href;
location.hash = "#section";
location.assign("https://next.test/x");
location.replace("https://next.test/y");
location.reload();
const locationString: string = location.toString();

const length: number = history.length;
const state: object | null = history.state;
history.pushState({ page: 1 }, "", "/one");
history.replaceState(null, "", "/two");
history.back();
history.forward();
history.go(0);

const userAgent: string = navigator.userAgent;
const language: string = navigator.language;
const languages: string[] = navigator.languages;
const online: boolean = navigator.onLine;
const cookieEnabled: boolean = navigator.cookieEnabled;

const storage = window.localStorage;
storage.setItem("key", "value");
const stored: string | null = storage.getItem("key");
const keyAt: string | null = storage.key(0);
const storageLength: number = storage.length;
storage.removeItem("key");
storage.clear();
window.sessionStorage.setItem("session", "value");

const cookieValue: string = window.document.cookie;
window.document.cookie = "name=value; Path=/";
const documentURL: string = window.document.URL;
const documentURI: string = window.document.documentURI;

const parsed: string = new window.URL("https://x.test/y").href;
const exception = new window.DOMException("boom", "SecurityError");
const exceptionName: string = exception.name;

export const result = {
  href,
  locationString,
  length,
  state,
  userAgent,
  language,
  languages,
  online,
  cookieEnabled,
  stored,
  keyAt,
  storageLength,
  cookieValue,
  documentURL,
  documentURI,
  parsed,
  exceptionName,
};
