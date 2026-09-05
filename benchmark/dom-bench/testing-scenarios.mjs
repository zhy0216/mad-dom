// Small application/test workflows. Both engines execute these exact functions.
// DOM reads belong to the workload; expected-result assertions run after timing.
import { deepStrictEqual } from "node:assert/strict";
import { fireEvent, within } from "@testing-library/dom";

const ROWS = 20;
const CARD = '<article><h2>Counter</h2><button type="button">Increment</button><output>0</output></article>';
const PROJECTS = '<h1>Projects</h1><label for="search">Search projects</label><input id="search" type="text">' +
  '<ul>' + Array.from({ length: ROWS }, (_, i) =>
    `<li data-testid="project-${i}"><span>Project ${i}</span><button type="button" aria-label="Open project ${i}">Open</button></li>`).join("") + '</ul>';
const FORM = '<form><input name="title" value="Draft"><textarea name="notes">Initial</textarea>' +
  '<select name="priority"><option value="low">Low</option><option value="high">High</option></select>' +
  '<input type="checkbox" name="notify" value="yes"><input name="ignored" value="secret" disabled>' +
  '<button type="submit">Save</button></form>';

function scenario(name, cases, html, exercise, expected) {
  return {
    name, cases,
    async run(Window, count) {
      const window = new Window({ url: "https://bench.test/" });
      const { document } = window;
      const results = [];
      try {
        const start = performance.now();
        for (let i = 0; i < count; i++) {
          document.body.innerHTML = html;
          // Only asynchronous workflows cross a microtask boundary per case.
          const result = exercise(window, i);
          results.push(result instanceof Promise ? await result : result);
          document.body.replaceChildren();
          results[results.length - 1].push(document.body.childNodes.length);
        }
        const ms = performance.now() - start;
        for (let i = 0; i < count; i++) {
          deepStrictEqual(results[i], [...expected(i), 0], `${name}: case ${i}`);
        }
        return { ms, checks: { cases: count, results } };
      } finally {
        await window.happyDOM.close();
      }
    },
  };
}

const fixtureLifecycle = scenario("fixtureLifecycle", 100, CARD, (window) => {
  const { document } = window;
  const card = document.querySelector("article");
  const button = card.querySelector("button");
  const output = card.querySelector("output");
  let clicks = 0;
  const increment = () => { output.textContent = String(++clicks); };
  button.addEventListener("click", increment);
  button.click();
  button.click();
  const result = [card.querySelector("h2").textContent, output.textContent, card.isConnected];
  button.removeEventListener("click", increment);
  card.remove();
  button.click(); // removed listener must not change the detached component
  return [...result, clicks, card.isConnected];
}, () => ["Counter", "2", true, 2, false]);

const windowLifecycle = {
  name: "windowLifecycle", cases: 25,
  async run(Window, count) {
    const results = [];
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const window = new Window({ url: "https://bench.test/" });
      try {
        const { document, localStorage } = window;
        const initial = [document.body.childNodes.length, localStorage.getItem("case")];
        localStorage.setItem("case", String(i));
        document.body.innerHTML = CARD;
        results.push([...initial, document.querySelector("h2").textContent, localStorage.getItem("case")]);
        document.body.replaceChildren();
      } finally {
        // Unlike other scenarios, environment construction AND teardown are timed.
        await window.happyDOM.close();
      }
    }
    const ms = performance.now() - start;
    for (let i = 0; i < count; i++) deepStrictEqual(results[i], [0, null, "Counter", String(i)], `windowLifecycle: case ${i}`);
    return { ms, checks: { cases: count, results } };
  },
};

const testingLibraryText = scenario("testingLibraryText", 50, PROJECTS, (window, i) => {
  const q = within(window.document.body);
  const row = q.getByTestId(`project-${i % ROWS}`);
  const scoped = within(row);
  return [scoped.getByText(`Project ${i % ROWS}`).textContent,
    scoped.getByText("Open").getAttribute("aria-label"), q.queryByText("No projects") === null];
}, (i) => [`Project ${i % ROWS}`, `Open project ${i % ROWS}`, true]);

const testingLibraryEvents = scenario("testingLibraryEvents", 50, CARD, (window) => {
  const button = within(window.document.body).getByText("Increment");
  let selected = "";
  let clicks = 0;
  button.addEventListener("click", () => { clicks++; selected = button.textContent; }, { once: true });
  fireEvent.click(button);
  fireEvent.click(button);
  return [selected, clicks];
}, () => ["Increment", 1]);

// Keep default visibility/accessibility behavior: no hidden:true shortcut,
// injected defaultView, or replacement query implementation to hide a gap.
const testingLibraryRole = scenario("testingLibraryRole", 25, PROJECTS, (window, i) => {
  const q = within(window.document.body);
  return [q.getByRole("heading", { name: "Projects", level: 1 }).textContent,
    q.getByRole("button", { name: `Open project ${i % ROWS}` }).getAttribute("aria-label"),
    q.getAllByRole("button").length];
}, (i) => ["Projects", `Open project ${i % ROWS}`, ROWS]);

const testingLibraryLabel = scenario("testingLibraryLabel", 25, PROJECTS, (window, i) => {
  const q = within(window.document.body);
  const input = q.getByLabelText("Search projects");
  let changes = 0;
  input.addEventListener("input", () => changes++);
  fireEvent.input(input, { target: { value: `Project ${i}` } });
  return [q.getByDisplayValue(`Project ${i}`).id, changes];
}, () => ["search", 1]);

const todoInteractions = scenario("todoInteractions", 50, '<ul></ul><output>0 completed</output>', (window) => {
  const { document } = window;
  const list = document.querySelector("ul");
  const live = list.getElementsByTagName("li");
  let handled = 0;
  const onClick = (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    handled++;
    const row = button.closest("li");
    if (button.dataset.action === "remove") row.remove();
    else {
      const done = row.classList.toggle("done");
      button.setAttribute("aria-pressed", String(done));
    }
    document.querySelector("output").textContent = `${list.querySelectorAll(".done").length} completed`;
  };
  list.addEventListener("click", onClick);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 12; i++) {
    const row = document.createElement("li");
    row.dataset.id = String(i);
    row.innerHTML = `<span>Task ${i}</span><button type="button" data-action="toggle"><span>Toggle</span></button><button type="button" data-action="remove"><span>Remove</span></button>`;
    fragment.appendChild(row);
  }
  list.appendChild(fragment);
  const initial = live.length;
  for (let i = 0; i < 12; i += 2) list.querySelector(`[data-id="${i}"] [data-action="toggle"] span`).click();
  for (let i = 0; i < 12; i += 3) list.querySelector(`[data-id="${i}"] [data-action="remove"] span`).click();
  const result = [initial, live.length, handled, document.querySelector("output").textContent,
    Array.from(list.querySelectorAll(".done"), (row) => row.dataset.id),
    list.querySelectorAll('[aria-pressed="true"]').length];
  list.removeEventListener("click", onClick);
  return result;
}, () => [12, 8, 10, "4 completed", ["2", "4", "8", "10"], 4]);

const formSubmission = scenario("formSubmission", 50, FORM, (window, i) => {
  const form = window.document.querySelector("form");
  const title = form.querySelector('[name="title"]');
  const notes = form.querySelector("textarea");
  const priority = form.querySelector("select");
  const notify = form.querySelector('[name="notify"]');
  let inputs = 0;
  let submits = 0;
  let payload;
  form.addEventListener("input", () => inputs++);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submits++;
    payload = Array.from(new window.FormData(form).entries());
  });
  title.value = `Issue ${i}`;
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  notes.value = `Notes ${i}`;
  notes.dispatchEvent(new window.Event("input", { bubbles: true }));
  priority.value = "high";
  priority.dispatchEvent(new window.Event("change", { bubbles: true }));
  notify.checked = true;
  notify.dispatchEvent(new window.Event("change", { bubbles: true }));
  form.requestSubmit(form.querySelector("button"));
  form.reset();
  return [payload, inputs, submits, title.value, notes.value, priority.value, notify.checked, form.elements.length];
}, (i) => [[["title", `Issue ${i}`], ["notes", `Notes ${i}`], ["priority", "high"], ["notify", "yes"]], 2, 1, "Draft", "Initial", "low", false, 6]);

const templateClone = scenario("templateClone", 50,
  '<template><li class="card"><h2></h2><a href="/projects">Open</a></li></template><ul></ul>', (window) => {
    const { document } = window;
    const template = document.querySelector("template");
    const list = document.querySelector("ul");
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < ROWS; i++) {
      const clone = template.content.cloneNode(true);
      clone.querySelector("h2").textContent = `Project ${i}`;
      clone.querySelector("a").setAttribute("href", `/projects/${i}`);
      fragment.appendChild(clone);
    }
    list.appendChild(fragment);
    return [fragment.childNodes.length, template.content.querySelector("h2").textContent,
      Array.from(list.querySelectorAll("li"), (row) => [row.querySelector("h2").textContent, row.querySelector("a").getAttribute("href")])];
  }, () => [0, "", Array.from({ length: ROWS }, (_, i) => [`Project ${i}`, `/projects/${i}`])]);

const keyedReconcile = scenario("keyedReconcile", 50, '<ul></ul>', (window) => {
  const { document } = window;
  const list = document.querySelector("ul");
  const nodes = new Map();
  for (let i = 0; i < ROWS; i++) {
    const row = document.createElement("li");
    row.dataset.key = String(i);
    row.textContent = `Item ${i}`;
    nodes.set(i, row);
    list.appendChild(row);
  }
  const live = list.children;
  const snapshot = list.querySelectorAll("li");
  const initial = live.length;
  const keys = Array.from({ length: ROWS / 2 }, (_, i) => ROWS - 1 - i * 2);
  for (const [key, node] of nodes) if (key % 2 === 0) node.remove();
  let anchor = list.firstChild;
  for (const key of keys) {
    const node = nodes.get(key);
    node.textContent = `Updated ${key}`;
    list.insertBefore(node, anchor);
    anchor = node.nextSibling;
  }
  return [initial, live.length, snapshot.length, snapshot[0].isConnected,
    Array.from(live, (row) => [row.dataset.key, row.textContent, row === nodes.get(Number(row.dataset.key))])];
}, () => [ROWS, ROWS / 2, ROWS, false,
  Array.from({ length: ROWS / 2 }, (_, i) => { const key = ROWS - 1 - i * 2; return [String(key), `Updated ${key}`, true]; })]);

const asyncObserver = scenario("asyncObserver", 25, '<section aria-busy="true"><p>Loading</p></section>', async (window, i) => {
  const root = window.document.querySelector("section");
  const records = [];
  let observer;
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      // A watchdog only; successful runs never wait for a fixed timer/poll interval.
      timer = setTimeout(() => reject(new Error("MutationObserver did not deliver the completed update")), 2000);
      observer = new window.MutationObserver((batch) => {
        records.push(...batch);
        if (root.getAttribute("aria-busy") === "false") resolve();
      });
      observer.observe(root, { childList: true, attributes: true, subtree: true });
    });
    // Mocked request: deterministic promise resolution, no network or fixed sleep.
    const update = Promise.resolve({ title: `Loaded ${i}` }).then((data) => {
      root.querySelector("p").textContent = data.title;
      root.setAttribute("aria-busy", "false");
    });
    await Promise.all([ready, update]);
    return [root.textContent, root.getAttribute("aria-busy"),
      records.some((r) => r.type === "childList" && r.target === root.querySelector("p")),
      records.some((r) => r.type === "attributes" && r.attributeName === "aria-busy" && r.target === root)];
  } finally {
    clearTimeout(timer);
    observer?.disconnect();
  }
}, (i) => [`Loaded ${i}`, "false", true, true]);

const shadowComponent = scenario("shadowComponent", 50, '<div id="host"><span slot="label">Counter</span></div>', (window) => {
  const host = window.document.querySelector("#host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<slot name="label"></slot><button type="button">Increment</button><output>0</output>';
  const button = shadow.querySelector("button");
  const output = shadow.querySelector("output");
  let clicks = 0;
  let bubbled = 0;
  host.addEventListener("click", () => bubbled++);
  button.addEventListener("click", () => { output.textContent = String(++clicks); });
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  return [output.textContent, bubbled, host.shadowRoot === shadow,
    window.document.querySelector("button") === null, shadow.querySelector("slot").assignedNodes()[0] === host.firstChild];
}, () => ["1", 1, true, true, true]);

const snapshotRoundTrip = scenario("snapshotRoundTrip", 50,
  '<article class="card"><h2>Project &amp; notes</h2><p data-note="a&amp;b">Ready &lt;now&gt;</p><!--boundary--></article>', (window, i) => {
    const { document } = window;
    const card = document.querySelector("article");
    const clone = card.cloneNode(true);
    clone.querySelector("h2").textContent = `Updated ${i}`;
    const snapshot = clone.outerHTML;
    const container = document.createElement("div");
    container.innerHTML = snapshot;
    return [card.querySelector("h2").textContent, snapshot, container.innerHTML,
      container.querySelector("p").textContent, container.querySelector("p").getAttribute("data-note")];
  }, (i) => {
    const snapshot = `<article class="card"><h2>Updated ${i}</h2><p data-note="a&amp;b">Ready &lt;now&gt;</p><!--boundary--></article>`;
    return ["Project & notes", snapshot, snapshot, "Ready <now>", "a&b"];
  });

export const TESTING_SCENARIOS = [fixtureLifecycle, windowLifecycle, testingLibraryText,
  testingLibraryEvents, testingLibraryRole, testingLibraryLabel, todoInteractions, formSubmission, templateClone,
  keyedReconcile, asyncObserver, shadowComponent, snapshotRoundTrip];

export function casesForSize(scenario, size) {
  return Math.max(1, Math.round(scenario.cases * size));
}
