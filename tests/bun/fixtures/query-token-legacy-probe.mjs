import { deepStrictEqual, equal, notEqual } from "node:assert/strict";
import { Window } from "../../../index.js";
import { loadNative } from "../../../js/native-loader.js";

const native = loadNative();
const scenario = process.argv[2];
const prototype = scenario === "without-query-tokens" ? native.NodeHandle.prototype : native.DocumentHandle.prototype;
const method = scenario === "without-query-tokens" ? "querySelectorAllTokens" : "materializeNodeToken";
const original = Object.getOwnPropertyDescriptor(prototype, method);
const inherited = Object.getOwnPropertyDescriptor(Object.prototype, method);
let inheritedCalls = 0;
let window;
try {
  delete prototype[method];
  Object.defineProperty(Object.prototype, method, {
    configurable: true,
    value() {
      inheritedCalls++;
      throw new Error("Inherited optional native method must not be called");
    },
  });
  window = new Window();
  const { document } = window;
  document.body.innerHTML = "<span>One</span><span>Two</span>";
  const first = document.querySelector("span");
  const result = document.body.querySelectorAll("span");
  equal(result[0], first);
  deepStrictEqual(Array.from(result, element => element.textContent), ["One", "Two"]);
  result[1].remove();
  equal(result.length, 2);
  equal(document.body.querySelectorAll("span").length, 1);
  notEqual(document.body.querySelectorAll("span"), result);
  equal(inheritedCalls, 0);
  console.log("PASS");
} finally {
  window?.destroy();
  if (original) Object.defineProperty(prototype, method, original);
  else delete prototype[method];
  if (inherited) Object.defineProperty(Object.prototype, method, inherited);
  else delete Object.prototype[method];
}
