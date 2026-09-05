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

Use the request's AbortController to cancel it. `happyDOM.abort()` is currently
an empty compatibility method and does not replace request cancellation.
Direct fetches are not registered with `happyDOM.waitUntilComplete()`.

## Script execution

The entry point determines whether scripts run:

| Entry point | Current behavior |
| --- | --- |
| `element.innerHTML = html` | Parses markup; do not rely on script execution |
| `document.write(html)` | Evaluates parsed scripts when `enableJavaScriptEvaluation` is true |
| `page.content = html` / `page.goto(url)` | Parses HTML without page-script execution |
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

For the document-write path, `disableJavaScriptFileLoading: true` skips
external `src` scripts. Their load promises are tracked when loading is
enabled. A completed wait does not prove that a script fetched or executed
successfully; assert on its result and inspect errors/logs. Window script
errors can be observed with `window.addEventListener("error", handler)`.

## What completion means today

| Waiting method | What it currently covers |
| --- | --- |
| `window.happyDOM.waitUntilComplete()` | The Window's registered promises, including its timers, document-write script loads, and registered child navigation |
| `page.waitUntilComplete()` / `frame.waitUntilComplete()` | Pending frame navigation |
| `browser.waitUntilComplete()` / `context.waitUntilComplete()` | Navigation waits of their pages |
| An operation's returned promise | That specific operation; await response bodies and application follow-up work separately |

These methods do not yet provide complete happy-dom task-manager parity.
Waiting after scheduling host work can resolve too early. Prefer explicit
application completion promises for fetch-driven updates and observer promises
for mutation assertions.

## Cleanup

Current alpha behavior requires explicit ownership of test resources:

1. Clear timers and intervals you created, and cancel animation callbacks.
2. Finish or abort your requests, and await their settlement.
3. Disconnect your MutationObservers and remove listeners from shared objects.
4. Close owned Browser objects or call the detached `happyDOM.close()` API.
5. Call the mad-dom-specific `window.destroy()` when you need deterministic
   native release, then discard all references to that document and its nodes.

`window.close()` is a no-op on a detached Window. `happyDOM.close()` currently
disconnects **all facade observers across windows**, not just its own, and
does not fully cancel timers or release the native tree. Avoid calling it
while another Window still needs observer delivery. Browser close updates
page/context bookkeeping but is also not a full task shutdown. `destroy()`
invalidates the native document; it is not a substitute for canceling async
work before that invalidation.

These are bugs and missing behavior scheduled in the
[lifecycle repair plan](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md).
They are not intended long-term API semantics.
