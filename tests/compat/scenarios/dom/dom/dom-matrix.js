// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/dom-matrix/DOMMatrix.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `DOMMatrix` /
// `DOMMatrixReadOnly` class imports (used by the upstream only for
// `toBeInstanceOf(...)` and the internal symbol-keyed slot writes on the
// getter/setter blocks) are replaced by the public identity surface
// (`instanceof window.DOMMatrix`) and by the public writable accessors
// (`matrix.m11 = 10` → `matrix.m11`). The `isInstanceOf(window.DOMMatrixReadOnly)`
// relation is deliberately NOT asserted: happy-dom mints one window-extended
// class per constructor, so its `window.DOMMatrix` is not an
// `instanceof window.DOMMatrixReadOnly` even though the classes are related —
// the two sides differ there, so that assertion surface is dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "dom-matrix";
export const description = "real differential: DOMMatrix constructors, writable accessors, and *Self mutations (multiply/translate/scale/rotate/skew/flip/invert/preMultiply)";
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
    const identity = new window.DOMMatrix();
    api.record.value("ctor-default", identity.toJSON());
    api.record.value("ctor-default-instance", identity instanceof window.DOMMatrix);

    const fromMatrix = new window.DOMMatrix(new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)"));
    api.record.value("ctor-from-matrix", fromMatrix.toJSON());

    const fromReadOnly = new window.DOMMatrix(
      new window.DOMMatrixReadOnly("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)"),
    );
    api.record.value("ctor-from-readonly", fromReadOnly.toJSON());

    const fromObject = new window.DOMMatrix({ a: 10, b: 20, c: 30, d: 40, e: 50, f: 60 });
    api.record.value("ctor-from-object", fromObject.toJSON());

    const fromArray = new window.DOMMatrix([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    api.record.value("ctor-from-array", fromArray.toJSON());

    const fromString = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    api.record.value("ctor-from-string", fromString.toJSON());

    // --- writable accessors (a–f) ---
    const accessors = new window.DOMMatrix();
    accessors.a = 10;
    api.record.value("accessor-a", accessors.a);
    accessors.b = 20;
    api.record.value("accessor-b", accessors.b);
    accessors.c = 30;
    api.record.value("accessor-c", accessors.c);
    accessors.d = 40;
    api.record.value("accessor-d", accessors.d);
    accessors.e = 50;
    api.record.value("accessor-e", accessors.e);
    accessors.f = 60;
    api.record.value("accessor-f", accessors.f);

    // --- writable accessors (m11–m44) ---
    const componentMatrix = new window.DOMMatrix();
    for (const key of [
      "m11", "m12", "m13", "m14",
      "m21", "m22", "m23", "m24",
      "m31", "m32", "m33", "m34",
      "m41", "m42", "m43", "m44",
    ]) {
      componentMatrix[key] = 10;
      api.record.value(`accessor-${key}`, componentMatrix[key]);
    }

    // --- multiplySelf() ---
    const m1 = new window.DOMMatrix("matrix(2, 3, 4, 5, 6, 7)");
    const m2 = new window.DOMMatrix("matrix(2, 3, 4, 5, 6, 7)");
    api.record.identity("multiplySelf-returns-self", m1.multiplySelf(m2) === m1, true);
    api.record.value("multiplySelf-2d", m1.toJSON());

    const m3 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    const m4 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    m3.multiplySelf(m4);
    api.record.value("multiplySelf-3d", m3.toJSON());

    // --- translateSelf() ---
    const t2 = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("translateSelf-returns-self", t2.translateSelf(10, 20) === t2, true);
    api.record.value("translateSelf-2d", t2.toJSON());

    const t3 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    t3.translateSelf(10, 20, 30);
    api.record.value("translateSelf-3d", t3.toJSON());

    const t3b = new window.DOMMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)");
    t3b.translateSelf(5, 6, 7);
    api.record.value("translateSelf-3d-offset", t3b.toJSON());

    // --- scaleSelf() ---
    const s2 = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("scaleSelf-returns-self", s2.scaleSelf(2, 3) === s2, true);
    api.record.value("scaleSelf-2d", s2.toJSON());

    const s3 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    s3.scaleSelf(2, 3, 4);
    api.record.value("scaleSelf-3d", s3.toJSON());

    const s3p = new window.DOMMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)");
    s3p.scaleSelf(2, 3, 4, 5, 6, 7);
    api.record.value("scaleSelf-3d-point", s3p.toJSON());

    // --- scale3dSelf() ---
    const sc3 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    api.record.identity("scale3dSelf-returns-self", sc3.scale3dSelf(2) === sc3, true);
    api.record.value("scale3dSelf-3d", sc3.toJSON());

    const sc3p = new window.DOMMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)");
    sc3p.scale3dSelf(2, 5, 6, 7);
    api.record.value("scale3dSelf-3d-point", sc3p.toJSON());

    // --- scaleNonUniformSelf() ---
    const sn2 = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("scaleNonUniformSelf-returns-self", sn2.scaleNonUniformSelf(2, 3) === sn2, true);
    api.record.value("scaleNonUniformSelf-2d", sn2.toJSON());

    const sn3 = new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
    sn3.scaleNonUniformSelf(2, 3);
    api.record.value("scaleNonUniformSelf-3d", sn3.toJSON());

    // --- rotateAxisAngleSelf() ---
    const base3d = "matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 1)";
    const r1 = new window.DOMMatrix(base3d);
    api.record.identity("rotateAxisAngleSelf-returns-self", r1.rotateAxisAngleSelf(1, 0, 0, 90) === r1, true);
    api.record.value("rotateAxisAngleSelf-x", r1.toJSON());

    const r2 = new window.DOMMatrix(base3d);
    r2.rotateAxisAngleSelf(0, 1, 0, 90);
    api.record.value("rotateAxisAngleSelf-y", r2.toJSON());

    const r3 = new window.DOMMatrix(base3d);
    r3.rotateAxisAngleSelf(0, 0, 1, 90);
    api.record.value("rotateAxisAngleSelf-z", r3.toJSON());

    const r4 = new window.DOMMatrix(base3d);
    r4.rotateAxisAngleSelf(1, 1, 1, 100);
    api.record.value("rotateAxisAngleSelf-111", r4.toJSON());

    const r5 = new window.DOMMatrix(base3d);
    r5.rotateAxisAngleSelf(2, 2, 2, 90);
    api.record.value("rotateAxisAngleSelf-222", r5.toJSON());

    const r6 = new window.DOMMatrix(base3d);
    r6.rotateAxisAngleSelf(0, 0, 1, 360 + 90);
    api.record.value("rotateAxisAngleSelf-450", r6.toJSON());

    const r7 = new window.DOMMatrix(base3d);
    r7.rotateAxisAngleSelf(0, 0, 1, -90);
    api.record.value("rotateAxisAngleSelf-neg90", r7.toJSON());

    // --- rotateSelf() ---
    const rot1 = new window.DOMMatrix(base3d);
    api.record.identity("rotateSelf-returns-self", rot1.rotateSelf(90) === rot1, true);
    api.record.value("rotateSelf-x", rot1.toJSON());

    const rot2 = new window.DOMMatrix(base3d);
    rot2.rotateSelf(90, 90);
    api.record.value("rotateSelf-xy", rot2.toJSON());

    const rot3 = new window.DOMMatrix(base3d);
    rot3.rotateSelf(90, 90, 90);
    api.record.value("rotateSelf-xyz", rot3.toJSON());

    // --- rotateFromVectorSelf() ---
    const rfv1 = new window.DOMMatrix(base3d);
    api.record.identity("rotateFromVectorSelf-returns-self", rfv1.rotateFromVectorSelf(90) === rfv1, true);
    api.record.value("rotateFromVectorSelf-x", rfv1.toJSON());

    const rfv2 = new window.DOMMatrix(base3d);
    rfv2.rotateFromVectorSelf(90, 90);
    api.record.value("rotateFromVectorSelf-xy", rfv2.toJSON());

    // --- skewXSelf() / skewYSelf() ---
    const skx = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("skewXSelf-returns-self", skx.skewXSelf(10) === skx, true);
    api.record.value("skewXSelf-2d", skx.toJSON());

    const skx3 = new window.DOMMatrix(base3d);
    skx3.skewXSelf(10);
    api.record.value("skewXSelf-3d", skx3.toJSON());

    const sky = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("skewYSelf-returns-self", sky.skewYSelf(10) === sky, true);
    api.record.value("skewYSelf-2d", sky.toJSON());

    const sky3 = new window.DOMMatrix(base3d);
    sky3.skewYSelf(10);
    api.record.value("skewYSelf-3d", sky3.toJSON());

    // --- flipXSelf() / flipYSelf() ---
    const fx = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("flipXSelf-returns-self", fx.flipXSelf() === fx, true);
    api.record.value("flipXSelf-2d", fx.toJSON());

    const fx3 = new window.DOMMatrix(base3d);
    fx3.flipXSelf();
    api.record.value("flipXSelf-3d", fx3.toJSON());

    const fy = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
    api.record.identity("flipYSelf-returns-self", fy.flipYSelf() === fy, true);
    api.record.value("flipYSelf-2d", fy.toJSON());

    const fy3 = new window.DOMMatrix(base3d);
    fy3.flipYSelf();
    api.record.value("flipYSelf-3d", fy3.toJSON());

    // --- invertSelf() ---
    const inv = new window.DOMMatrix("matrix(1, 2, 3, 4, 5, 6)");
    api.record.identity("invertSelf-returns-self", inv.invertSelf() === inv, true);
    api.record.value("invertSelf-2d", inv.toJSON());

    const inv3 = new window.DOMMatrix(base3d);
    inv3.invertSelf();
    api.record.value("invertSelf-3d", inv3.toJSON());

    // --- preMultiplySelf() ---
    const pre = new window.DOMMatrix().translate(3, 22);
    const other = new window.DOMMatrix().translateSelf(15, 45);
    api.record.value("preMultiply-before", pre.toString());
    api.record.value("preMultiply-other-before", other.toString());
    pre.preMultiplySelf(other);
    api.record.value("preMultiply-after", pre.toString());
    api.record.value("preMultiply-other-after", other.toString());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
