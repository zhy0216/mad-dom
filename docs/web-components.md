# Templates and web components

MAD DOM exposes templates, a per-window custom-element registry, Shadow DOM,
slots, and MutationObserver. These are useful for testing component DOM without
starting a graphical browser. Coverage is measured against the
[compatibility baseline](/compat-report).

## Clone a template

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  const template = document.createElement("template");
  template.innerHTML = '<article class="card"><h2></h2><p></p></article>';

  for (const title of ["Parse HTML", "Query elements"]) {
    const content = template.content.cloneNode(true);
    content.querySelector("h2").textContent = title;
    content.querySelector("p").textContent = "Powered by MAD DOM";
    document.body.appendChild(content);
  }

  console.log(document.querySelectorAll(".card").length); // 2
  console.log(template.content.querySelector("h2").textContent); // empty string
} finally {
  window.destroy();
}
```

Template children live in `template.content`, a DocumentFragment. Clone that
fragment for each instance so the original template remains reusable.

## Define a custom element

Extend the **owning Window's** `HTMLElement`, register a hyphenated name, and
create the element through that document:

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  class Greeting extends window.HTMLElement {
    static get observedAttributes() { return ["name"]; }

    connectedCallback() { this.render(); }
    attributeChangedCallback() { this.render(); }

    render() {
      this.textContent = `Hello, ${this.getAttribute("name") ?? "world"}!`;
    }
  }

  window.customElements.define("demo-greeting", Greeting);
  const greeting = window.document.createElement("demo-greeting");
  window.document.body.appendChild(greeting);
  console.log(greeting.textContent); // Hello, world!
  greeting.setAttribute("name", "Ada");
  console.log(greeting.textContent); // Hello, Ada!
  console.log(greeting instanceof Greeting); // true
} finally {
  window.destroy();
}
```

The registry exposes `define()`, `get()`, `getName()`, and `whenDefined()`.
Register definitions before parsing fixtures when possible. Reusing a Window
also reuses its registry; duplicate names and constructors cannot simply be
registered again. The current `upgrade()` entry point is a no-op, and the
late-definition behavior can replace connected candidates, so do not assume
an old reference becomes the upgraded element.

## Shadow roots and slots

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  const host = document.createElement("section");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<h2>Card</h2><slot name="summary"></slot>';
  host.innerHTML = '<p slot="summary">A native DOM for Bun</p>';
  document.body.appendChild(host);

  console.log(host.shadowRoot === shadow); // true
  console.log(document.querySelector("h2")); // null
  console.log(shadow.querySelector("h2").textContent); // Card
  console.log(shadow.querySelector("slot").assignedNodes()[0].textContent);
  // A native DOM for Bun
} finally {
  window.destroy();
}
```

Document queries search the light DOM; use `shadowRoot.querySelector()` for
the shadow tree. An open root is exposed through `host.shadowRoot`; a closed
root is accessible through the reference returned by `attachShadow()` but is
not exposed there. Slot assignment provides DOM relationships without painting
a composed layout.

For an event to bubble across a shadow boundary, set both `bubbles: true` and
`composed: true` when constructing it. Assert on event targets and paths when
your component relies on retargeting. Observe mutations through
[MutationObserver](/async#mutationobserver), and disconnect it after the test.

## Component snapshots

`host.outerHTML` serializes the host's light DOM. If a snapshot needs the shadow
tree as well, read `host.shadowRoot.innerHTML` separately. Keep current form
control values and application state in explicit assertions; HTML serialization
does not represent every piece of live component state.
