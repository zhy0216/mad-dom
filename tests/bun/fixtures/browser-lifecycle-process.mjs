import { strict as assert } from "node:assert";
import { Browser, liveDocumentCount } from "../../../index.js";

const initialListeners = process.listenerCount("uncaughtException");
const initialDocuments = liveDocumentCount();
async function exercise() {
  const browser = new Browser({ settings: { errorCapture: "processLevel", enableJavaScriptEvaluation: true } });
  const page = browser.newPage();
  const window = page.mainFrame.window;
  const refs = [new WeakRef(window), new WeakRef(window.document)];
  const observed = Promise.withResolvers();
  window.addEventListener("error", (event) => observed.resolve(event.message));
  page.evaluate('setTimeout(() => { throw new Error("owned failure") }, 0)');
  assert.equal(await observed.promise, "owned failure");
  const scriptError = Promise.withResolvers();
  window.addEventListener("error", (event) => scriptError.resolve(event.message));
  page.content = '<script async src="data:text/javascript,throw%20new%20Error(%22external%20failure%22)"></script>';
  assert.equal(await scriptError.promise, "external failure");
  const logs = page.virtualConsolePrinter.readAsString();
  assert.ok(logs.includes("owned failure"));
  window.setInterval(() => {}, 10000);
  await browser.close();
  assert.equal(process.listenerCount("uncaughtException"), initialListeners);
  assert.deepEqual(page.mainFrame.window, { closed: true });
  assert.equal(page.virtualConsolePrinter.closed, true);
  return refs;
}
const refs = await exercise();
let collected = false;
for (let i = 0; i < 100; i++) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  Bun.gc(true);
  collected = refs.every((ref) => ref.deref() === undefined) && liveDocumentCount() === initialDocuments;
  if (collected) break;
}
assert.ok(collected, "closed browser releases the Window, VM context and native document");
console.log("lifecycle process: pass");
