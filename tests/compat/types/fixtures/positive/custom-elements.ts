// Positive fixture: Custom Element registry and lifecycle typing (T42).
// Covers: `window.customElements` (define / get / getName / whenDefined /
// upgrade), a custom class extending `window.HTMLElement` with the lifecycle
// callback signatures and the observedAttributes static, and the
// `instanceof` narrowing of a created element to the custom class.
// Must typecheck with ZERO diagnostics against the happy-dom target; the
// mad-dom target records the shared Window-constructor gap in the ledger.
import { Window } from "dom-under-test";

const window = new Window({ width: 1024, height: 768 });
const document = window.document;

class StatusElement extends window.HTMLElement {
  static get observedAttributes(): string[] {
    return ["status"];
  }

  connectedCallback(): void {}

  disconnectedCallback(): void {}

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    void [name, oldValue, newValue];
  }

  report(): string {
    return "ok";
  }
}

window.customElements.define("status-element", StatusElement);
window.customElements.define("status-element-2", StatusElement, { extends: "div" });

const registry = window.customElements;
const defined = registry.get("status-element");
const name: string | null = registry.getName(StatusElement);
const pending: Promise<void> = registry.whenDefined("status-element");
void [defined, name, pending];

const element = document.createElement("status-element");
if (element instanceof StatusElement) {
  const report: string = element.report();
  void report;
}

const root = document.createElement("div");
if (document.body) {
  document.body.appendChild(root);
}
window.customElements.upgrade(root);

export const exported = { registry, element, root };
