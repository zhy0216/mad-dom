// Real differential scenario (T42): the public Custom Elements surface.
//
// Records the registry surface (define / get / getName / whenDefined), the
// happy-dom name/constructor validation errors (verbatim messages), the
// synchronous lifecycle callback order (connected / disconnected /
// attributeChanged for observed attributes only), the define-after-connect
// upgrade timing, the innerHTML parse upgrade order and the MutationObserver /
// microtask combination.
//
// The scenario deliberately stays on the behaviors the single-class facade
// matches: every class constructor is empty (happy-dom runs the constructor at
// creation, MAD DOM does not), attribute names are lowercase, parsing is flat
// (single level, so the attr-before-connected order is identical), and no
// observation records object identity across an upgrade (happy-dom replaces the
// element object there; MAD DOM upgrades in place). Those deviations are
// exercised by the `dom-custom-elements-upgrade` known-gap scenario.
export const id = "dom-custom-elements";
export const description = "real differential: define/get/getName/whenDefined, name/constructor validation, lifecycle callback order, observedAttributes, define-after-connect, parser upgrade, MutationObserver combination";
export const targets = "real";

// Drains the microtask queue so queued observer deliveries / promise handlers
// fire.
async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;
  const customElements = window.customElements;

  try {
    // --- registry surface: define / get / getName ---------------------------
    {
      class Widget extends window.HTMLElement {}
      class Other extends window.HTMLElement {}

      customElements.define("my-widget", Widget);
      api.record.value("get-defined", customElements.get("my-widget") === Widget);
      api.record.value("get-undefined", customElements.get("nope"));
      api.record.value("getName", customElements.getName(Widget));
      api.record.value("getName-undefined", customElements.getName(Other));

      const attempt = (fn) => {
        try {
          fn();
          api.record.value("define-error", "no-throw");
        } catch (error) {
          api.record.error(error, "sync-throw");
        }
      };
      attempt(() => customElements.define("div", class extends window.HTMLElement {}));
      attempt(() => customElements.define("my-widget", Other));
      attempt(() => customElements.define("my-other", Widget));
      api.record.value("get-after-failed-redefine", customElements.get("my-widget") === Widget);
      api.record.value("getName-after-failed-redefine", customElements.getName(Widget));
    }

    // --- lifecycle order: connected, attributeChanged, disconnected ---------
    {
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
      customElements.define("order-el", Element);

      const element = document.createElement("order-el");
      api.record.value("create-defined-instance", element instanceof Element);
      api.record.value("create-defined-htmlelement", element instanceof window.HTMLElement);

      // Appending to a detached parent fires nothing.
      const holder = document.createElement("div");
      holder.appendChild(element);
      api.record.value("append-detached", order.length);
      order.length = 0;

      document.body.appendChild(holder);
      api.record.value("append-connected", order.slice());
      order.length = 0;

      element.setAttribute("foo", "v1");
      element.setAttribute("bar", "x");
      element.setAttribute("foo", "v2");
      element.removeAttribute("foo");
      api.record.value("attribute-reactions", order.slice());
      order.length = 0;

      document.body.removeChild(holder);
      api.record.value("remove-connected", order.slice());
    }

    // --- move within the document: disconnected then connected --------------
    {
      const order = [];
      class Move extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
        disconnectedCallback() {
          order.push("disconnected");
        }
      }
      customElements.define("move-el", Move);
      const a = document.createElement("move-el");
      const b = document.createElement("move-el");
      const list = document.createElement("div");
      document.body.appendChild(list);
      list.appendChild(a);
      list.appendChild(b);
      order.length = 0;
      list.insertBefore(b, a);
      api.record.value("move-in-doc", order.slice());
    }

    // --- replaceChild: replacement connected before old child disconnected --
    {
      const order = [];
      class Replace extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
        disconnectedCallback() {
          order.push("disconnected");
        }
      }
      customElements.define("replace-el", Replace);
      const list = document.createElement("div");
      document.body.appendChild(list);
      const old = document.createElement("replace-el");
      const fresh = document.createElement("replace-el");
      list.appendChild(old);
      order.length = 0;
      list.replaceChild(fresh, old);
      api.record.value("replace-order", order.slice());
    }

    // --- observedAttributes are read once at define and lowercased ----------
    {
      const order = [];
      class Observed extends window.HTMLElement {
        static get observedAttributes() {
          return ["data-x", "data-y"];
        }
        attributeChangedCallback(name, oldValue, newValue) {
          order.push(`${name}:${newValue}`);
        }
      }
      customElements.define("observed-el", Observed);
      const element = document.createElement("observed-el");
      element.setAttribute("data-x", "1");
      element.setAttribute("data-y", "2");
      api.record.value("observed-reactions", order.slice());
    }

    // --- define-after-connect upgrades the connected element ----------------
    {
      const order = [];
      class Late extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
      }
      const pre = document.createElement("late-widget");
      document.body.appendChild(pre);
      order.length = 0;
      customElements.define("late-widget", Late);
      api.record.value("define-after-connect-order", order.slice());
    }

    // --- innerHTML parses a defined element: attr before connected ----------
    {
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
      customElements.define("parsed-el", Parsed);
      order.length = 0;
      document.body.innerHTML = "<parsed-el foo='parsed'></parsed-el>";
      api.record.value("parse-order", order.slice());
    }

    // --- whenDefined timing and invalid-name rejection ----------------------
    {
      const order = [];
      const pending = customElements.whenDefined("future-widget");
      pending.then(() => order.push("resolved"));
      order.push("after-call");
      customElements.define("future-widget", class extends window.HTMLElement {});
      order.push("after-define");
      await flushMicrotasks();
      api.record.value("whenDefined-order", order.slice());

      await customElements
        .whenDefined("div")
        .then(() => api.record.value("whenDefined-invalid", "resolved"))
        .catch((error) => api.record.error(error, "promise-rejection"));

      await customElements
        .whenDefined("future-widget")
        .then(() => api.record.value("whenDefined-existing", "resolved"));
    }

    // --- synchronous callbacks run before MutationObserver microtasks --------
    {
      const order = [];
      class Combo extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
      }
      customElements.define("combo-el", Combo);
      const observer = new window.MutationObserver(() => order.push("observer"));
      observer.observe(document.body, { childList: true });

      const element = document.createElement("combo-el");
      document.body.appendChild(element);
      await flushMicrotasks();
      api.record.value("combo-order", order.slice());
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
