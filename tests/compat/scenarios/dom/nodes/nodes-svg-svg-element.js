// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-svg-element/SVGSVGElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGSVGElement window-level on<event> handler
// attributes, the `preserveAspectRatio` `SVGAnimatedPreserveAspectRatio`, the
// shared geometry `SVGAnimatedLength` reflections, `currentScale` /
// `currentTranslate`, the `viewBox` `SVGAnimatedRect`, the no-op animation /
// selection methods (`pauseAnimations` / `unpauseAnimations` / `getCurrentTime`
// / `setCurrentTime` / `getIntersectionList` / `getEnclosureList` /
// `checkIntersection` / `checkEnclosure` / `deselectAll`) and the
// `createSVG*` value factories. Dropped: the spyOn-`ParentNodeUtility`
// getElementsBy* / getElementById delegation tests (internal utility mocking,
// no public surface; the public query methods are covered by the dom-query
// scenarios).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeEventHandler,
  observeInstanceof,
  observeLength,
  observePreserveAspectRatio,
  observeRect,
} from "./_svg-helpers.js";

export const id = "nodes-svg-svg-element";
export const description = "real differential: SVGSVGElement window events + currentScale/currentTranslate/viewBox + create* factories";
export const targets = "real";

const WINDOW_EVENTS = [
  "afterprint",
  "beforeprint",
  "beforeunload",
  "gamepadconnected",
  "gamepaddisconnected",
  "hashchange",
  "languagechange",
  "message",
  "messageerror",
  "offline",
  "online",
  "pagehide",
  "pageshow",
  "popstate",
  "rejectionhandled",
  "storage",
  "unhandledrejection",
  "unload",
];

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
    const element = document.createElementNS(SVG_NS, "svg");

    for (const event of WINDOW_EVENTS) {
      observeEventHandler(api, window, element, event, "handler-");
    }

    observePreserveAspectRatio(api, window, element);
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");

    api.record.value("currentScale-default", element.currentScale);
    element.currentScale = 2;
    api.record.value("currentScale-set-2", element.currentScale);
    element.currentScale = 0;
    api.record.value("currentScale-set-0", element.currentScale);
    element.currentScale = -1;
    api.record.value("currentScale-set-neg", element.currentScale);
    try {
      element.currentScale = "foo";
      api.record.value("currentScale-nan", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    api.record.value("currentTranslate-type", element.currentTranslate instanceof window.SVGPoint);

    observeRect(api, window, element, "viewBox", "viewBox");

    api.record.value("pauseAnimations-type", typeof element.pauseAnimations);
    element.pauseAnimations();
    api.record.value("unpauseAnimations-type", typeof element.unpauseAnimations);
    element.unpauseAnimations();
    api.record.value("getCurrentTime", element.getCurrentTime());
    api.record.value("setCurrentTime-type", typeof element.setCurrentTime);
    element.setCurrentTime(1);

    const rect = element.createSVGRect();
    const targetRect = document.createElementNS(SVG_NS, "rect");
    const intersectionList = element.getIntersectionList(rect, targetRect);
    api.record.value("getIntersectionList-length", intersectionList.length);
    api.record.value("getIntersectionList-type", Object.prototype.toString.call(intersectionList));
    const enclosureList = element.getEnclosureList(rect, targetRect);
    api.record.value("getEnclosureList-length", enclosureList.length);
    api.record.value("checkIntersection", element.checkIntersection(targetRect, rect));
    api.record.value("checkEnclosure", element.checkEnclosure(targetRect, rect));
    api.record.value("deselectAll-type", typeof element.deselectAll);
    element.deselectAll();

    api.record.value("createSVGNumber-type", element.createSVGNumber() instanceof window.SVGNumber);
    api.record.value("createSVGLength-type", element.createSVGLength() instanceof window.SVGLength);
    api.record.value("createSVGAngle-type", element.createSVGAngle() instanceof window.SVGAngle);
    api.record.value("createSVGPoint-type", element.createSVGPoint() instanceof window.SVGPoint);
    api.record.value("createSVGMatrix-type", element.createSVGMatrix() instanceof window.SVGMatrix);
    api.record.value("createSVGRect-type", element.createSVGRect() instanceof window.SVGRect);
    api.record.value("createSVGTransform-type", element.createSVGTransform() instanceof window.SVGTransform);
    const matrix = element.createSVGMatrix();
    const transform = element.createSVGTransformFromMatrix(matrix);
    api.record.value("createSVGTransformFromMatrix-type", transform instanceof window.SVGTransform);
    api.record.value("createSVGTransformFromMatrix-matrix-same", transform.matrix === matrix);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
