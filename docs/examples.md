# Examples and recipes

Start with a recipe for the job you want to do. The guide examples use Bun and
public mad-dom APIs, and include setup, expected output, and cleanup.

## Find a recipe

| Goal | Example |
| --- | --- |
| Create a document and run the first test | [Quick start](/quick-start) |
| Use a fresh fixture in `bun test` | [Test hooks](/testing#a-fresh-window-per-test) |
| Query by role/label and dispatch an input event | [DOM Testing Library](/testing#dom-testing-library) |
| Load a module that expects a global document | [Bun preload](/testing#modules-that-expect-dom-globals) |
| Extract text and serialize HTML | [Parsing](/dom#parse-and-serialize-html) |
| Understand live collections and node identity | [Collections](/dom#live-collections-and-static-results) |
| Build a tree with a DocumentFragment | [Tree updates](/dom#build-and-update-a-tree) |
| Validate and submit a form | [Forms](/dom#forms) |
| Clone repeated cards from a template | [Templates](/web-components#clone-a-template) |
| Register a custom element or inspect slots | [Web components](/web-components) |
| Wait for a timer or a DOM mutation | [Async work](/async) |
| Fetch JSON from a local server | [Fetch](/async#fetch-and-cancellation) |
| Execute a controlled inline script | [Script execution](/async#script-execution) |
| Load server-rendered HTML | [Browser navigation](/browser#navigation) |
| Map a fixture directory to a URL | [Virtual servers](/browser#serve-a-directory-through-a-virtual-url) |
| Inspect application logs | [Virtual console](/window#console-output) |
| Change location, history, or viewport | [Window](/window) |

## Rewrite an HTML document

This complete script extracts article titles, marks matching articles, and
prints the updated HTML. It needs no network or script evaluation:

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  document.body.innerHTML = `
    <main>
      <article data-kind="guide"><h2>Getting started</h2></article>
      <article data-kind="reference"><h2>Window API</h2></article>
    </main>
  `;
  const titles = Array.from(document.querySelectorAll("article h2"),
    (heading) => heading.textContent);
  for (const article of document.querySelectorAll('[data-kind="guide"]')) {
    article.classList.add("featured");
  }
  console.log(titles); // [ "Getting started", "Window API" ]
  console.log(document.querySelector("article").className); // featured
  console.log(document.querySelector("main").outerHTML);
} finally {
  window.destroy();
}
```

## Repository example pairs

The repository's
[`examples/` directory](https://github.com/zhy0216/mad-dom/tree/main/examples)
contains 55 mad-dom scripts and corresponding `.happy-dom.mjs` versions adapted
from upstream wiki examples. They cover Window, Browser, pages, frames,
console printers, cookies, settings, and server-side DOM use.

From a **source checkout**, install dependencies and build the native module:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun examples/wiki-getting-started.mad-dom.mjs
bun examples/wiki-getting-started.happy-dom.mjs
```

Choose the matching pair to compare an API on both engines. Some examples need
external services or local fixture files, and some illustrate accepted settings
whose behavior remains incomplete. They are reference examples, not a blanket
compatibility claim. See [Configuration](/configuration) and
[Migration](/migration) before using those paths in tests.

The npm package does not include the repository's `examples/`, benchmarks, or
build scripts. Copy a standalone guide snippet into your own project and run
it with `bun filename.mjs`.
