# Window and GlobalWindow

`Window` is the main entry point for a document you control directly. Each
instance owns a native document and exposes DOM constructors, location,
history, storage, timers, and a virtual console.

## Constructor

```js
import { Window } from "mad-dom";

const window = new Window({
  url: "https://app.example/settings",
  width: 1280,
  height: 720,
  settings: {
    navigator: { userAgent: "My DOM tests", maxTouchPoints: 0 },
  },
});

try {
  console.log(window.location.pathname); // /settings
  console.log(window.innerWidth); // 1280
  console.log(window.navigator.userAgent); // My DOM tests
} finally {
  window.destroy();
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `url` | `about:blank` | Initial URL state and relative-URL base; does not fetch HTML |
| `width` | `1024` | Viewport width |
| `height` | `768` | Viewport height |
| `innerWidth`, `innerHeight` | — | Deprecated viewport aliases; prefer `width` and `height` |
| `console` | A virtual console | Supply a console object, for example the host `console` |
| `settings` | Merged defaults | Browser-style settings; see [Configuration](/configuration) |

Access `window.document` for the document and `document.defaultView` for its
owning Window. Construct events and custom elements with that Window's
constructors, such as `new window.Event("change")` and `window.HTMLElement`.

## URL and viewport

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://app.example/" });
try {
  window.happyDOM.setURL("https://app.example/docs/");
  window.document.body.innerHTML = '<a href="guide">Read the guide</a>';
  console.log(window.document.querySelector("a").href);
  // https://app.example/docs/guide

  window.happyDOM.setViewport({ width: 1440, height: 900, devicePixelRatio: 2 });
  console.log(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  // 1440 900 2
} finally {
  window.destroy();
}
```

`setURL()` changes URL state without loading content. `setViewport()` updates
dimensions and dispatches `resize` when they change. It does not lay out the
document. Deprecated helpers `setWindowSize()`, `setInnerWidth()`, and
`setInnerHeight()` remain available for compatibility.

## History and storage

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://app.example/" });
try {
  window.history.pushState({ tab: "profile" }, "", "/profile");
  window.localStorage.setItem("theme", "dark");
  window.sessionStorage.setItem("draft", "Hello");

  console.log(window.location.pathname); // /profile
  console.log(window.history.state.tab); // profile
  console.log(window.localStorage.getItem("theme")); // dark
  window.localStorage.clear();
  window.sessionStorage.clear();
} finally {
  window.destroy();
}
```

History and storage are simulated in memory. They do not create a persistent
browser profile. Use [Browser](/browser) when the test needs navigation that
actually loads another document.

## Console output

By default, `window.console` writes to a virtual console buffer. Read that
buffer to assert on application logs:

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  window.console.log("Loaded", { count: 3 });
  const printer = window.happyDOM.virtualConsolePrinter;
  console.log(printer.readAsString().trim()); // Loaded {"count":3}
  console.log(printer.read().length); // 0
} finally {
  window.destroy();
}
```

`read()` returns structured entries with `message` arrays; `readAsString()`
formats them. **Both drain the buffer.** `clear()` discards entries, and the
printer supports `print` and `clear` events. `VirtualConsoleLogLevelEnum` can
be passed to `readAsString()` for level filtering. To send logs directly to
your terminal, construct the Window with `{ console }`.

## Script context

`window.eval(code)` explicitly evaluates a string in the Window's VM context.
Within that code, `document` and `window` refer to the instance. Scripts
inserted through `document.write()` require
`settings.enableJavaScriptEvaluation: true`; see [Script execution](/async#script-execution).
The setting is not a switch that disables explicit `eval()` calls.

## GlobalWindow

`GlobalWindow` accepts the same options but evaluates scripts in the **host
global context**. It mirrors host intrinsics such as `Array`, `Object`, and
`Promise`. It does not automatically register `window` or `document` on the host.

```js
import { GlobalWindow } from "mad-dom";

const window = new GlobalWindow();
const key = "__madDomExampleMessage";
const previous = Object.getOwnPropertyDescriptor(globalThis, key);
try {
  window.eval('globalThis.__madDomExampleMessage = "Hello from the host"');
  console.log(globalThis[key]); // Hello from the host
  console.log(window.Array === globalThis.Array); // true
} finally {
  if (previous) Object.defineProperty(globalThis, key, previous);
  else delete globalThis[key];
  window.destroy();
}
```

Use `Window` for a document-scoped script context and `GlobalWindow` when host
scope is required. Neither VM evaluation nor `GlobalWindow` is a security
boundary for untrusted code.

## Lifecycle methods

| Method | Current behavior |
| --- | --- |
| `happyDOM.waitUntilComplete()` | Waits for registered work such as Window timers and `document.write()` external script loads |
| `happyDOM.whenAsyncComplete()` | Deprecated alias for that wait |
| `happyDOM.abort()` / `cancelAsync()` | Present, but cancellation is not implemented |
| `happyDOM.close()` | Partial observer cleanup; not a full task/resource shutdown |
| `window.close()` | No-op for a detached Window |
| `window.destroy()` | mad-dom extension that invalidates the native document and its nodes |

The [Async and cleanup guide](/async) explains what to await, how to release
resources, and the currently tracked lifecycle gaps.
