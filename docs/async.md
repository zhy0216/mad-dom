# Async work, scripts, and cleanup

Await the operation that produces the state you want to assert. MAD DOM uses
Bun's scheduling primitives and exposes happy-dom-style waiting APIs, with
some lifecycle gaps in the current alpha.

## Window timers

```js
import { Window } from "mad-dom";

const window = new Window();
let timer;
try {
  window.document.body.textContent = "Loading";
  timer = window.setTimeout(() => {
    window.document.body.textContent = "Ready";
  }, 0);

  await window.happyDOM.waitUntilComplete();
  console.log(window.document.body.textContent); // Ready
} finally {
  window.clearTimeout(timer);
  await window.happyDOM.close();
  window.destroy();
}
```

Window timeouts, intervals, and animation callbacks register pending work.
Clear intervals with `window.clearInterval(id)` when their job is complete;
an active interval can keep the wait pending indefinitely. Use the Window's
timer methods when you need this tracking. A host `setTimeout()` or an arbitrary
Promise is not automatically owned by the Window.

## MutationObserver

Observe a specific DOM change and resolve a promise when it arrives:

```js
import { Window } from "mad-dom";

const window = new Window();
let observer;
try {
  const document = window.document;
  const changed = new Promise((resolve) => {
    observer = new window.MutationObserver((records) => {
      resolve(records.map((record) => record.type));
    });
    observer.observe(document.body, { childList: true });
  });

  document.body.appendChild(document.createElement("p"));
  console.log(await changed); // [ "childList" ]
} finally {
  observer?.disconnect();
  window.destroy();
}
```

Mutation delivery is asynchronous. `observe()` supports child-list,
attribute, and character-data observations, with `subtree` for descendants.
Use `takeRecords()` to retrieve queued records and `disconnect()` when the
observer is no longer needed. In tests, give the test runner a finite timeout
so a missing expected mutation fails clearly.

## Fetch and cancellation

`window.fetch()` supports relative URLs resolved against `window.location`.
Await both the response and body consumption explicitly. This example uses a
local server and the Window's request/response API:

```js
import { Window } from "mad-dom";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => Response.json({ name: "Ada" }),
});
const window = new Window({ url: server.url.href });
const controller = new window.AbortController();
try {
  const response = await window.fetch("/profile", { signal: controller.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const profile = await response.json();
  window.document.body.textContent = profile.name;
  console.log(window.document.body.textContent); // Ada
} finally {
  controller.abort();
  window.destroy();
  await server.stop(true);
}
```

Use the request's AbortController to cancel one request, or `happyDOM.abort()`
to cancel the Window's pending work. Fetch transports and response bodies are
included in `happyDOM.waitUntilComplete()`. Await the fetch/body promise itself
to observe request errors; the completion wait is an idle barrier.

## Script execution

The entry point determines whether scripts run:

| Entry point | Current behavior |
| --- | --- |
| `element.innerHTML = html` | Parses markup; do not rely on script execution |
| `document.write(html)` | Evaluates parsed scripts when `enableJavaScriptEvaluation` is true |
| `page.content = html` / `page.goto(url)` | Same opt-in classic script execution as `document.write()` |
| `window.eval(code)` / `page.evaluate(code)` | Explicitly evaluates code in the Window context |
| `GlobalWindow.eval(code)` | Explicitly evaluates in the host context |

```js
import { Window } from "mad-dom";

const window = new Window({
  settings: { enableJavaScriptEvaluation: true },
});
try {
  window.document.write(`
    <p id="status">Loading</p>
    <script>
      setTimeout(() => {
        document.querySelector("#status").textContent = "Ready";
      }, 0);
    </script>
  `);
  await window.happyDOM.waitUntilComplete();
  console.log(window.document.querySelector("#status").textContent); // Ready
} finally {
  await window.happyDOM.close();
  window.destroy();
}
```

`disableJavaScriptFileLoading: true` skips external `src` scripts on all three
content paths. Parser-blocking classic scripts load synchronously; `async` and
`defer` scripts load asynchronously and their work is tracked. Synchronous
network fixtures need a server in another process, as with happy-dom. A completed wait does not prove that a script fetched or executed
successfully; assert on its result and inspect errors/logs. Window script
errors can be observed with `window.addEventListener("error", handler)`.

## What completion means

| Waiting method | What it covers |
| --- | --- |
| `window.happyDOM.waitUntilComplete()` | Window timers, animation callbacks, queued microtasks, fetch/body work, script loads and registered child navigation |
| `page.waitUntilComplete()` / `frame.waitUntilComplete()` | The frame Window's work, including navigation |
| `browser.waitUntilComplete()` / `context.waitUntilComplete()` | Concurrent waits over their owned pages |
| An operation's returned promise | That operation's result or rejection |

Concurrent waits observe the same tasks. An idle host-timer checkpoint includes
Promise microtasks that schedule more Window work. Arbitrary host timers and
unrelated application Promises are outside Window ownership. An unbounded
interval keeps the wait pending; configure timer limits or cancel it.

A completed wait does not assert successful I/O or successful script execution.
Await request/body promises and inspect script `error` events or the virtual
console. Rejected interceptor hooks settle their task and preserve the fetch
rejection; this also avoids a task leak present in the pinned baseline.

## Cleanup

Use `await window.happyDOM.abort()` to cancel current Window work while keeping
the Window usable. `cancelAsync()` is its deprecated alias. Use
`await window.happyDOM.close()` or `await browser.close()` for teardown.
These operations cancel timers, animation callbacks, queued Window microtasks,
requests and script loads. Closing disconnects observers created by that Window
without disturbing another Window's observers, and clears its listeners/logs.

A retained closed Window exposes an empty document and rejects new fetches;
new timers and queued microtasks do not run. `window.close()` remains a no-op
on a detached Window. Native documents are reclaimed once Window/node references
are discarded. The mad-dom-specific `window.destroy()` cancels owned work and
immediately invalidates the native arena and its node wrappers.
