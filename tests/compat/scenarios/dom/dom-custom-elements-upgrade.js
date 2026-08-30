// Real differential scenario (T42 → T48D): the aligned custom element upgrade
// semantics.
//
// T42 recorded the deliberate deviations from happy-dom here; T48A closed the
// `new DefinedClass()` gap and T48D aligned the remaining two, so this scenario
// now records a full happy-dom match:
//
//   - `new DefinedClass()` — happy-dom mints a real detached element (the
//     constructor is wired through the window symbols the registry stashes on
//     the prototype), and MAD DOM does the same through the mint slot `define`
//     stashes on the class prototype, so `localName` reads the registered name;
//   - `registry.upgrade(root)` — happy-dom documents it as a no-op ("Not
//     implemented yet"), and MAD DOM now matches: no genuine upgrade, no
//     lifecycle reaction;
//   - the define-after-connect identity — happy-dom physically replaces the
//     connected candidate element (the pre-created reference stays a plain
//     `HTMLElement`), and MAD DOM now matches (the reference reads `false`).
export const id = "dom-custom-elements-upgrade";
export const description = "real differential: registry.upgrade() no-op parity, new DefinedClass() real element, define-after-connect physical replacement identity";
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
      // mint slot `define` stashes on the prototype makes MAD DOM's
      // `new DefinedClass()` cast one too (T48A).
      api.record.value("direct-localName", String(direct.localName));
    }

    // --- registry.upgrade() no-op (happy-dom parity) -------------------------
    {
      const order = [];
      class Up extends window.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
      }
      // Create the candidate before the definition so define (which only
      // replaces connected candidates) leaves it uncustomized; connect it
      // after the definition.
      const candidate = document.createElement("upgrade-late");
      customElements.define("upgrade-late", Up);
      const holder = document.createElement("div");
      document.body.appendChild(holder);
      holder.appendChild(candidate);
      api.record.value("pre-upgrade-instanceof", candidate instanceof Up);
      order.length = 0;

      // happy-dom documents `registry.upgrade()` as "Not implemented yet" — a
      // no-op that upgrades nothing and fires no reaction (T48D parity).
      customElements.upgrade(holder);
      api.record.value("post-upgrade-instanceof", candidate instanceof Up);
      api.record.value("upgrade-connected-order", order.slice());
    }

    // --- define-after-connect physical replacement ---------------------------
    {
      const pre = document.createElement("identity-x");
      document.body.appendChild(pre);
      customElements.define("identity-x", class extends window.HTMLElement {});
      // happy-dom physically replaces the connected candidate: the pre-created
      // reference stays a plain HTMLElement, so it is not an instance of the
      // just-defined class (T48D parity).
      api.record.value("define-identity-pre", pre instanceof customElements.get("identity-x"));
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
