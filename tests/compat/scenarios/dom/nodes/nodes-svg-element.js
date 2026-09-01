// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-element/SVGElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGElement base surface on an unknown-SVG-tag
// element — constructor identity (`window.SVGElement` / `window.Element`), the
// `on<event>` handler-attribute accessors (representative subset of the
// upstream event list), `ownerSVGElement` / `viewportElement`, the live
// `dataset` DOMStringMap, `style` (CSSStyleDeclaration reflection) and
// `tabIndex`. The upstream `blur()` / `focus()` `spyOn(HTMLElementUtility, …)`
// delegation tests are dropped: they assert the internal utility delegation,
// not a public behaviour, and `HTMLElementUtility` is an internal module.
// Requires `enableJavaScriptEvaluation` like the upstream `on<event>` tests.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeEventHandler } from "./_svg-helpers.js";

export const id = "nodes-svg-element";
export const description = "real differential: SVGElement identity, on* handlers, ownerSVGElement, dataset, style, tabIndex";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElementNS(SVG_NS, "unknown");

    api.record.value("instanceof-svg", element instanceof window.SVGElement);
    api.record.value("instanceof-element", element instanceof window.Element);
    api.record.value("constructor-name", element.constructor.name);

    for (const eventName of ["click", "focus", "input", "keydown", "load", "submit", "wheel"]) {
      observeEventHandler(api, window, element, eventName, "on");
    }

    // ownerSVGElement / viewportElement: the nearest ancestor <svg>.
    const svg = document.createElementNS(SVG_NS, "svg");
    const rect = document.createElementNS(SVG_NS, "rect");
    svg.appendChild(rect);
    rect.appendChild(element);
    api.record.value("ownerSVGElement", element.ownerSVGElement === svg);
    api.record.value("viewportElement", element.viewportElement === svg);

    // dataset: the live DOMStringMap over data-* attributes.
    element.setAttribute("test-alpha", "value1");
    element.setAttribute("data-test-alpha", "value2");
    element.setAttribute("test-beta", "value3");
    element.setAttribute("data-test-beta", "value4");
    const dataset = element.dataset;
    api.record.value("dataset-identity", dataset === element.dataset);
    api.record.value("dataset-keys", Object.keys(dataset));
    api.record.value("dataset-values", Object.values(dataset));
    dataset.testGamma = "value5";
    api.record.value("dataset-set", element.getAttribute("data-test-gamma"));
    api.record.value("dataset-keys-2", Object.keys(dataset));
    element.setAttribute("data-test-delta", "value6");
    api.record.value("dataset-read", dataset.testDelta);
    api.record.value("dataset-keys-3", Object.keys(dataset));
    delete dataset.testDelta;
    api.record.value("dataset-delete", element.getAttribute("data-test-delta"));
    api.record.value("dataset-keys-4", Object.keys(dataset));

    // style: CSSStyleDeclaration reflection.
    const style = element.style;
    api.record.value("style-instanceof", style instanceof window.CSSStyleDeclaration);
    api.record.value("style-identity", element.style === style);
    style.border = "1px solid red";
    api.record.value("style-writeback", element.getAttribute("style"));
    element.setAttribute("style", "color: blue;");
    api.record.value("style-read", style.color);
    element.setAttribute("style", "border-radius: 2px; padding: 2px;");
    api.record.value("style-length", element.style.length);
    api.record.value("style-index0", element.style[0]);
    api.record.value("style-index1", element.style[1]);
    api.record.value("style-index2", element.style[2]);
    api.record.value("style-index3", element.style[3]);
    api.record.value("style-index4", element.style[4]);
    api.record.value("style-index5", element.style[5]);
    api.record.value("style-index6", element.style[6]);
    api.record.value("style-index7", element.style[7]);
    api.record.value("style-borderRadius", element.style.borderRadius);
    api.record.value("style-padding", element.style.padding);
    api.record.value("style-cssText", element.style.cssText);

    // tabIndex: Number("tabindex") / -1, -1 removes the attribute.
    element.setAttribute("tabindex", "5");
    api.record.value("tabIndex-read", element.tabIndex);
    element.tabIndex = 5;
    api.record.value("tabIndex-write", element.getAttribute("tabindex"));
    element.tabIndex = -1;
    api.record.value("tabIndex-minus-one", element.getAttribute("tabindex"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
