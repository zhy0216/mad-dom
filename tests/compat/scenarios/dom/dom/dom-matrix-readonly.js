// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/dom-matrix/DOMMatrixReadOnly.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `DOMMatrixReadOnly` class import
// (used by the upstream only for `toBeInstanceOf(...)`) is replaced by the
// public `instanceof window.DOMMatrixReadOnly`; the internal
// internal symbol-keyed slot writes on the getter blocks are replaced by the
// public constructor dict surface (`new window.DOMMatrixReadOnly({ m11: … })`
// then reading the getters). `transformPoint()` is read through the public
// `toJSON()` / `instanceof window.DOMPoint` surface (the baseline returns a
// `window.DOMPoint`). The `perspective(none)`/`perspective(0)` equivalence is
// recorded as both matrices' JSON.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "dom-matrix-readonly";
export const description = "real differential: DOMMatrixReadOnly constructors, serialization, is2D/isIdentity, non-mutating transforms";
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
    const MRO = window.DOMMatrixReadOnly;

    const ctorDefault = new MRO();
    api.record.value("ctor-default-instance", ctorDefault instanceof MRO);
    api.record.value("ctor-default", ctorDefault.toJSON());

    const ctorFromMatrix = new MRO(new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)"));
    api.record.value("ctor-from-matrix", ctorFromMatrix.toJSON());

    const ctorFromReadOnly = new MRO(new MRO("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)"));
    api.record.value("ctor-from-readonly", ctorFromReadOnly.toJSON());

    const ctorFromObject = new MRO({ a: 10, b: 20, c: 30, d: 40, e: 50, f: 60 });
    api.record.value("ctor-from-object", ctorFromObject.toJSON());

    const ctorFromObjectM11 = new MRO({
      m11: 1, m12: 2, m13: 3, m14: 4,
      m21: 5, m22: 6, m23: 7, m24: 8,
      m31: 9, m32: 10, m33: 11, m34: 12,
      m41: 13, m42: 14, m43: 15,
    });
    api.record.value("ctor-from-object-m11", ctorFromObjectM11.toJSON());

    const ctorFromObjectPartial = new MRO({ m11: 1, m12: 2, m13: 3, m14: 4 });
    api.record.value("ctor-from-object-partial", ctorFromObjectPartial.toJSON());

    const ctorFromArray2d = new MRO([10, 20, 30, 40, 50, 60]);
    api.record.value("ctor-from-array-2d", ctorFromArray2d.toJSON());

    const ctorFromArray3d = new MRO([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    api.record.value("ctor-from-array-3d", ctorFromArray3d.toJSON());

    const ctorFromMatrixString = new MRO("matrix(10, 20, 30, 40, 50, 60)");
    api.record.value("ctor-from-matrix-string", ctorFromMatrixString.toJSON());

    const ctorFromMatrix3dString = new MRO("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    api.record.value("ctor-from-matrix3d-string", ctorFromMatrix3dString.toJSON());

    // --- string transform functions ---
    const cases = {
      perspective_none: "perspective(none)",
      perspective_0: "perspective(0)",
      perspective_px: "perspective(100px)",
      perspective_cm: "perspective(10cm)",
      perspective_mm: "perspective(100mm)",
      perspective_in: "perspective(10in)",
      perspective_pt: "perspective(10pt)",
      perspective_pc: "perspective(10pc)",
      perspective_q: "perspective(10Q)",
      perspective_rad: "perspective(10rad)",
      perspective_turn: "perspective(1turn)",
      translate: "translate(10px, 20px)",
      translate3d: "translate3d(10px, 20px, 30px)",
      translateX: "translateX(10px)",
      translateY: "translateY(10px)",
      translateZ: "translateZ(10px)",
      rotate_rad: "rotate(10rad)",
      rotateX: "rotateX(10deg)",
      rotateY: "rotateY(10deg)",
      rotateZ: "rotateZ(10deg)",
      rotate3d: "rotate3d(1, 1, 1, 45deg)",
      scale_1: "scale(10)",
      scale_2: "scale(10, 20)",
      scale3d: "scale3d(10, 20, 30)",
      scaleX: "scaleX(10)",
      scaleY: "scaleY(10)",
      scaleZ: "scaleZ(10)",
      skew: "skew(10deg)",
      skew2: "skew(10deg, 20deg)",
      skewX: "skewX(10deg)",
      skewY: "skewY(10deg)",
    };
    for (const [name, source] of Object.entries(cases)) {
      api.record.value(`string-${name}`, new MRO(source).toJSON());
    }

    // --- relative-length perspective throws ---
    const relativeUnits = { percent: "%", vw: "vw", vh: "vh", vmin: "vmin", vmax: "vmax", em: "em", rem: "rem" };
    for (const [name, unit] of Object.entries(relativeUnits)) {
      try {
        new MRO(`perspective(10${unit})`);
        api.record.value(`throw-relative-${name}`, "no-throw");
      } catch (error) {
        api.record.value(`throw-relative-${name}`, { name: error.name, message: error.message });
      }
    }

    // --- getters (a–f via dict construction) ---
    const getters = new MRO({ a: 10, b: 20, c: 30, d: 40, e: 50, f: 60 });
    api.record.value("getter-a", getters.a);
    api.record.value("getter-b", getters.b);
    api.record.value("getter-c", getters.c);
    api.record.value("getter-d", getters.d);
    api.record.value("getter-e", getters.e);
    api.record.value("getter-f", getters.f);

    // --- getters (m11–m44 via dict construction) ---
    const componentInit = {
      m11: 1, m12: 2, m13: 3, m14: 4,
      m21: 5, m22: 6, m23: 7, m24: 8,
      m31: 9, m32: 10, m33: 11, m34: 12,
      m41: 13, m42: 14, m43: 15, m44: 16,
    };
    for (const key of Object.keys(componentInit)) {
      api.record.value(`getter-${key}`, new MRO({ [key]: componentInit[key] })[key]);
    }

    // --- isIdentity / is2D ---
    api.record.value("isIdentity-true", new MRO().isIdentity);
    api.record.value("isIdentity-false", new MRO("matrix(10, 20, 30, 40, 50, 60)").isIdentity);
    api.record.value("is2D-true", new MRO().is2D);
    api.record.value("is2D-false", new MRO("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)").is2D);

    // --- toFloat32Array / toFloat64Array ---
    const floatMatrix = new MRO("matrix(10, 20, 30, 40, 50, 60)");
    const f32 = floatMatrix.toFloat32Array();
    api.record.value("float32-instance", f32 instanceof Float32Array);
    api.record.value("float32-length", f32.length);
    api.record.value("float32-array", Array.from(f32));
    const f32b = floatMatrix.toFloat32Array(true);
    api.record.value("float32-2d-length", f32b.length);
    api.record.value("float32-2d-array", Array.from(f32b));
    const f64 = floatMatrix.toFloat64Array();
    api.record.value("float64-instance", f64 instanceof Float64Array);
    api.record.value("float64-array", Array.from(f64));
    const f64b = floatMatrix.toFloat64Array(true);
    api.record.value("float64-2d-array", Array.from(f64b));

    // --- toString ---
    api.record.value("toString-2d", new MRO("matrix(10, 20, 30, 40, 50, 60)").toString());
    api.record.value("toString-3d", new MRO("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)").toString());

    // --- non-mutating transforms ---
    const base2d = "matrix(10, 20, 30, 40, 50, 60)";
    const base3d = "matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 1)";
    const base3dFull = "matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)";

    api.record.value("multiply-2d", new MRO("matrix(2, 3, 4, 5, 6, 7)").multiply(new MRO("matrix(2, 3, 4, 5, 6, 7)")).toJSON());
    api.record.value("multiply-3d", new MRO(base3dFull).multiply(new MRO(base3dFull)).toJSON());

    api.record.value("translate-2d", new MRO(base2d).translate(10, 20).toJSON());
    api.record.value("translate-3d", new MRO(base3dFull).translate(10, 20, 30).toJSON());
    api.record.value("translate-3d-offset", new MRO("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)").translate(5, 6, 7).toJSON());

    api.record.value("scale-2d", new MRO(base2d).scale(2, 3).toJSON());
    api.record.value("scale-3d", new MRO(base3dFull).scale(2, 3, 4).toJSON());
    api.record.value("scale-3d-point", new MRO("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)").scale(2, 3, 4, 5, 6, 7).toJSON());

    api.record.value("scale3d-3d", new MRO(base3dFull).scale3d(2).toJSON());
    api.record.value("scale3d-point", new MRO("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)").scale3d(2, 5, 6, 7).toJSON());

    api.record.value("scaleNonUniform-2d", new MRO(base2d).scaleNonUniform(2, 3).toJSON());
    api.record.value("scaleNonUniform-3d", new MRO(base3dFull).scaleNonUniform(2, 3).toJSON());

    api.record.value("rotateAxisAngle-x", new MRO(base3d).rotateAxisAngle(1, 0, 0, 90).toJSON());
    api.record.value("rotateAxisAngle-y", new MRO(base3d).rotateAxisAngle(0, 1, 0, 90).toJSON());
    api.record.value("rotateAxisAngle-z", new MRO(base3d).rotateAxisAngle(0, 0, 1, 90).toJSON());
    api.record.value("rotateAxisAngle-111", new MRO(base3d).rotateAxisAngle(1, 1, 1, 100).toJSON());
    api.record.value("rotateAxisAngle-222", new MRO(base3d).rotateAxisAngle(2, 2, 2, 90).toJSON());
    api.record.value("rotateAxisAngle-450", new MRO(base3d).rotateAxisAngle(0, 0, 1, 360 + 90).toJSON());
    api.record.value("rotateAxisAngle-neg90", new MRO(base3d).rotateAxisAngle(0, 0, 1, -90).toJSON());

    api.record.value("rotate-x", new MRO(base3d).rotate(90).toJSON());
    api.record.value("rotate-xy", new MRO(base3d).rotate(90, 90).toJSON());
    api.record.value("rotate-xyz", new MRO(base3d).rotate(90, 90, 90).toJSON());

    api.record.value("rotateFromVector-2d", new MRO("matrix(1, 2, 3, 4, 5, 6)").rotateFromVector(1, 7).toJSON());
    api.record.value("rotateFromVector-x", new MRO(base3d).rotateFromVector(90).toJSON());
    api.record.value("rotateFromVector-xy", new MRO(base3d).rotateFromVector(90, 90).toJSON());

    api.record.value("skewX-2d", new MRO(base2d).skewX(10).toJSON());
    api.record.value("skewX-3d", new MRO(base3d).skewX(10).toJSON());
    api.record.value("skewY-2d", new MRO(base2d).skewY(10).toJSON());
    api.record.value("skewY-3d", new MRO(base3d).skewY(10).toJSON());

    api.record.value("flipX-2d", new MRO(base2d).flipX().toJSON());
    api.record.value("flipX-3d", new MRO(base3d).flipX().toJSON());
    api.record.value("flipY-2d", new MRO(base2d).flipY().toJSON());
    api.record.value("flipY-3d", new MRO(base3d).flipY().toJSON());

    api.record.value("inverse-2d", new MRO("matrix(1, 2, 3, 4, 5, 6)").inverse().toJSON());
    api.record.value("inverse-3d", new MRO(base3d).inverse().toJSON());

    // --- transformPoint ---
    const tp2d = new MRO("matrix(1, 2, 3, 4, 5, 6)").transformPoint({ x: 10, y: 20 });
    api.record.value("transformPoint-2d-json", tp2d.toJSON());
    api.record.identity("transformPoint-2d-instance", tp2d instanceof window.DOMPoint, true);
    const tp3d = new MRO(base3d).transformPoint({ x: 10, y: 20 });
    api.record.value("transformPoint-3d-json", tp3d.toJSON());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
