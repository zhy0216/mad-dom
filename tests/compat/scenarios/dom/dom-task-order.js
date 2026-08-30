// Real differential scenario (T47): the fixed task ordering between events,
// MutationObserver deliveries, Custom Element reactions, Promise microtasks and
// timers.
//
// Custom Element lifecycle reactions (connected / attributeChanged) fire
// synchronously at the mutation point, event dispatch is synchronous, Promise
// and MutationObserver deliveries are microtasks in queue order, and timers run
// as macrotasks after the microtask checkpoint — the ordering the scenario
// records is scheduling-stable because the microtask/macrotask boundary is a
// language guarantee, not a timing coincidence.
export const id = "dom-task-order";
export const description = "real differential: event + Custom Element reactions synchronous, Promise + MutationObserver microtasks, timers after the microtask checkpoint";
export const targets = "real";

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

  try {
    const order = [];

    class XEl extends window.HTMLElement {
      connectedCallback() {
        order.push("connected");
      }
      attributeChangedCallback() {
        order.push("attr-changed");
      }
      static get observedAttributes() {
        return ["id"];
      }
    }
    window.customElements.define("x-el", XEl);

    order.push("sync1");
    Promise.resolve().then(() => order.push("promise1"));

    const el = document.createElement("x-el");
    el.setAttribute("id", "a"); // synchronous attributeChanged reaction
    document.body.appendChild(el); // synchronous connected reaction
    order.push("sync2");
    el.setAttribute("id", "b"); // synchronous attributeChanged reaction

    const mo = new window.MutationObserver(() => order.push("mo"));
    mo.observe(document.body, { childList: true, subtree: true });
    Promise.resolve().then(() => order.push("promise2"));
    document.body.appendChild(document.createElement("plain")); // queues the MO microtask

    // Event dispatch is synchronous.
    el.addEventListener("click", () => order.push("event"));
    el.dispatchEvent(new window.Event("click", { bubbles: true }));

    window.setTimeout(() => order.push("timer0"), 0);
    window.setTimeout(() => order.push("timer5"), 5);
    order.push("sync3");

    await wait(60);
    api.record.value("order", order);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
