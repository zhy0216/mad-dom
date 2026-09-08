// Child-process FFI call tracer (todo 03). Runs the same facade operations the
// workload digest exercises and prints which FFI adapter methods were actually
// invoked, proving the hot path really crosses into bun:ffi when the image is
// available (path-hit evidence) instead of only mounting unused methods.
import { Window } from "../../../index.js";
import { nodeDocumentStateOf } from "../../../js/facade/extensions/classes.js";

const win = new Window();
try {
  const { document } = win;
  document.body.innerHTML = '<ul id="list"><li>one</li><li>two</li></ul>';
  const list = document.querySelector("#list");
  const state = nodeDocumentStateOf(list);
  const adapter = state?.ffi;
  if (adapter === null || adapter === undefined) {
    console.log("TRACE " + JSON.stringify({ bunVersion: Bun.version, bound: false, calls: [] }));
    process.exit(0);
  }
  const calls = [];
  const names = ["querySnapshot", "preorderSnapshot", "childSnapshot", "serialize", "createElements", "readBatch"];
  const original = {};
  for (const name of names) {
    if (typeof adapter[name] !== "function") continue;
    original[name] = adapter[name];
    adapter[name] = function traced(...args) {
      calls.push(name);
      return original[name](...args);
    };
  }
  list.querySelectorAll("li");
  list.childNodes.length;
  list.childNodes.item(0);
  void list.innerHTML;
  void list.outerHTML;
  for (let i = 0; i < 12; i++) document.createElement("span");
  list.firstChild;
  const callSet = [...new Set(calls)];
  // Restore before destroy so lifecycle reads follow the real path.
  for (const name of Object.keys(original)) adapter[name] = original[name];
  console.log("TRACE " + JSON.stringify({ bunVersion: Bun.version, bound: true, calls: callSet }));
} finally {
  win.destroy();
}
