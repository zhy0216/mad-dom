// Real differential scenario (T42): the deliberate custom element deviations.
//
// This scenario records the behaviors where the single-class facade honestly
// differs from happy-dom, so they are kept out of the `dom-custom-elements`
// pass scenario and documented as a known gap in the ledger:
//
//   - `new DefinedClass()` — happy-dom mints a real detached element (the
//     constructor is wired through the window symbols the registry stashes on
//     the prototype), while MAD DOM's empty `HTMLElement` base yields a bare
//     object without a native handle, so the observable `localName` differs;
//   - `registry.upgrade(root)` — happy-dom documents it as a no-op ("Not
//     implemented yet"), while MAD DOM performs a genuine spec-style upgrade of
//     the subtree (setting the wrapper prototypes and firing the reactions);
//   - the define-after-connect identity — happy-dom physically replaces the
//     connected candidate element (the pre-created reference stays a plain
//     `HTMLElement`), while MAD DOM upgrades the wrapper in place (the
//     reference becomes an instance of the custom class).
export const id = "dom-custom-elements-upgrade";
export const description = "real differential (known-gap): registry.upgrade() genuine upgrade vs happy-dom no-op, new DefinedClass() bare object vs real element, define-after-connect identity";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;
  const customElements = window.customElements;

  try {
    // --- new DefinedClass() --------------------------------------------------
    {
      class Direct extends window.HTMLElement {}
      customElements.define("direct-el", Direct);
      const direct = new Direct();
      // happy-dom mints a real detached element (localName "direct-el"); the
      // MAD DOM single-class base yields a bare object, so localName reads
      // undefined (no native handle behind it).
      api.record.value("direct-localName", String(direct.localName));
    }

    // --- registry.upgrade() genuine upgrade vs happy-dom no-op ---------------
    {
      const order = [];
      class Up extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
      }
      // Create the candidate before the definition so define (which only
      // upgrades connected candidates) leaves it uncustomized; connect it
      // after the definition.
      const candidate = document.createElement("upgrade-late");
      customElements.define("upgrade-late", Up);
      const holder = document.createElement("div");
      document.body.appendChild(holder);
      holder.appendChild(candidate);
      api.record.value("pre-upgrade-instanceof", candidate instanceof Up);
      order.length = 0;

      customElements.upgrade(holder);
      api.record.value("post-upgrade-instanceof", candidate instanceof Up);
      api.record.value("upgrade-connected-order", order.slice());
    }

    // --- define-after-connect identity --------------------------------------
    {
      const pre = document.createElement("identity-x");
      document.body.appendChild(pre);
      customElements.define("identity-x", class extends window.HTMLElement {});
      api.record.value("define-identity-pre", pre instanceof customElements.get("identity-x"));
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
