# Browser, pages, and frames

Use `Browser` when your work needs pages and navigation. Use a detached
[Window](/window) for a document you populate directly.

The object hierarchy is `Browser → BrowserContext → BrowserPage → BrowserFrame
→ Window → Document`. A Browser starts with one default context. Each page
currently has exactly one main frame; child-frame support is incomplete.

## Work with local HTML

```js
import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();
try {
  page.url = "https://app.example/";
  page.content = "<html><head><title>Demo</title></head><body><h1>Hello</h1></body></html>";

  console.log(page.mainFrame.document.title); // Demo
  console.log(page.mainFrame.document.querySelector("h1").textContent); // Hello
  console.log(page.frames.length); // 1
} finally {
  await browser.close();
  page.mainFrame.window.destroy();
}
```

Setting `page.url` changes URL state. Setting `page.content` parses HTML into
the existing document. Reading `page.content` serializes its document element.
Neither assignment fetches a page, and content assignment currently does not
execute scripts.

The examples explicitly release the native Window after Browser teardown
because alpha close behavior is incomplete. Finish requests and clear timers
before this point; see [Cleanup](/async#cleanup).

## Navigation

`await page.goto(url, options)` loads top-level HTTP(S) HTML, parses it, updates
the URL, and returns the response. Some navigation paths, such as `about:blank`,
return `null`. Check response status before using the HTML.

This runnable example uses a local server, so the result does not depend on an
external website:

```js
import { Browser } from "mad-dom";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response("<title>Local page</title><h1>Loaded</h1>", {
      headers: { "Content-Type": "text/html" },
    });
  },
});
const browser = new Browser();
const page = browser.newPage();
try {
  const response = await page.goto(server.url.href, { timeout: 5000 });
  console.log(response.status); // 200
  console.log(page.mainFrame.document.title); // Local page
  console.log(page.mainFrame.document.querySelector("h1").textContent); // Loaded
} finally {
  await browser.close();
  page.mainFrame.window.destroy();
  await server.stop(true);
}
```

Navigation follows redirects. Current supported request options include
`timeout` in milliseconds (default `30000`), `headers`, and `hard: true`, which
adds `Cache-Control: no-cache`. Other declared options, including navigation
callbacks, need behavioral verification; see [Configuration](/configuration).

**Navigation is currently HTML-only.** `goto()` does not evaluate page scripts
or automatically load the page's subresources, even if
`enableJavaScriptEvaluation` is set. For controlled script execution use
`evaluate()` or the Window's [`document.write()` path](/async#script-execution).

## History

| Method | Purpose |
| --- | --- |
| `goto(url, options?)` | Navigate to a URL |
| `goBack(options?)` | Move to the previous history entry |
| `goForward(options?)` | Move to the next entry |
| `goSteps(delta, options?)` | Move by a history offset; zero reloads |
| `reload(options?)` | Reload the current entry |
| `waitForNavigation()` | Wait for navigation; register before triggering a click/navigation |

History navigation may fetch the target again; it is not a saved visual page
snapshot. When calling `goto()` directly, await its returned promise to observe
navigation errors. `waitUntilComplete()` currently tracks pending navigation,
and does not also wait for all Window timers or application fetches.

## Evaluate code and inspect logs

```js
import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();
try {
  page.content = "<h1>Before</h1>";
  const text = page.evaluate(`
    document.querySelector("h1").textContent = "After";
    console.log("Updated");
    document.querySelector("h1").textContent;
  `);
  console.log(text); // After
  console.log(page.virtualConsolePrinter.readAsString().trim()); // Updated
} finally {
  await browser.close();
  page.mainFrame.window.destroy();
}
```

`evaluate()` accepts a string or a compiled `node:vm` Script, and returns its
result. It does not accept the callback-and-arguments API of browser automation
tools. The code sees the frame's `window` and `document`. Evaluation is explicit
and independent of the document-write setting. A VM context is not a security
boundary for untrusted code.

## Viewport and contexts

`page.setViewport({ width, height, devicePixelRatio })` changes the dimensions
exposed by `page.viewport` and `page.mainFrame.window`. Browser-wide defaults
can be supplied through `settings.viewport`. These dimensions do not cause
layout or painting.

`browser.newIncognitoContext()` creates another context with its own page list
and CookieContainer. `context.newPage()` creates a page in that context.
`browser.newPage()` uses the default context. The CookieContainer supports
`addCookies()`, `getCookies()`, and `clearCookies()`, but **is not currently
integrated with fetch/navigation cookie transport**. Do not use it as evidence
that an authenticated page request will include those cookies.

## Serve a directory through a virtual URL

For repository fixtures, `settings.fetch.virtualServers` can map navigation to
files. This setup fragment assumes `./fixtures/site/index.html` already exists:

```js
import { Browser } from "mad-dom";

const browser = new Browser({
  settings: {
    fetch: {
      virtualServers: [{
        url: "https://fixtures.example/",
        directory: "./fixtures/site",
      }],
    },
  },
});
const page = browser.newPage();
try {
  await page.goto("https://fixtures.example/");
  console.log(page.mainFrame.document.body.textContent);
} finally {
  await browser.close();
  page.mainFrame.window.destroy();
}
```

String URL mappings match prefixes; directories resolve to `index.html` and
missing files produce a 404 response. This mapping is implemented for browser
navigation; it is not a general interceptor for `window.fetch()`.

## Lifecycle reference

| Object | Create/access | Wait | Close |
| --- | --- | --- | --- |
| Browser | `new Browser()` | `waitUntilComplete()` over contexts | `close()` over contexts |
| Context | `defaultContext`, `newIncognitoContext()` | `waitUntilComplete()` over pages | `close()` over pages and cookie store |
| Page | `newPage()` | `waitUntilComplete()` on main frame | `close()` and remove page from context |
| Frame | `page.mainFrame` | Current navigation | `close()` frame bookkeeping |

These close operations currently do not implement full native/task shutdown;
the `abort()` methods are placeholders. Browser/frame lifecycle, cookies,
settings wiring, and script execution are tracked in the
[repair plan](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md).
