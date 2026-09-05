# Working with the DOM

Use `window.document` for parsing, querying, and modifying HTML. These APIs
operate on the native Rust tree through JavaScript objects. The examples below
are independent scripts; run them with Bun after installing mad-dom.

## Parse and serialize HTML

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  document.body.innerHTML = '<article><h1>Native &amp; fast</h1></article>';
  console.log(document.querySelector("h1").textContent); // Native & fast
  console.log(document.querySelector("article").outerHTML);
  // <article><h1>Native &amp; fast</h1></article>
} finally {
  window.destroy();
}
```

| API | Use it for |
| --- | --- |
| `element.innerHTML` | Read or replace a subtree's HTML |
| `element.outerHTML` | Serialize the element with its children |
| `node.textContent` | Read text or replace children with text |
| `document.write(html)` | Write document markup; the first write parses a full document |
| `document.documentElement.outerHTML` | Serialize the `html` element, including `head` and `body` |

`textContent` treats input as text. `innerHTML` parses it as markup. Serializing
`documentElement` does not include a doctype that is its sibling. Parsing can
normalize markup, so a round trip is not guaranteed to reproduce the original
source bytes. The first `document.write()` restructures full-document markup;
later writes append fragments to the body. For repeatable fixtures, replace a
subtree explicitly or create a fresh Window.

## Select elements

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  document.body.innerHTML = `
    <ul id="tasks">
      <li class="task" data-state="done">Install</li>
      <li class="task" data-state="open">Test</li>
    </ul>
  `;
  const list = document.getElementById("tasks");
  const open = list.querySelector('[data-state="open"]');
  console.log(open.textContent); // Test
  console.log(open.matches("li.task")); // true
  console.log(open.closest("ul") === list); // true
  console.log(Array.from(list.querySelectorAll("li"), (item) => item.textContent));
  // [ "Install", "Test" ]
} finally {
  window.destroy();
}
```

`querySelector()` returns the first match or `null`; `querySelectorAll()` returns
a static NodeList. Use a narrower element as the query root when you need
results from one component. Selectors do not implicitly cross a shadow-root
boundary; query that root explicitly.

## Live collections and static results

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  document.body.innerHTML = "<ul><li>First</li></ul>";
  const list = document.querySelector("ul");
  const live = list.children;
  const snapshot = list.querySelectorAll("li");
  const item = document.createElement("li");
  item.textContent = "Second";
  list.appendChild(item);

  console.log(live.length); // 2
  console.log(snapshot.length); // 1
  console.log(list.lastChild === item); // true
} finally {
  window.destroy();
}
```

`children` contains elements; `childNodes` also includes text and comments.
Both reflect tree changes. `getElementsByTagName()` also returns a live
collection. When removing nodes during iteration, `Array.from(collection)`
gives you a stable array of the current members.

## Build and update a tree

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  const list = document.createElement("ul");
  const fragment = document.createDocumentFragment();
  for (const title of ["Parse", "Query", "Serialize"]) {
    const item = document.createElement("li");
    item.textContent = title;
    item.classList.add("task");
    fragment.appendChild(item);
  }
  list.appendChild(fragment);
  document.body.appendChild(list);

  const first = list.firstElementChild;
  list.appendChild(first); // Move the existing node to the end.
  first.setAttribute("data-state", "done");
  console.log(list.lastElementChild === first); // true
  console.log(fragment.childNodes.length); // 0

  list.replaceChildren();
  console.log(list.children.length); // 0
} finally {
  window.destroy();
}
```

Appending an existing node moves it. Appending a DocumentFragment moves its
children and empties the fragment. Use `cloneNode(true)` for a deep copy;
attributes and descendants are copied, while listeners attached with
`addEventListener()` must be attached to the copy separately.

## Events

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  const document = window.document;
  document.body.innerHTML = "<section><button>Save</button></section>";
  const section = document.querySelector("section");
  const button = document.querySelector("button");
  section.addEventListener("save", (event) => {
    console.log(event.detail.id); // 7
    console.log(event.target === button); // true
    event.preventDefault();
  });
  const accepted = button.dispatchEvent(new window.CustomEvent("save", {
    detail: { id: 7 }, bubbles: true, cancelable: true,
  }));
  console.log(accepted); // false
} finally {
  window.destroy();
}
```

Listeners support capture and bubbling, `once`, `preventDefault()`,
`stopPropagation()`, and `stopImmediatePropagation()`. `dispatchEvent()` is
synchronous and returns `false` when a cancelable event is prevented. Use
`button.click()` to exercise the element's click behavior, or dispatch a
specific event when that is the behavior your test needs.

## Forms

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://app.example/" });
try {
  const document = window.document;
  document.body.innerHTML = `
    <form><label>Email <input name="email" type="email" required></label>
    <button type="submit">Subscribe</button></form>
  `;
  const form = document.querySelector("form");
  const input = document.querySelector("input");
  console.log(input.validity.valueMissing); // true
  input.value = "ada@example.com";
  console.log(form.checkValidity()); // true

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    console.log(new window.FormData(form).get("email")); // ada@example.com
  });
  form.requestSubmit();
} finally {
  window.destroy();
}
```

Set form control properties such as `value`, `checked`, and `selected` to
represent current state. An HTML attribute can represent a default value, so
serializing markup alone does not necessarily capture a user's current input.
Prevent the submit event when testing form data without navigation.

## Styles and rendering

Inline styles, stylesheet objects, `getComputedStyle()`, and media-query APIs
provide a CSS surface for DOM tests. They do not create a visual layout engine.
For example, `offsetWidth`, `offsetHeight`, `clientWidth`, and `clientHeight`
return zero in the current implementation. A viewport setting changes exposed
dimensions, not measured element geometry.

For templates and custom elements, continue to [Web components](/web-components).
For mutation delivery and timers, see [Async work](/async).
