import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { DOMMatrix, DOMMatrixReadOnly } from "../../js/facade/extensions/dom-matrix.js";

// W2 differential-port facade tests for the DOMMatrix / DOMMatrixReadOnly
// geometry matrix surface that the W2 dom-matrix / dom-matrix-readonly
// differential scenarios exercise:
//
//   - the `window.DOMMatrix` / `window.DOMMatrixReadOnly` constructor
//     accessors with the baseline construction defaults;
//   - the string / array / dict / matrix constructors (2D and 3D), the
//     read-only getters (`a`–`f`, `m11`–`m44`), `is2D` / `isIdentity`, the
//     `toJSON` / `toString` / `toFloat32Array` / `toFloat64Array`
//     serializations and `transformPoint`;
//   - the non-mutating transforms on the read-only base and the mutating
//     `*Self` methods on `DOMMatrix` (each returning `this`);
//   - the absolute-length unit conversion and the relative-length constructor
//     rejection.
//
// These guard the facade behavior behind the differential scenarios; the
// scenarios themselves pin the happy-dom parity.

const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("W2 DOMMatrix window surface", () => {
  test("window.DOMMatrix / window.DOMMatrixReadOnly construct with baseline defaults", () => {
    const window = new Window();
    try {
      const identity = new window.DOMMatrix();
      expect(identity).toBeInstanceOf(window.DOMMatrix);
      expect(identity).toBeInstanceOf(DOMMatrix);
      expect(identity.a).toBe(1);
      expect(identity.d).toBe(1);
      expect(identity.m33).toBe(1);
      expect(identity.isIdentity).toBe(true);
      expect(identity.is2D).toBe(true);

      const readOnly = new window.DOMMatrixReadOnly();
      expect(readOnly).toBeInstanceOf(window.DOMMatrixReadOnly);
      expect(readOnly).toBeInstanceOf(DOMMatrixReadOnly);
      expect(readOnly.w).toBeUndefined();
      expect(readOnly.isIdentity).toBe(true);

      const matrix = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
      expect(matrix.a).toBe(10);
      expect(matrix.b).toBe(20);
      expect(matrix.c).toBe(30);
      expect(matrix.d).toBe(40);
      expect(matrix.e).toBe(50);
      expect(matrix.f).toBe(60);
      expect(matrix.is2D).toBe(true);
    } finally {
      window.destroy();
    }
  });

  test("constructors from matrix / dict / array / string (2D and 3D)", () => {
    const window = new Window();
    try {
      const fromMatrix = new window.DOMMatrix(new window.DOMMatrix("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)"));
      expect(fromMatrix.m11).toBe(1);
      expect(fromMatrix.m44).toBe(16);

      const fromObject = new window.DOMMatrix({ a: 10, b: 20, c: 30, d: 40, e: 50, f: 60 });
      expect(fromObject.m11).toBe(10);
      expect(fromObject.m44).toBe(1);

      const fromArray = new window.DOMMatrixReadOnly([1, 2, 3, 4, 5, 6]);
      expect(fromArray.m13).toBe(0);
      expect(fromArray.m44).toBe(1);
      expect(fromArray.a).toBe(1);
      expect(fromArray.f).toBe(6);

      const fromString3d = new window.DOMMatrixReadOnly("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
      expect(fromString3d.m11).toBe(1);
      expect(fromString3d.m21).toBe(5);
      expect(fromString3d.is2D).toBe(false);
    } finally {
      window.destroy();
    }
  });

  test("read-only getters and serializations", () => {
    const window = new Window();
    try {
      const matrix = new window.DOMMatrixReadOnly("matrix(10, 20, 30, 40, 50, 60)");

      expect(matrix.a).toBe(10);
      expect(matrix.b).toBe(20);
      expect(matrix.c).toBe(30);
      expect(matrix.d).toBe(40);
      expect(matrix.e).toBe(50);
      expect(matrix.f).toBe(60);
      expect(matrix.m11).toBe(10);
      expect(matrix.m12).toBe(20);
      expect(matrix.m21).toBe(30);
      expect(matrix.m22).toBe(40);
      expect(matrix.m41).toBe(50);
      expect(matrix.m42).toBe(60);

      expect(matrix.toString()).toBe("matrix(10, 20, 30, 40, 50, 60)");
      expect(matrix.toJSON().m44).toBe(1);
      expect(matrix.toJSON().is2D).toBe(true);

      const f32 = matrix.toFloat32Array();
      expect(f32).toBeInstanceOf(Float32Array);
      expect(f32).toHaveLength(16);
      expect(matrix.toFloat32Array(true)).toHaveLength(6);
      const f64 = matrix.toFloat64Array();
      expect(f64).toBeInstanceOf(Float64Array);
      expect(f64[0]).toBe(10);
    } finally {
      window.destroy();
    }
  });

  test("non-mutating transforms return new matrices", () => {
    const window = new Window();
    try {
      const base = new window.DOMMatrixReadOnly("matrix(10, 20, 30, 40, 50, 60)");

      const translated = base.translate(10, 20);
      expect(translated).not.toBe(base);
      expect(translated.e).toBe(750);
      expect(translated.f).toBe(1060);

      const scaled = base.scale(2, 3);
      expect(scaled.a).toBe(20);
      expect(scaled.d).toBe(120);

      const multiplied = base.multiply(new window.DOMMatrixReadOnly("matrix(2, 3, 4, 5, 6, 7)"));
      expect(multiplied.a).toBe(110);
      expect(multiplied.d).toBe(280);

      const rotated = new window.DOMMatrixReadOnly("matrix3d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 1)").rotateAxisAngle(1, 0, 0, 90);
      expect(rotated.m21).toBe(9);

      const point = base.transformPoint({ x: 10, y: 20 });
      expect(point.x).toBe(750);
      expect(point.y).toBe(1060);
      expect(point).toBeInstanceOf(window.DOMPoint);
    } finally {
      window.destroy();
    }
  });

  test("DOMMatrix mutating *Self methods return this", () => {
    const window = new Window();
    try {
      const matrix = new window.DOMMatrix("matrix(2, 3, 4, 5, 6, 7)");
      expect(matrix.multiplySelf(new window.DOMMatrix("matrix(2, 3, 4, 5, 6, 7)"))).toBe(matrix);
      expect(matrix.m11).toBe(16);
      expect(matrix.m12).toBe(21);

      const translated = new window.DOMMatrix("matrix(10, 20, 30, 40, 50, 60)");
      expect(translated.translateSelf(10, 20)).toBe(translated);
      expect(translated.e).toBe(750);

      const inverted = new window.DOMMatrix("matrix(1, 2, 3, 4, 5, 6)");
      expect(inverted.invertSelf()).toBe(inverted);
      expect(inverted.a).toBe(-2);
      expect(inverted.f).toBe(-2);
    } finally {
      window.destroy();
    }
  });

  test("relative-length perspective units are rejected", () => {
    const window = new Window();
    try {
      for (const unit of ["%", "vw", "vh", "vmin", "vmax", "em", "rem"]) {
        expect(() => new window.DOMMatrixReadOnly(`perspective(10${unit})`)).toThrow(
          "Lengths must be absolute, not relative",
        );
      }
      // Absolute units convert to the baseline factor scale.
      expect(new window.DOMMatrixReadOnly("perspective(10cm)").m34).toBeCloseTo(-0.00264681905286227);
    } finally {
      window.destroy();
    }
  });
});
