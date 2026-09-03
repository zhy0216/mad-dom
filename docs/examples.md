# Examples

A quick tour of the mad-dom API. Every snippet here is lifted from the
runnable scripts in [`examples/`](https://github.com/zhy0216/mad-dom/tree/main/examples),
so it reflects the real surface — not a guess. Swap in `from "mad-dom"` and run.

## Window & document

`Window` is the entry point. Create one, reach for `document`, and mutate the
DOM the way you would in a browser.

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://localhost:8080" });
const document = window.document;

document.body.innerHTML = '<div class="container"></div>';

const container = document.querySelector(".container");
const button = document.createElement("button");
container.appendChild(button);

// "<div class="container"><button></button></div>"
console.log(document.body.innerHTML);

window.close();
```

Reading text back is just `textContent`:

```js
console.log(document.querySelector("button").textContent);
```

## Query & events

`querySelector` returns the first matching element (or `null`);
`querySelectorAll` returns them all. Events follow the standard
add / dispatch flow.

```js
import { Window } from "mad-dom";

const window = new Window();
const document = window.document;

document.body.innerHTML = '<div id="mid"><span id="leaf">leaf</span></div>';
const leaf = document.getElementById("leaf");

leaf.addEventListener("click", (event) => {
  console.log("clicked", event.target.textContent);
});

leaf.dispatchEvent(new window.Event("click", { bubbles: true }));

window.close();
```

Listeners fire in registration order, `dispatchEvent` returns `false` only when
a cancelable event was default-prevented, and `stopPropagation()` /
`stopImmediatePropagation()` work as expected.

## Browser & pages

Reach for `Browser` when you want pages, navigation and a real document per
frame. Set `url` and `content` directly, or `goto()` a page.

```js
import { Browser } from "mad-dom";

const browser = new Browser();
const page = browser.newPage();

page.url = "https://example.com";
page.content = "<html><body>Hello world!</body></html>";

// "Hello world!"
console.log(page.mainFrame.document.body.textContent);

await browser.close();
```

For live navigation, `page.goto(url)` loads a document and
`page.mainFrame.document` reads it back.

## GlobalWindow

`GlobalWindow` runs `document.write` with JavaScript evaluation enabled, so
inline scripts execute and land on the global object.

```js
import { GlobalWindow } from "mad-dom";

const window = new GlobalWindow({
  settings: { enableJavaScriptEvaluation: true },
});

window.document.write(`
  <script>
    globalThis.helloWorld = 'Hello world!';
  </script>
`);

// "Hello world!"
console.log(global.helloWorld);

await window.happyDOM.close();
```

## window.happyDOM

Every `Window` exposes a `happyDOM` handle for lifecycle control.

Wait for all async work (fetch, timers) to drain before asserting:

```js
import { Window } from "mad-dom";

const window = new Window({
  settings: { enableJavaScriptEvaluation: true },
});

window.document.write(`
  <script>
    setTimeout(() => { document.body.innerHTML = "Hello World!"; }, 10);
  </script>
`);

await window.happyDOM.waitUntilComplete();

// "Hello World!"
console.log(window.document.body.innerHTML);

await window.happyDOM.close();
```

Set the viewport dimensions:

```js
import { Window } from "mad-dom";

const window = new Window();

window.happyDOM.setViewport({ width: 1920, height: 1080, devicePixelRatio: 2 });

// 1920
console.log(window.innerWidth);

await window.happyDOM.close();
```

## Where to go next

The snippets above are the tip of it. [`examples/`](https://github.com/zhy0216/mad-dom/tree/main/examples)
holds **55 runnable scripts** — Window, Browser, pages, frames, cookies, the
detached-window API — and each one ships with a `.happy-dom.mjs` twin, so you
can diff mad-dom against happy-dom side by side.

Run any of them directly:

```sh
bun examples/wiki-browser.mad-dom.mjs
```
