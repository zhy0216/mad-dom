# Testing with Bun

Use `bun test` and construct a Window for the DOM your test needs. This keeps
fixture ownership explicit and works without a global environment plugin.

## A fresh Window per test

```js
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "mad-dom";

let window;

beforeEach(() => {
  window = new Window({ url: "https://app.example/" });
});

afterEach(async () => {
  await window.happyDOM.close();
  window.destroy();
});

test("adds a list item", () => {
  const document = window.document;
  document.body.innerHTML = "<ul></ul>";
  const item = document.createElement("li");
  item.textContent = "Write a test";
  document.querySelector("ul").appendChild(item);

  expect(document.querySelectorAll("li").length).toBe(1);
  expect(document.querySelector("li").textContent).toBe("Write a test");
});
```

Save as `list.test.js`, then run `bun test list.test.js`. Keep tests using the
shared `window` variable sequential. Use `happyDOM.close()` to cancel owned work and disconnect observers during
teardown; see [cleanup](/async#cleanup).

A fresh Window also gives each test fresh storage and a custom-element
registry. Reusing a Window requires resetting more than `body.innerHTML`:
styles in the head, storage, listeners, registered elements, and pending work
can all survive a fixture replacement.

## DOM Testing Library

The repository benchmarks actual `@testing-library/dom@10.4.1` queries and
events. Install that measured version to reproduce this example:

```sh
bun add -d @testing-library/dom@10.4.1
```

```js
import { expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/dom";
import { Window } from "mad-dom";

test("saves the name entered in a form", async () => {
  const window = new Window({ url: "https://app.example/" });
  try {
    const document = window.document;
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" />
      <button>Save</button>
      <p role="status"></p>
    `;
    const queries = within(document.body);
    const input = queries.getByLabelText("Name");
    const button = queries.getByRole("button", { name: "Save" });
    button.addEventListener("click", () => {
      queries.getByRole("status").textContent = `Saved ${input.value}`;
    });

    fireEvent.input(input, { target: { value: "Ada" } });
    fireEvent.click(button);

    expect(queries.getByRole("status").textContent).toBe("Saved Ada");
  } finally {
    await window.happyDOM.close();
    window.destroy();
  }
});
```

`within(document.body)` binds queries to this document. It avoids the global
document setup required by `screen`. `fireEvent` dispatches events; it does not
establish support for `user-event`, a framework renderer, or jest-dom matchers.
Those integrations need their own tests.

For an async assertion, await the promise or observer event that represents
the update. The [Async guide](/async) shows both patterns. A fixed sleep makes
the test slower and does not prove the update has completed.

## Modules that expect DOM globals

If a module reads `document` at import time, install the globals it needs
before importing it. The following **minimal preload** exposes `window` and
`document`; add other constructors only when your module needs them.

Save as `test/setup-dom.js`:

```js
import { afterAll, beforeEach } from "bun:test";
import { Window } from "mad-dom";

const dom = new Window({ url: "https://app.example/" });
const previous = new Map();

for (const [name, value] of Object.entries({ window: dom, document: dom.document })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

beforeEach(() => {
  dom.document.head.replaceChildren();
  dom.document.body.replaceChildren();
  dom.localStorage.clear();
  dom.sessionStorage.clear();
});

afterAll(async () => {
  try {
    await dom.happyDOM.close();
    dom.destroy();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
```

Add to `bunfig.toml`:

```toml
[test]
preload = ["./test/setup-dom.js"]
```

Then run `bun test`. This setup shares a Window within the process. It does not
reset the custom-element registry, arbitrary globals, module state, or active
work. Keep tests sequential and use an explicit Window for cases that need
stronger fixture isolation. Use `window.Event` and other constructors from the
owning Window when creating DOM values. Copying every Window property onto
`globalThis` can overwrite Bun's timers and network primitives.

## Debugging and snapshots

Read `element.outerHTML` for a subtree snapshot and
`document.documentElement.outerHTML` for the document element. For logs produced
inside a Window, read `window.happyDOM.virtualConsolePrinter.readAsString()`.
See [Console](/window#console-output) for its draining behavior.

Compare semantic output as well as serialized HTML: selected values, node
identity after moves, event order, and observer records are often more useful
than a large snapshot. Layout dimensions and screenshots need a real browser.

## Measuring your tests

The recorded workflow benchmark is **1.57× faster in aggregate**, with 8/13
scenarios faster in mad-dom. It includes fixture mounting and cleanup, but
excludes runner startup and framework rendering. Use the same assertion and
cleanup policy on both engines when measuring your own suite. Full conditions
and results are in [Performance](/performance).
