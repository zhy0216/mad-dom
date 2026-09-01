// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGPoint.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGPoint(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `svg.createSVGPoint()` mint
// (standalone value) and through a `<polygon>` `points` `baseVal` list item
// (attribute-backed). The read-only error uses a read-only animatedPoints
// list item.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-point";
export const description = "real differential: SVGPoint x/y read/write via createSVGPoint mint + points list item + read-only error";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    const svg = document.createElementNS(SVG_NS, "svg");
    const point = svg.createSVGPoint();
    api.record.value("type", point instanceof window.SVGPoint);
    api.record.value("x-default", point.x);
    api.record.value("y-default", point.y);
    point.x = 10;
    api.record.value("x-set", point.x);
    point.y = 10;
    api.record.value("y-set", point.y);
    api.record.value("xy-after", `${point.x} ${point.y}`);

    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", "1 2.2");
    const item = polygon.points.getItem(0);
    api.record.value("x-from-attribute", item.x);
    api.record.value("y-from-attribute", item.y);
    item.x = 10;
    api.record.value("x-writeback", polygon.getAttribute("points"));
    item.y = 10;
    api.record.value("y-writeback", polygon.getAttribute("points"));

    try {
      polygon.animatedPoints.getItem(0).x = 10;
      api.record.value("readonly-x", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      polygon.animatedPoints.getItem(0).y = 10;
      api.record.value("readonly-y", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
