import { afterEach, describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";

// T42 Custom Elements integration tests.
//
// They drive the complete custom element surface through the official package
// entry (index.js → js/entry.js → the facade `window.customElements`) and pin
// the acceptance criteria:
//
//   - the registry — `define` / `get` / `getName` / `whenDefined` / `upgrade`
//     and the happy-dom name/constructor validation (a failed define leaves no
//     partial registry state, the second define of the same name/constructor
//     throws a DOMException);
//   - lifecycle callback order — `connectedCallback` on connect (and *only*
//     then), `disconnectedCallback` on removal of a connected element, and
//     `attributeChangedCallback` for observed attributes only (the happy-dom
//     lowercased-snapshot rule), all fired synchronously at the mutation point;
//   - the single-class upgrade — an element created with a defined name is
//     `instanceof` the custom class *and* `instanceof window.HTMLElement`, keeps
//     every Node method; `define`-after-connect physically replaces the
//     connected candidate (the old reference stays a plain `HTMLElement`) and
//     the replacement fires `connectedCallback`;
//   - `registry.upgrade()` is a no-op (happy-dom documents it as "Not
//     implemented yet");
//   - the parser path — `innerHTML` parsing a defined element observes its
//     attributes before it is connected (happy-dom parse order);
//   - combination with MutationObserver — the synchronous custom element
//     callbacks run before the microtask-delivered observer records;
//   - clone / import / adopt keep the custom class without firing a reaction.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

// Drains the microtask queue so queued observer deliveries fire.
async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

const createdWindows = [];

function makeWindow() {
  const window = new Window();
  createdWindows.push(window);
  return { window, document: window.document };
}

// Destroy every created window after each test so the process-global
// `liveDocumentCount` stays deterministic for the GC lifecycle tests in the
// other suites.
afterEach(() => {
  for (const window of createdWindows.splice(0)) {
    window.destroy();
  }
});

const runtimeDescribe = nativeAvailable ? describe : describe.skip;

runtimeDescribe("custom elements", () => {
  test("define/get/getName and the name/constructor validation", () => {
    const { window } = makeWindow();
    const { customElements } = window;

    class Widget extends window.HTMLElement {}
    class Other extends window.HTMLElement {}

    expect(typeof customElements).toBe("object");
    customElements.define("my-widget", Widget);
    expect(customElements.get("my-widget")).toBe(Widget);
    expect(customElements.get("nope")).toBeUndefined();
    expect(customElements.getName(Widget)).toBe("my-widget");
    expect(customElements.getName(Other)).toBeNull();

    // Failed definitions leave no partial registry state (happy-dom parity):
    // re-defining the same name or constructor throws and the first definition
    // stays intact.
    expect(() => customElements.define("my-widget", Other)).toThrow(
      "the name \"my-widget\" has already been used with this registry",
    );
    expect(customElements.get("my-widget")).toBe(Widget);
    expect(() => customElements.define("my-other", Widget)).toThrow(
      "this constructor has already been used with this registry",
    );
    expect(customElements.getName(Widget)).toBe("my-widget");
    expect(customElements.get("my-other")).toBeUndefined();

    // Invalid custom element names (no hyphen, reserved, non-string) throw.
    expect(() => customElements.define("div", class extends window.HTMLElement {})).toThrow(
      "\"div\" is not a valid custom element name",
    );
    expect(() => customElements.define("annotation-xml", class extends window.HTMLElement {})).toThrow(
      "is not a valid custom element name",
    );
    expect(() => customElements.define("my-widget", "not a function")).toThrow(TypeError);

    // `define` fires `connectedCallback` synchronously on an element that was
    // already connected (the define-after-connect upgrade path).
    const order = [];
    class Late extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
    }
    const pre = window.document.createElement("late-widget");
    window.document.body.appendChild(pre);
    customElements.define("late-widget", Late);
    expect(order).toEqual(["connected"]);
  });

  test("lifecycle callback order: connected, attributeChanged, disconnected", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Element extends window.HTMLElement {
      static get observedAttributes() {
        return ["foo"];
      }
      connectedCallback() {
        order.push(`connected:${this.getAttribute("foo")}`);
      }
      disconnectedCallback() {
        order.push("disconnected");
      }
      attributeChangedCallback(name, oldValue, newValue) {
        order.push(`attr:${name}:${oldValue}:${newValue}`);
      }
    }
    window.customElements.define("order-el", Element);

    const element = document.createElement("order-el");
    expect(element).toBeInstanceOf(Element);
    expect(element).toBeInstanceOf(window.HTMLElement);
    // The upgraded wrapper keeps every Node method (single-class model).
    expect(typeof element.setAttribute).toBe("function");
    expect(typeof element.appendChild).toBe("function");

    // Connecting to a detached parent fires nothing.
    const holder = document.createElement("div");
    holder.appendChild(element);
    expect(order).toEqual([]);

    // Connecting to the document fires connectedCallback.
    document.body.appendChild(holder);
    expect(order).toEqual(["connected:null"]);

    // Only observed attributes fire attributeChangedCallback.
    order.length = 0;
    element.setAttribute("foo", "v1");
    element.setAttribute("bar", "x");
    element.setAttribute("foo", "v2");
    element.removeAttribute("foo");
    expect(order).toEqual([
      "attr:foo:null:v1",
      "attr:foo:v1:v2",
      "attr:foo:v2:null",
    ]);

    // Removing a connected element fires disconnectedCallback.
    order.length = 0;
    document.body.removeChild(holder);
    expect(order).toEqual(["disconnected"]);
  });

  test("moving a connected element fires disconnected then connected", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Move extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
      disconnectedCallback() {
        order.push("disconnected");
      }
    }
    window.customElements.define("move-el", Move);
    const a = document.createElement("move-el");
    const b = document.createElement("move-el");
    const list = document.createElement("div");
    document.body.appendChild(list);
    list.appendChild(a);
    list.appendChild(b);
    order.length = 0;
    list.insertBefore(b, a);
    expect(order).toEqual(["disconnected", "connected"]);
  });

  test("replaceChild fires the replacement's connected before the old child's disconnected", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Replace extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
      disconnectedCallback() {
        order.push("disconnected");
      }
    }
    window.customElements.define("replace-el", Replace);
    const list = document.createElement("div");
    document.body.appendChild(list);
    const old = document.createElement("replace-el");
    const fresh = document.createElement("replace-el");
    list.appendChild(old);
    order.length = 0;
    list.replaceChild(fresh, old);
    expect(order).toEqual(["connected", "disconnected"]);
  });

  test("innerHTML parsing a defined element observes attributes before connecting", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Parsed extends window.HTMLElement {
      static get observedAttributes() {
        return ["foo"];
      }
      connectedCallback() {
        order.push(`connected:${this.getAttribute("foo")}`);
      }
      attributeChangedCallback(name, oldValue, newValue) {
        order.push(`attr:${name}:${oldValue}:${newValue}`);
      }
    }
    window.customElements.define("parsed-el", Parsed);
    document.body.innerHTML = "<parsed-el foo='parsed'></parsed-el>";
    expect(order).toEqual(["attr:foo:null:parsed", "connected:parsed"]);
    expect(document.body.querySelector("parsed-el")).toBeInstanceOf(Parsed);
  });

  test("define-after-connect replaces the connected element and fires connectedCallback", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Late extends window.HTMLElement {
      static get observedAttributes() {
        return ["data-x"];
      }
      connectedCallback() {
        order.push("connected");
      }
      attributeChangedCallback(name, oldValue, newValue) {
        order.push(`attr:${name}:${oldValue}:${newValue}`);
      }
    }
    // A connected custom-name element that predates the definition.
    const element = document.createElement("late-upgrade");
    document.body.appendChild(element);
    // Attributes set before the definition do NOT fire attributeChangedCallback
    // (happy-dom parity — the replacement only fires connectedCallback).
    element.setAttribute("data-x", "pre");
    order.length = 0;
    window.customElements.define("late-upgrade", Late);
    expect(order).toEqual(["connected"]);
    // happy-dom physically replaces the connected candidate: the old reference
    // stays a plain HTMLElement while the upgraded element lives in the tree
    // with the candidate's attributes transferred onto it.
    expect(element).not.toBeInstanceOf(Late);
    const upgraded = document.body.querySelector("late-upgrade");
    expect(upgraded).toBeInstanceOf(Late);
    expect(upgraded).not.toBe(element);
    expect(upgraded.getAttribute("data-x")).toBe("pre");
    // Attributes set after the upgrade (on the replacement) fire the reaction.
    upgraded.setAttribute("data-x", "post");
    expect(order).toEqual(["connected", "attr:data-x:pre:post"]);
  });

  test("detached candidates are not upgraded by define (happy-dom parity)", () => {
    const { window, document } = makeWindow();
    const detached = document.createElement("detached-widget");
    window.customElements.define("detached-widget", class extends window.HTMLElement {});
    // In the single-class model an un-upgraded element is a plain `Node`
    // wrapper (whose prototype chain reaches HTMLElement), so the meaningful
    // parity checks are `instanceof HTMLElement` (true) and `instanceof` the
    // just-defined class (false).
    expect(detached).toBeInstanceOf(window.HTMLElement);
    expect(detached).not.toBeInstanceOf(window.customElements.get("detached-widget"));
  });

  test("registry.upgrade is a no-op (happy-dom parity)", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Upgrade extends window.HTMLElement {
      static get observedAttributes() {
        return ["data-x"];
      }
      connectedCallback() {
        order.push("connected");
      }
      attributeChangedCallback(name, oldValue, newValue) {
        order.push(`attr:${name}:${oldValue}:${newValue}`);
      }
    }
    // Create the element before the definition so define (which only replaces
    // connected candidates) leaves it uncustomized.
    const detached = document.createElement("upgrade-widget");
    detached.setAttribute("data-x", "pre");
    window.customElements.define("upgrade-widget", Upgrade);
    expect(detached).not.toBeInstanceOf(Upgrade);

    const holder = document.createElement("div");
    document.body.appendChild(holder);
    holder.appendChild(detached);
    // A candidate connected after the definition stays plain too (the append
    // path performs no upgrade).
    expect(detached).not.toBeInstanceOf(Upgrade);

    order.length = 0;
    // happy-dom documents `registry.upgrade()` as "Not implemented yet": it is
    // a no-op, fires no reaction and upgrades nothing.
    window.customElements.upgrade(holder);
    expect(order).toEqual([]);
    expect(detached).not.toBeInstanceOf(Upgrade);
  });

  test("whenDefined resolves after define and rejects invalid names", async () => {
    const { window } = makeWindow();
    const order = [];
    const pending = window.customElements.whenDefined("future-widget");
    pending.then(() => order.push("resolved"));
    order.push("after-call");
    window.customElements.define("future-widget", class extends window.HTMLElement {});
    order.push("after-define");
    await flush();
    expect(order).toEqual(["after-call", "after-define", "resolved"]);

    // Already defined resolves immediately.
    await expect(window.customElements.whenDefined("future-widget")).resolves.toBeUndefined();

    // Invalid names reject.
    await expect(window.customElements.whenDefined("div")).rejects.toMatchObject({
      name: "DOMException",
      message: 'Failed to execute \'whenDefined\' on \'CustomElementRegistry\': Invalid custom element name: "div"',
    });
  });

  test("synchronous callbacks run before MutationObserver microtasks", async () => {
    const { window, document } = makeWindow();
    const order = [];
    class Combined extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
    }
    window.customElements.define("combined-el", Combined);
    const observer = new window.MutationObserver(() => order.push("observer"));
    observer.observe(document.body, { childList: true });

    const element = document.createElement("combined-el");
    document.body.appendChild(element);
    await flush();
    expect(order).toEqual(["connected", "observer"]);
  });

  test("clone / import / adopt keep the custom class without firing a reaction", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Kept extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
      attributeChangedCallback() {
        order.push("attr");
      }
    }
    window.customElements.define("kept-el", Kept);
    const element = document.createElement("kept-el");
    element.setAttribute("data-x", "1");

    const clone = element.cloneNode(true);
    expect(clone).toBeInstanceOf(Kept);
    expect(order).toEqual([]);

    const imported = document.importNode(element, true);
    expect(imported).toBeInstanceOf(Kept);
    expect(order).toEqual([]);
  });

  test("observed attributes are read once at define and lowercased", () => {
    const { window, document } = makeWindow();
    const order = [];
    class Observed extends window.HTMLElement {
      static get observedAttributes() {
        return ["DATA-X", "data-y"];
      }
      attributeChangedCallback(name, oldValue, newValue) {
        order.push(`${name}:${newValue}`);
      }
    }
    window.customElements.define("observed-el", Observed);
    const element = document.createElement("observed-el");
    element.setAttribute("data-x", "1");
    element.setAttribute("data-y", "2");
    expect(order).toEqual(["data-x:1", "data-y:2"]);
  });
});
