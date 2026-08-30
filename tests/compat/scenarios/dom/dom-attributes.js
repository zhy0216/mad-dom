// Real differential scenario (T25E): element attribute get/set/remove/has.
//
// Scope is exactly the WHATWG attribute surface the T25E binding/facade
// implements — reads, writes, WebIDL DOMString argument shaping, return values,
// the frozen error taxonomy and the property descriptors. Observations that
// depend on surfaces MAD DOM does not own yet (`.attributes`, `.outerHTML`,
// ordering) are intentionally absent. The scenario records an error wherever a
// side throws, so a stricter Core rule (invalid WHATWG "Name") or the napi4
// error degradation surfaces as a recorded difference rather than an
// infrastructure failure.
export const id = "dom-attributes";
export const description = "real differential: element attribute get/set/remove/has, string conversion, errors and descriptors";
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

  try {
    const el = document.createElement("div");

    // Absent-attribute reads.
    api.record.value("absent-get", el.getAttribute("class"));
    api.record.value("absent-has", el.hasAttribute("class"));

    // Write / read / has / remove round-trip and return values.
    api.record.value("set-return", el.setAttribute("class", "x"));
    api.record.value("get-after-set", el.getAttribute("class"));
    api.record.value("has-after-set", el.hasAttribute("class"));
    api.record.value("remove-return", el.removeAttribute("class"));
    api.record.value("get-after-remove", el.getAttribute("class"));
    api.record.value("has-after-remove", el.hasAttribute("class"));

    // WebIDL DOMString argument shaping: values are stored as their string form.
    el.setAttribute("n", 123);
    api.record.value("numeric-value", el.getAttribute("n"));
    el.setAttribute("nil", null);
    api.record.value("null-value", el.getAttribute("nil"));
    el.setAttribute("undef", undefined);
    api.record.value("undefined-value", el.getAttribute("undef"));
    el.setAttribute("bool", true);
    api.record.value("boolean-value", el.getAttribute("bool"));

    // Multiple independent attributes and removal of a survivor.
    el.setAttribute("a", "1");
    el.setAttribute("b", "2");
    el.removeAttribute("a");
    api.record.value("survivor-value", el.getAttribute("b"));
    api.record.value("removed-absent", el.hasAttribute("a"));

    // An empty value is stored and round-trips.
    el.setAttribute("data-empty", "");
    api.record.value("empty-value", el.getAttribute("data-empty"));
    api.record.value("empty-has", el.hasAttribute("data-empty"));

    // Invalid attribute name: Core validates the WHATWG "Name" production; the
    // empty name is rejected by both sides (as different error objects).
    try {
      el.setAttribute("", "x");
      api.record.value("invalid-empty-name", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // Digit-led names: happy-dom accepts them, Core rejects the WHATWG Name.
    try {
      el.setAttribute("1bad", "x");
      api.record.value("digit-led-name", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // Non-Element behaviour: attribute access on a Text node. Both sides throw,
    // but as different error objects (TypeError "not a function" vs the frozen
    // HierarchyRequestError from Core).
    const text = document.createTextNode("hi");
    try {
      text.getAttribute("x");
      api.record.value("non-element-get", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // Property descriptors on the element's direct prototype: MAD DOM owns the
    // methods on Node.prototype, happy-dom inherits them from higher up the
    // class chain.
    const proto = Object.getPrototypeOf(el);
    api.record.descriptor("getAttribute-descriptor", proto, "getAttribute");
    api.record.descriptor("setAttribute-descriptor", proto, "setAttribute");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
