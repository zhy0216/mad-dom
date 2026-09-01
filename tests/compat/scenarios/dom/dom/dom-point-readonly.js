// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/DOMPointReadOnly.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the test's internal `DOMPointReadOnly` class
// import is never referenced at runtime — every assertion goes through the
// public `new window.DOMPointReadOnly(...)` constructor and its public
// members, so the whole file ports 1:1. The `toBeInstanceOf(DOMPoint)`
// relation that `matrixTransform()` must satisfy is asserted through the
// public `instanceof window.DOMPoint` (the baseline mints one class per
// window, so the window accessors are the public identity surface).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "dom-point-readonly";
export const description = "real differential: DOMPointReadOnly constructor defaults, toJSON, fromPoint, matrixTransform";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    const point = new window.DOMPointReadOnly(1, 2, 3, 4);
    api.record.value("x", point.x);
    api.record.value("y", point.y);
    api.record.value("z", point.z);
    api.record.value("w", point.w);

    const point2 = new window.DOMPointReadOnly(null, null, null, 4);
    api.record.value("nulls-x", point2.x);
    api.record.value("nulls-y", point2.y);
    api.record.value("nulls-z", point2.z);
    api.record.value("nulls-w", point2.w);

    const point3 = new window.DOMPointReadOnly();
    api.record.value("default-x", point3.x);
    api.record.value("default-y", point3.y);
    api.record.value("default-z", point3.z);
    api.record.value("default-w", point3.w);

    const point4 = new window.DOMPointReadOnly("nan", "nan", "nan", "nan");
    api.record.value("nan-x", point4.x);
    api.record.value("nan-y", point4.y);
    api.record.value("nan-z", point4.z);
    api.record.value("nan-w", point4.w);

    api.record.value("toJSON", point.toJSON());

    const fromObject = window.DOMPointReadOnly.fromPoint({ x: 1, y: 2, z: 3, w: 4 });
    api.record.value("fromPoint-object", fromObject.toJSON());

    const fromEmpty = window.DOMPointReadOnly.fromPoint();
    api.record.value("fromPoint-empty", fromEmpty.toJSON());

    const fromPartial = window.DOMPointReadOnly.fromPoint({ x: 1, y: 2 });
    api.record.value("fromPoint-partial", fromPartial.toJSON());

    const transformed = point.matrixTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    api.record.identity("matrixTransform-instance", transformed instanceof window.DOMPoint, true);
    api.record.value("matrixTransform-toJSON", transformed.toJSON());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
