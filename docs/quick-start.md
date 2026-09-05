# Quick start

MAD DOM gives Bun a DOM backed by a Rust memory arena. Use familiar `Window`,
`document`, and `Browser` APIs for tests, HTML processing, and server-side DOM
work. The recorded comparison with happy-dom measured **2.83× faster core DOM
operations** and **1.57× faster test workflows**; see [Performance](/performance)
for the workload, environment, and complete results.

## Requirements and installation

Use **Bun 1.4.0 or newer** on a supported [platform](/platforms). Published
platform binaries install as optional dependencies; consumers do not need Rust.
The current package is alpha. To select the prerelease channel explicitly:

```sh
bun add -d mad-dom@next
```

For an application dependency, omit `-d`. Repository development uses the exact
Bun and Rust versions pinned in `.bun-version` and `rust-toolchain.toml`.

## Create your first document

Save this as `example.mjs`:

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://app.example/" });
try {
  const document = window.document;
  document.body.innerHTML = '<main><h1>Hello, MAD DOM</h1></main>';
  const button = document.createElement("button");
  button.textContent = "Save";
  document.querySelector("main").appendChild(button);

  console.log(document.querySelector("h1").textContent); // Hello, MAD DOM
  console.log(document.querySelectorAll("button").length); // 1
  console.log(button.outerHTML); // <button>Save</button>
} finally {
  await window.happyDOM.close();
  window.destroy();
}
```

Run it with:

```sh
bun example.mjs
```

The initial document has `html`, `head`, and `body` elements. The `url` option
sets document URL state and the base for relative URLs; it does not download
that page. Use [Browser navigation](/browser#navigation) to load HTML from a URL.

`destroy()` is a mad-dom extension for deterministic native document release.
Use it after your work is finished, and discard references to the Window and
its nodes. Clear timers and await requests before teardown. The current alpha's
`happyDOM.close()` has partial cleanup behavior; see [Lifecycle](/async#cleanup).

## Write a test

Save this as `button.test.js`:

```js
import { expect, test } from "bun:test";
import { Window } from "mad-dom";

test("clicking the button updates its label", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = "<button>Save</button>";
    const button = window.document.querySelector("button");
    button.addEventListener("click", () => { button.textContent = "Saved"; });
    button.click();
    expect(button.textContent).toBe("Saved");
  } finally {
    await window.happyDOM.close();
    window.destroy();
  }
});
```

```sh
bun test button.test.js
```

This test uses an explicit Window, so no global setup is required. The
[Testing guide](/testing) covers hooks, DOM Testing Library, and modules that
expect a global `document`.

## Move an existing happy-dom test

Start by changing the package import:

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Run the affected tests under Bun before switching the rest of the suite.
`window.happyDOM` keeps its familiar name. Framework adapters, global
registrators, and full Browser behavior need a separate check; follow the
[Migration guide](/migration).

## TypeScript

The package includes `index.d.ts`; a separate `@types` package is unnecessary.
Use the package's types when annotating values from its DOM:

```ts
import { Window, type Element } from "mad-dom";

const window = new Window();
try {
  window.document.body.innerHTML = "<h1>Typed DOM</h1>";
  const heading: Element | null = window.document.querySelector("h1");
  console.log(heading?.textContent); // Typed DOM
} finally {
  window.destroy();
}
```

Bun executes TypeScript directly. Type checking is a separate step in your
project. Built-in `lib.dom` types and mad-dom's declarations are different type
surfaces; avoid assuming that every native browser interface is implemented.

## Next steps

- [Why MAD DOM](/why-mad-dom): architecture, measured speed, and suitable workloads.
- [DOM guide](/dom): parsing, selectors, collections, mutations, forms, and snapshots.
- [Window reference](/window): construction, location, storage, console, and globals.
- [Browser guide](/browser): pages, local HTML, navigation, contexts, and evaluation.
- [Examples](/examples): recipes and runnable repository examples.
