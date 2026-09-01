// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-animation-element/SVGAnimationElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGAnimationElement constructor identity,
// the `onbegin` / `onend` / `onrepeat` event-handler attribute accessors
// (getter compiles the attribute, setter stores a listener and wires
// `dispatchEvent`) and the `requiredExtensions` / `systemLanguage` `SVGStringList`
// reflection. Requires `enableJavaScriptEvaluation` like the upstream
// `on<event>` tests.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeEventHandler, observeStringList } from "./_svg-helpers.js";

export const id = "nodes-svg-animation-element";
export const description = "real differential: SVGAnimationElement identity, begin/end/repeat handlers, SVGStringList reflection";
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
    const element = document.createElementNS(SVG_NS, "animate");
    observeInstanceof(api, window, element, "SVGAnimationElement", "SVGElement");

    for (const eventName of ["begin", "end", "repeat"]) {
      observeEventHandler(api, window, element, eventName, "on");
    }

    observeStringList(api, window, element, "requiredExtensions", "requiredExtensions");
    observeStringList(api, window, element, "systemLanguage", "systemLanguage");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
