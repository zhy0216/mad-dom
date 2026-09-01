// DOM matrix facade extension (W2 differential port: DOMMatrix /
// DOMMatrixReadOnly).
//
// Installs the WHATWG geometry matrix classes happy-dom exposes on the window —
// `DOMMatrixReadOnly` / `DOMMatrix` — plus the `window.DOMMatrix` /
// `window.DOMMatrixReadOnly` constructor accessors.
//
// These are pure data classes with **no DOM tree state**: the 16 homogeneous
// 4×4 components are stored as own instance data fields exactly like the
// happy-dom baseline (the baseline keeps them behind PropertySymbol slots on
// the same instances; the facade stores plain own properties so the instance
// shape probes of the vendored suite match). `DOMMatrix extends
// DOMMatrixReadOnly` adds the writable accessors and the mutating `*Self`
// methods; the non-mutating methods on the read-only base construct a fresh
// instance through `this.constructor` and apply the shared mutation kernels
// to the copy (mirroring the baseline).
//
// The matrix arithmetic follows the CSS Transforms spec the baseline
// implements: 4×4 row-major post-multiplication, rotation via the Rodrigues
// formula (rounded to 1e15 to match the baseline's numeric surface), string
// parsing of `matrix` / `matrix3d` / `perspective` / `translate` / `rotate` /
// `scale` / `skew` transform functions with absolute-length unit conversion.
//
// This module is picked up by the facade registry (extensions/index.js)
// purely by exporting `install(ctx)`.

import { Window } from "../window.js";
import { DOMPoint } from "./dom-geometry.js";

export const seam = Object.freeze({
  id: "facade/extensions/dom-matrix",
  owner: "W2",
  gate: "W2",
  status: "implemented",
});

const DEFAULT_MATRIX_JSON = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  m11: 1,
  m12: 0,
  m13: 0,
  m14: 0,
  m21: 0,
  m22: 1,
  m23: 0,
  m24: 0,
  m31: 0,
  m32: 0,
  m33: 1,
  m34: 0,
  m41: 0,
  m42: 0,
  m43: 0,
  m44: 1,
  is2D: true,
  isIdentity: true,
};

const TRANSFORM_PARAMETER_SPLIT_REGEXP = /[\s,]+/;

// Reads the 16 components of a matrix instance as a plain object.
function componentsOf(matrix) {
  return {
    m11: matrix._m11,
    m12: matrix._m12,
    m13: matrix._m13,
    m14: matrix._m14,
    m21: matrix._m21,
    m22: matrix._m22,
    m23: matrix._m23,
    m24: matrix._m24,
    m31: matrix._m31,
    m32: matrix._m32,
    m33: matrix._m33,
    m34: matrix._m34,
    m41: matrix._m41,
    m42: matrix._m42,
    m43: matrix._m43,
    m44: matrix._m44,
  };
}

function setComponents(matrix, components) {
  matrix._m11 = components.m11;
  matrix._m12 = components.m12;
  matrix._m13 = components.m13;
  matrix._m14 = components.m14;
  matrix._m21 = components.m21;
  matrix._m22 = components.m22;
  matrix._m23 = components.m23;
  matrix._m24 = components.m24;
  matrix._m31 = components.m31;
  matrix._m32 = components.m32;
  matrix._m33 = components.m33;
  matrix._m34 = components.m34;
  matrix._m41 = components.m41;
  matrix._m42 = components.m42;
  matrix._m43 = components.m43;
  matrix._m44 = components.m44;
}

// Returns the full 16-component object for a DOMMatrixReadOnly instance or a
// matrix-compatible plain object (normalizing the 2D a–f aliases first), the
// same normalization the baseline applies before multiplying.
function resolveMatrixInit(source) {
  let matrix = source;
  if (!(matrix instanceof DOMMatrixReadOnly)) {
    if (matrix?.m11 === undefined && matrix?.a !== undefined) {
      matrix = Object.assign({}, DEFAULT_MATRIX_JSON, matrix);
      matrix.m11 = matrix.a;
      matrix.m12 = matrix.b;
      matrix.m21 = matrix.c;
      matrix.m22 = matrix.d;
      matrix.m41 = matrix.e;
      matrix.m42 = matrix.f;
    } else {
      matrix = Object.assign({}, DEFAULT_MATRIX_JSON, matrix);
    }
  }
  return matrix;
}

/**
 * `DOMMatrixReadOnly` facade: the 16 homogeneous components with the read-only
 * m11–m44 / a–f accessors, `is2D` / `isIdentity`, the array/string/JSON
 * serializations and the non-mutating transform methods, matching the baseline
 * instance shape (own data fields for the numeric payload, prototype accessors
 * for the reads).
 */
export class DOMMatrixReadOnly {
  constructor(init) {
    this._m11 = 1;
    this._m12 = 0;
    this._m13 = 0;
    this._m14 = 0;
    this._m21 = 0;
    this._m22 = 1;
    this._m23 = 0;
    this._m24 = 0;
    this._m31 = 0;
    this._m32 = 0;
    this._m33 = 1;
    this._m34 = 0;
    this._m41 = 0;
    this._m42 = 0;
    this._m43 = 0;
    this._m44 = 1;
    if (init) {
      applySetMatrixValue(this, init);
    }
  }

  get a() {
    return this._m11;
  }

  get b() {
    return this._m12;
  }

  get c() {
    return this._m21;
  }

  get d() {
    return this._m22;
  }

  get e() {
    return this._m41;
  }

  get f() {
    return this._m42;
  }

  get m11() {
    return this._m11;
  }

  get m12() {
    return this._m12;
  }

  get m13() {
    return this._m13;
  }

  get m14() {
    return this._m14;
  }

  get m21() {
    return this._m21;
  }

  get m22() {
    return this._m22;
  }

  get m23() {
    return this._m23;
  }

  get m24() {
    return this._m24;
  }

  get m31() {
    return this._m31;
  }

  get m32() {
    return this._m32;
  }

  get m33() {
    return this._m33;
  }

  get m34() {
    return this._m34;
  }

  get m41() {
    return this._m41;
  }

  get m42() {
    return this._m42;
  }

  get m43() {
    return this._m43;
  }

  get m44() {
    return this._m44;
  }

  get isIdentity() {
    return (
      this._m11 === 1 &&
      this._m12 === 0 &&
      this._m13 === 0 &&
      this._m14 === 0 &&
      this._m21 === 0 &&
      this._m22 === 1 &&
      this._m23 === 0 &&
      this._m24 === 0 &&
      this._m31 === 0 &&
      this._m32 === 0 &&
      this._m33 === 1 &&
      this._m34 === 0 &&
      this._m41 === 0 &&
      this._m42 === 0 &&
      this._m43 === 0 &&
      this._m44 === 1
    );
  }

  get is2D() {
    return (
      this._m31 === 0 &&
      this._m32 === 0 &&
      this._m33 === 1 &&
      this._m34 === 0 &&
      this._m43 === 0 &&
      this._m44 === 1
    );
  }

  toFloat32Array(is2D) {
    return Float32Array.from(toArray(this, is2D));
  }

  toFloat64Array(is2D) {
    return Float64Array.from(toArray(this, is2D));
  }

  toString() {
    const is2D = this.is2D;
    const values = toArray(this, is2D).join(", ");
    const type = is2D ? "matrix" : "matrix3d";
    return `${type}(${values})`;
  }

  toJSON() {
    const { is2D, isIdentity } = this;
    return {
      m11: this._m11,
      m12: this._m12,
      m13: this._m13,
      m14: this._m14,
      m21: this._m21,
      m22: this._m22,
      m23: this._m23,
      m24: this._m24,
      m31: this._m31,
      m32: this._m32,
      m33: this._m33,
      m34: this._m34,
      m41: this._m41,
      m42: this._m42,
      m43: this._m43,
      m44: this._m44,
      a: this._m11,
      b: this._m12,
      c: this._m21,
      d: this._m22,
      e: this._m41,
      f: this._m42,
      is2D,
      isIdentity,
    };
  }

  multiply(secondMatrix) {
    const matrix = new this.constructor(this);
    if (secondMatrix) {
      multiplySelf(matrix, secondMatrix);
    }
    return matrix;
  }

  translate(x = 0, y = 0, z = 0) {
    const matrix = new this.constructor(this);
    translateSelf(matrix, x, y, z);
    return matrix;
  }

  scale(scaleX, scaleY, scaleZ = 1, originX = 0, originY = 0, originZ = 0) {
    const matrix = new this.constructor(this);
    scaleSelf(matrix, scaleX, scaleY, scaleZ, originX, originY, originZ);
    return matrix;
  }

  scale3d(scale = 1, originX = 0, originY = 0, originZ = 0) {
    const matrix = new this.constructor(this);
    scale3dSelf(matrix, scale, originX, originY, originZ);
    return matrix;
  }

  scaleNonUniform(scaleX = 1, scaleY = 1) {
    const matrix = new this.constructor(this);
    scaleNonUniformSelf(matrix, scaleX, scaleY);
    return matrix;
  }

  rotateAxisAngle(x = 0, y = 0, z = 0, angle = 0) {
    const matrix = new this.constructor(this);
    rotateAxisAngleSelf(matrix, x, y, z, angle);
    return matrix;
  }

  rotate(x = 0, y, z) {
    const matrix = new this.constructor(this);
    rotateSelf(matrix, x, y, z);
    return matrix;
  }

  rotateFromVector(x = 0, y = 0) {
    const matrix = new this.constructor(this);
    rotateFromVectorSelf(matrix, x, y);
    return matrix;
  }

  skewX(angle) {
    const matrix = new this.constructor(this);
    skewXSelf(matrix, angle);
    return matrix;
  }

  skewY(angle) {
    const matrix = new this.constructor(this);
    skewYSelf(matrix, angle);
    return matrix;
  }

  flipX() {
    const matrix = new this.constructor(this);
    flipXSelf(matrix);
    return matrix;
  }

  flipY() {
    const matrix = new this.constructor(this);
    flipYSelf(matrix);
    return matrix;
  }

  inverse() {
    const matrix = new this.constructor(this);
    invertSelf(matrix);
    return matrix;
  }

  transformPoint(domPoint) {
    const xPoint = domPoint?.x ?? 0;
    const yPoint = domPoint?.y ?? 0;
    const zPoint = domPoint?.z ?? 0;
    const wPoint = domPoint?.w ?? 1;
    const x =
      this._m11 * xPoint +
      this._m21 * yPoint +
      this._m31 * zPoint +
      this._m41 * wPoint;
    const y =
      this._m12 * xPoint +
      this._m22 * yPoint +
      this._m32 * zPoint +
      this._m42 * wPoint;
    const z =
      this._m13 * xPoint +
      this._m23 * yPoint +
      this._m33 * zPoint +
      this._m43 * wPoint;
    const w =
      this._m14 * xPoint +
      this._m24 * yPoint +
      this._m34 * zPoint +
      this._m44 * wPoint;
    return new DOMPoint(x, y, z, w);
  }

  static fromMatrix(matrix) {
    if (!(matrix instanceof DOMMatrixReadOnly)) {
      if (matrix?.m11 === undefined && matrix?.a !== undefined) {
        matrix = Object.assign({}, DEFAULT_MATRIX_JSON, matrix);
        matrix.m11 = matrix.a;
        matrix.m12 = matrix.b;
        matrix.m21 = matrix.c;
        matrix.m22 = matrix.d;
        matrix.m41 = matrix.e;
        matrix.m42 = matrix.f;
      } else {
        matrix = Object.assign({}, DEFAULT_MATRIX_JSON, matrix);
      }
    }
    return this.fromArray([
      matrix.m11,
      matrix.m12,
      matrix.m13,
      matrix.m14,
      matrix.m21,
      matrix.m22,
      matrix.m23,
      matrix.m24,
      matrix.m31,
      matrix.m32,
      matrix.m33,
      matrix.m34,
      matrix.m41,
      matrix.m42,
      matrix.m43,
      matrix.m44,
    ]);
  }

  static fromFloat32Array(array) {
    return this.fromArray(array);
  }

  static fromFloat64Array(array) {
    return this.fromArray(array);
  }

  static fromArray(array) {
    if (
      !(array instanceof Float64Array || array instanceof Float32Array || Array.isArray(array)) ||
      (array.length !== 6 && array.length !== 16)
    ) {
      throw TypeError(
        `Failed to execute 'fromArray' on '${this.name}': '${String(array)}' is not a compatible array.`,
      );
    }
    const matrix = new this();
    if (array.length === 16) {
      const [m11, m12, m13, m14, m21, m22, m23, m24, m31, m32, m33, m34, m41, m42, m43, m44] =
        array;
      matrix._m11 = m11;
      matrix._m12 = m12;
      matrix._m13 = m13;
      matrix._m14 = m14;
      matrix._m21 = m21;
      matrix._m22 = m22;
      matrix._m23 = m23;
      matrix._m24 = m24;
      matrix._m31 = m31;
      matrix._m32 = m32;
      matrix._m33 = m33;
      matrix._m34 = m34;
      matrix._m41 = m41;
      matrix._m42 = m42;
      matrix._m43 = m43;
      matrix._m44 = m44;
    } else {
      const [m11, m12, m21, m22, m41, m42] = array;
      matrix._m11 = m11;
      matrix._m12 = m12;
      matrix._m21 = m21;
      matrix._m22 = m22;
      matrix._m41 = m41;
      matrix._m42 = m42;
    }
    return matrix;
  }

  static fromString(source) {
    if (typeof source !== "string") {
      throw TypeError(
        `Failed to execute 'setMatrixValue' on '${this.name}': Expected '${String(source)}' to be a string.`,
      );
    }
    const domMatrix = new this();
    const regexp = /([a-zA-Z0-9]+)\(([^)]+)\)/gm;
    let match;
    while ((match = regexp.exec(source))) {
      const name = match[1];
      const parameters = match[2].split(TRANSFORM_PARAMETER_SPLIT_REGEXP);
      for (let i = 0, max = parameters.length; i < max; i++) {
        parameters[i] = this.getLength(parameters[i]);
      }
      const [x, y, z, a] = parameters;
      switch (name) {
        case "perspective":
          if (!isNaN(x) && x !== 0 && y === undefined && z === undefined) {
            domMatrix._m34 = -1 / x;
          }
          break;
        case "translate":
          if (!isNaN(x) && z === undefined) {
            translateSelf(domMatrix, x, y || 0, 0);
          }
          break;
        case "translate3d":
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            translateSelf(domMatrix, x, y, z);
          }
          break;
        case "translateX":
          if (!isNaN(x) && y === undefined && z === undefined) {
            translateSelf(domMatrix, x);
          }
          break;
        case "translateY":
          if (!isNaN(x) && y === undefined && z === undefined) {
            translateSelf(domMatrix, 0, x);
          }
          break;
        case "translateZ":
          if (!isNaN(x) && y === undefined && z === undefined) {
            translateSelf(domMatrix, 0, 0, x);
          }
          break;
        case "matrix":
        case "matrix3d":
          if (parameters.length === 6 || parameters.length === 16) {
            setComponents(domMatrix, componentsOf(this.fromArray(parameters)));
          }
          break;
        case "rotate":
        case "rotateZ":
          if (!isNaN(x) && y === undefined && z === undefined) {
            rotateSelf(domMatrix, 0, 0, x);
          }
          break;
        case "rotateX":
          if (!isNaN(x) && y === undefined && z === undefined) {
            rotateSelf(domMatrix, x, 0, 0);
          }
          break;
        case "rotateY":
          if (!isNaN(x) && y === undefined && z === undefined) {
            rotateSelf(domMatrix, 0, x, 0);
          }
          break;
        case "rotate3d":
          if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(a)) {
            rotateAxisAngleSelf(domMatrix, x, y, z, a);
          }
          break;
        case "scale":
          if (!isNaN(x) && x !== 1 && z === undefined) {
            scaleSelf(domMatrix, x, isNaN(y) ? x : y);
          }
          break;
        case "scale3d":
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            scaleSelf(domMatrix, x, y, z);
          }
          break;
        case "scaleX":
          if (!isNaN(x) && y === undefined && z === undefined) {
            scaleSelf(domMatrix, x, 1, 1);
          }
          break;
        case "scaleY":
          if (!isNaN(x) && y === undefined && z === undefined) {
            scaleSelf(domMatrix, 1, x, 1);
          }
          break;
        case "scaleZ":
          if (!isNaN(x) && y === undefined && z === undefined) {
            scaleSelf(domMatrix, 1, 1, x);
          }
          break;
        case "skew":
          if (!isNaN(x)) {
            skewXSelf(domMatrix, x);
          }
          if (!isNaN(y)) {
            skewYSelf(domMatrix, y);
          }
          break;
        case "skewX":
          if (!isNaN(x) && y === undefined) {
            skewXSelf(domMatrix, x);
          }
          break;
        case "skewY":
          if (!isNaN(x) && y === undefined) {
            skewYSelf(domMatrix, x);
          }
          break;
        default:
          throw TypeError(
            `Failed to execute 'setMatrixValue' on '${this.name}': Unknown transform function '${match[1]}'.`,
          );
      }
    }
    return domMatrix;
  }

  static getLength(length) {
    const value = parseFloat(length);
    const unit = length.replace(value.toString(), "");
    switch (unit) {
      case "rem":
      case "em":
      case "vw":
      case "vh":
      case "%":
      case "vmin":
      case "vmax":
        throw new SyntaxError(`Failed to construct '${this.name}': Lengths must be absolute, not relative`);
      case "rad":
        return value * (180 / Math.PI);
      case "turn":
        return value * 360;
      case "px":
        return value;
      case "cm":
        return value * 37.7812;
      case "mm":
        return value * 3.7781;
      case "in":
        return value * 96;
      case "pt":
        return value * 1.3281;
      case "pc":
        return value * 16;
      case "Q":
        return value * 0.945;
      default:
        return value;
    }
  }
}

/**
 * `DOMMatrix` facade: `DOMMatrixReadOnly` plus the writable a–f / m11–m44
 * accessors and the mutating `*Self` methods (each returns `this`).
 */
export class DOMMatrix extends DOMMatrixReadOnly {
  get a() {
    return this._m11;
  }

  set a(value) {
    this._m11 = value;
  }

  get b() {
    return this._m12;
  }

  set b(value) {
    this._m12 = value;
  }

  get c() {
    return this._m21;
  }

  set c(value) {
    this._m21 = value;
  }

  get d() {
    return this._m22;
  }

  set d(value) {
    this._m22 = value;
  }

  get e() {
    return this._m41;
  }

  set e(value) {
    this._m41 = value;
  }

  get f() {
    return this._m42;
  }

  set f(value) {
    this._m42 = value;
  }

  get m11() {
    return this._m11;
  }

  set m11(value) {
    this._m11 = value;
  }

  get m12() {
    return this._m12;
  }

  set m12(value) {
    this._m12 = value;
  }

  get m13() {
    return this._m13;
  }

  set m13(value) {
    this._m13 = value;
  }

  get m14() {
    return this._m14;
  }

  set m14(value) {
    this._m14 = value;
  }

  get m21() {
    return this._m21;
  }

  set m21(value) {
    this._m21 = value;
  }

  get m22() {
    return this._m22;
  }

  set m22(value) {
    this._m22 = value;
  }

  get m23() {
    return this._m23;
  }

  set m23(value) {
    this._m23 = value;
  }

  get m24() {
    return this._m24;
  }

  set m24(value) {
    this._m24 = value;
  }

  get m31() {
    return this._m31;
  }

  set m31(value) {
    this._m31 = value;
  }

  get m32() {
    return this._m32;
  }

  set m32(value) {
    this._m32 = value;
  }

  get m33() {
    return this._m33;
  }

  set m33(value) {
    this._m33 = value;
  }

  get m34() {
    return this._m34;
  }

  set m34(value) {
    this._m34 = value;
  }

  get m41() {
    return this._m41;
  }

  set m41(value) {
    this._m41 = value;
  }

  get m42() {
    return this._m42;
  }

  set m42(value) {
    this._m42 = value;
  }

  get m43() {
    return this._m43;
  }

  set m43(value) {
    this._m43 = value;
  }

  get m44() {
    return this._m44;
  }

  set m44(value) {
    this._m44 = value;
  }

  setMatrixValue(source) {
    applySetMatrixValue(this, source);
    return this;
  }

  multiplySelf(secondMatrix) {
    multiplySelf(this, secondMatrix);
    return this;
  }

  translateSelf(x = 0, y = 0, z = 0) {
    translateSelf(this, x, y, z);
    return this;
  }

  scaleSelf(scaleX, scaleY, scaleZ = 1, originX = 0, originY = 0, originZ = 0) {
    scaleSelf(this, scaleX, scaleY, scaleZ, originX, originY, originZ);
    return this;
  }

  scale3dSelf(scale = 1, originX = 0, originY = 0, originZ = 0) {
    scale3dSelf(this, scale, originX, originY, originZ);
    return this;
  }

  scaleNonUniformSelf(scaleX = 1, scaleY = 1) {
    scaleNonUniformSelf(this, scaleX, scaleY);
    return this;
  }

  rotateAxisAngleSelf(x = 0, y = 0, z = 0, angle = 0) {
    rotateAxisAngleSelf(this, x, y, z, angle);
    return this;
  }

  rotateSelf(x = 0, y, z) {
    rotateSelf(this, x, y, z);
    return this;
  }

  rotateFromVectorSelf(x = 0, y = 0) {
    rotateFromVectorSelf(this, x, y);
    return this;
  }

  skewXSelf(angle) {
    skewXSelf(this, angle);
    return this;
  }

  skewYSelf(angle) {
    skewYSelf(this, angle);
    return this;
  }

  flipXSelf() {
    flipXSelf(this);
    return this;
  }

  flipYSelf() {
    flipYSelf(this);
    return this;
  }

  invertSelf() {
    invertSelf(this);
    return this;
  }

  preMultiplySelf(otherMatrix) {
    multiplySelf(this, otherMatrix);
    return this;
  }
}

// --- Shared matrix kernels (the 4×4 arithmetic) -----------------------------

// Replaces the matrix payload from a string, array, typed-array or
// matrix-compatible object init (the constructor and `setMatrixValue` entry).
function applySetMatrixValue(matrix, source) {
  let init = null;
  if (typeof source === "string" && source.length && source !== "none") {
    init = matrix.constructor.fromString(source);
  } else if (
    Array.isArray(source) ||
    source instanceof Float64Array ||
    source instanceof Float32Array
  ) {
    init = matrix.constructor.fromArray(source);
  } else if (typeof source === "object") {
    init = matrix.constructor.fromMatrix(source);
  } else {
    return;
  }
  setComponents(matrix, componentsOf(init));
}

function toArray(matrix, is2D = false) {
  if (is2D) {
    return [matrix._m11, matrix._m12, matrix._m21, matrix._m22, matrix._m41, matrix._m42];
  }
  return [
    matrix._m11,
    matrix._m12,
    matrix._m13,
    matrix._m14,
    matrix._m21,
    matrix._m22,
    matrix._m23,
    matrix._m24,
    matrix._m31,
    matrix._m32,
    matrix._m33,
    matrix._m34,
    matrix._m41,
    matrix._m42,
    matrix._m43,
    matrix._m44,
  ];
}

function multiplySelf(target, matrixCompatibleObject) {
  if (!matrixCompatibleObject) {
    return;
  }
  const matrix = resolveMatrixInit(matrixCompatibleObject);
  const m11 =
    target._m11 * matrix.m11 +
    target._m21 * matrix.m12 +
    target._m31 * matrix.m13 +
    target._m41 * matrix.m14;
  const m21 =
    target._m11 * matrix.m21 +
    target._m21 * matrix.m22 +
    target._m31 * matrix.m23 +
    target._m41 * matrix.m24;
  const m31 =
    target._m11 * matrix.m31 +
    target._m21 * matrix.m32 +
    target._m31 * matrix.m33 +
    target._m41 * matrix.m34;
  const m41 =
    target._m11 * matrix.m41 +
    target._m21 * matrix.m42 +
    target._m31 * matrix.m43 +
    target._m41 * matrix.m44;
  const m12 =
    target._m12 * matrix.m11 +
    target._m22 * matrix.m12 +
    target._m32 * matrix.m13 +
    target._m42 * matrix.m14;
  const m22 =
    target._m12 * matrix.m21 +
    target._m22 * matrix.m22 +
    target._m32 * matrix.m23 +
    target._m42 * matrix.m24;
  const m32 =
    target._m12 * matrix.m31 +
    target._m22 * matrix.m32 +
    target._m32 * matrix.m33 +
    target._m42 * matrix.m34;
  const m42 =
    target._m12 * matrix.m41 +
    target._m22 * matrix.m42 +
    target._m32 * matrix.m43 +
    target._m42 * matrix.m44;
  const m13 =
    target._m13 * matrix.m11 +
    target._m23 * matrix.m12 +
    target._m33 * matrix.m13 +
    target._m43 * matrix.m14;
  const m23 =
    target._m13 * matrix.m21 +
    target._m23 * matrix.m22 +
    target._m33 * matrix.m23 +
    target._m43 * matrix.m24;
  const m33 =
    target._m13 * matrix.m31 +
    target._m23 * matrix.m32 +
    target._m33 * matrix.m33 +
    target._m43 * matrix.m34;
  const m43 =
    target._m13 * matrix.m41 +
    target._m23 * matrix.m42 +
    target._m33 * matrix.m43 +
    target._m43 * matrix.m44;
  const m14 =
    target._m14 * matrix.m11 +
    target._m24 * matrix.m12 +
    target._m34 * matrix.m13 +
    target._m44 * matrix.m14;
  const m24 =
    target._m14 * matrix.m21 +
    target._m24 * matrix.m22 +
    target._m34 * matrix.m23 +
    target._m44 * matrix.m24;
  const m34 =
    target._m14 * matrix.m31 +
    target._m24 * matrix.m32 +
    target._m34 * matrix.m33 +
    target._m44 * matrix.m34;
  const m44 =
    target._m14 * matrix.m41 +
    target._m24 * matrix.m42 +
    target._m34 * matrix.m43 +
    target._m44 * matrix.m44;
  target._m11 = m11;
  target._m12 = m12;
  target._m13 = m13;
  target._m14 = m14;
  target._m21 = m21;
  target._m22 = m22;
  target._m23 = m23;
  target._m24 = m24;
  target._m31 = m31;
  target._m32 = m32;
  target._m33 = m33;
  target._m34 = m34;
  target._m41 = m41;
  target._m42 = m42;
  target._m43 = m43;
  target._m44 = m44;
}

function translateSelf(target, x = 0, y = 0, z = 0) {
  const translationMatrix = target.constructor.fromArray([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
  multiplySelf(target, translationMatrix);
}

function scaleSelf(target, scaleX, scaleY, scaleZ = 1, originX = 0, originY = 0, originZ = 0) {
  scaleX = scaleX === undefined ? 1 : Number(scaleX);
  scaleY = scaleY === undefined ? scaleX : Number(scaleY);
  if (originX !== 0 || originY !== 0 || originZ !== 0) {
    translateSelf(target, originX, originY, originZ);
  }
  if (scaleX !== 1 || scaleY !== 1 || scaleZ !== 1) {
    multiplySelf(
      target,
      target.constructor.fromArray([
        scaleX, 0, 0, 0,
        0, scaleY, 0, 0,
        0, 0, scaleZ, 0,
        0, 0, 0, 1,
      ]),
    );
  }
  if (originX !== 0 || originY !== 0 || originZ !== 0) {
    translateSelf(target, -originX, -originY, -originZ);
  }
}

function scale3dSelf(target, scale = 1, originX = 0, originY = 0, originZ = 0) {
  if (originX !== 0 || originY !== 0 || originZ !== 0) {
    translateSelf(target, originX, originY, originZ);
  }
  if (scale !== 1) {
    multiplySelf(
      target,
      target.constructor.fromArray([
        scale, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, scale, 0,
        0, 0, 0, 1,
      ]),
    );
  }
  if (originX !== 0 || originY !== 0 || originZ !== 0) {
    translateSelf(target, -originX, -originY, -originZ);
  }
}

function scaleNonUniformSelf(target, scaleX = 1, scaleY = 1) {
  if (scaleX === 1 && scaleY === 1) {
    return;
  }
  multiplySelf(
    target,
    target.constructor.fromArray([
      scaleX, 0, 0, 0,
      0, scaleY, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  );
}

function roundTo15(value) {
  return Math.round(value * 1e15) / 1e15;
}

function rotateAxisAngleSelf(target, x = 0, y = 0, z = 0, angle = 0) {
  x = Number(x);
  y = Number(y);
  z = Number(z);
  angle = Number(angle);
  if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(angle)) {
    throw new TypeError(
      "Failed to execute 'rotateAxisAngleSelf' on 'DOMMatrix': The arguments must be numbers.",
    );
  }
  const length = Math.hypot(x, y, z);
  if (length === 0) {
    return;
  }
  if (length !== 1) {
    x /= length;
    y /= length;
    z /= length;
  }
  const alpha = -((angle * Math.PI) / 360);
  const round = roundTo15;
  const sc = Math.sin(alpha) * Math.cos(alpha);
  const sq = Math.sin(alpha) * Math.sin(alpha);
  const m11 = round(1 - 2 * (y * y + z * z) * sq);
  const m12 = round(2 * (x * y * sq + z * sc));
  const m13 = round(2 * (x * z * sq - y * sc));
  const m21 = round(2 * (x * y * sq - z * sc));
  const m22 = round(1 - 2 * (x * x + z * z) * sq);
  const m23 = round(2 * (y * z * sq + x * sc));
  const m31 = round(2 * (x * z * sq + y * sc));
  const m32 = round(2 * (y * z * sq - x * sc));
  const m33 = round(1 - 2 * (x * x + y * y) * sq);
  multiplySelf(
    target,
    target.constructor.fromArray([
      m11, m21, m31, 0,
      m12, m22, m32, 0,
      m13, m23, m33, 0,
      0, 0, 0, 1,
    ]),
  );
}

function rotateSelf(target, x = 0, y, z) {
  if (y === undefined && z === undefined) {
    z = x;
    x = 0;
    y = 0;
  }
  if (y === undefined) {
    y = 0;
  }
  if (z === undefined) {
    z = 0;
  }
  x = Number(x);
  y = Number(y);
  z = Number(z);
  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    throw new TypeError("Failed to execute 'rotateSelf' on 'DOMMatrix': The arguments must be numbers.");
  }
  if (z !== 0) {
    rotateAxisAngleSelf(target, 0, 0, 1, z);
  }
  if (y !== 0) {
    rotateAxisAngleSelf(target, 0, 1, 0, y);
  }
  if (x !== 0) {
    rotateAxisAngleSelf(target, 1, 0, 0, x);
  }
}

function rotateFromVectorSelf(target, x = 0, y = 0) {
  if (x === 0 && y === 0) {
    return;
  }
  rotateSelf(target, (Math.atan2(y, x) * 180) / Math.PI);
}

function skewXSelf(target, angle) {
  const matrix = Object.assign({}, DEFAULT_MATRIX_JSON);
  const value = Math.tan((angle * Math.PI) / 180);
  matrix.m21 = value;
  matrix.c = value;
  multiplySelf(target, matrix);
}

function skewYSelf(target, angle) {
  const matrix = Object.assign({}, DEFAULT_MATRIX_JSON);
  const value = Math.tan((angle * Math.PI) / 180);
  matrix.m12 = value;
  matrix.b = value;
  multiplySelf(target, matrix);
}

function flipXSelf(target) {
  multiplySelf(
    target,
    target.constructor.fromArray([
      -1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  );
}

function flipYSelf(target) {
  multiplySelf(
    target,
    target.constructor.fromArray([
      1, 0, 0, 0,
      0, -1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  );
}

function invertSelf(target) {
  const m11 =
    target._m22 * target._m33 * target._m44 -
    target._m22 * target._m34 * target._m43 -
    target._m32 * target._m23 * target._m44 +
    target._m32 * target._m24 * target._m43 +
    target._m42 * target._m23 * target._m34 -
    target._m42 * target._m24 * target._m33;
  const m12 =
    -target._m12 * target._m33 * target._m44 +
    target._m12 * target._m34 * target._m43 +
    target._m32 * target._m13 * target._m44 -
    target._m32 * target._m14 * target._m43 -
    target._m42 * target._m13 * target._m34 +
    target._m42 * target._m14 * target._m33;
  const m13 =
    target._m12 * target._m23 * target._m44 -
    target._m12 * target._m24 * target._m43 -
    target._m22 * target._m13 * target._m44 +
    target._m22 * target._m14 * target._m43 +
    target._m42 * target._m13 * target._m24 -
    target._m42 * target._m14 * target._m23;
  const m14 =
    -target._m12 * target._m23 * target._m34 +
    target._m12 * target._m24 * target._m33 +
    target._m22 * target._m13 * target._m34 -
    target._m22 * target._m14 * target._m33 -
    target._m32 * target._m13 * target._m24 +
    target._m32 * target._m14 * target._m23;
  const det =
    target._m11 * m11 + target._m21 * m12 + target._m31 * m13 + target._m41 * m14;
  if (det === 0) {
    target._m11 = NaN;
    target._m12 = NaN;
    target._m13 = NaN;
    target._m14 = NaN;
    target._m21 = NaN;
    target._m22 = NaN;
    target._m23 = NaN;
    target._m24 = NaN;
    target._m31 = NaN;
    target._m32 = NaN;
    target._m33 = NaN;
    target._m34 = NaN;
    target._m41 = NaN;
    target._m42 = NaN;
    target._m43 = NaN;
    target._m44 = NaN;
    return;
  }
  const m21 =
    -target._m21 * target._m33 * target._m44 +
    target._m21 * target._m34 * target._m43 +
    target._m31 * target._m23 * target._m44 -
    target._m31 * target._m24 * target._m43 -
    target._m41 * target._m23 * target._m34 +
    target._m41 * target._m24 * target._m33;
  const m22 =
    target._m11 * target._m33 * target._m44 -
    target._m11 * target._m34 * target._m43 -
    target._m31 * target._m13 * target._m44 +
    target._m31 * target._m14 * target._m43 +
    target._m41 * target._m13 * target._m34 -
    target._m41 * target._m14 * target._m33;
  const m23 =
    -target._m11 * target._m23 * target._m44 +
    target._m11 * target._m24 * target._m43 +
    target._m21 * target._m13 * target._m44 -
    target._m21 * target._m14 * target._m43 -
    target._m41 * target._m13 * target._m24 +
    target._m41 * target._m14 * target._m23;
  const m24 =
    target._m11 * target._m23 * target._m34 -
    target._m11 * target._m24 * target._m33 -
    target._m21 * target._m13 * target._m34 +
    target._m21 * target._m14 * target._m33 +
    target._m31 * target._m13 * target._m24 -
    target._m31 * target._m14 * target._m23;
  const m31 =
    target._m21 * target._m32 * target._m44 -
    target._m21 * target._m34 * target._m42 -
    target._m31 * target._m22 * target._m44 +
    target._m31 * target._m24 * target._m42 +
    target._m41 * target._m22 * target._m34 -
    target._m41 * target._m24 * target._m32;
  const m32 =
    -target._m11 * target._m32 * target._m44 +
    target._m11 * target._m34 * target._m42 +
    target._m31 * target._m12 * target._m44 -
    target._m31 * target._m14 * target._m42 -
    target._m41 * target._m12 * target._m34 +
    target._m41 * target._m14 * target._m32;
  const m33 =
    target._m11 * target._m22 * target._m44 -
    target._m11 * target._m24 * target._m42 -
    target._m21 * target._m12 * target._m44 +
    target._m21 * target._m14 * target._m42 +
    target._m41 * target._m12 * target._m24 -
    target._m41 * target._m14 * target._m22;
  const m34 =
    -target._m11 * target._m22 * target._m34 +
    target._m11 * target._m24 * target._m32 +
    target._m21 * target._m12 * target._m34 -
    target._m21 * target._m14 * target._m32 -
    target._m31 * target._m12 * target._m24 +
    target._m31 * target._m14 * target._m22;
  const m41 =
    -target._m21 * target._m32 * target._m43 +
    target._m21 * target._m33 * target._m42 +
    target._m31 * target._m22 * target._m43 -
    target._m31 * target._m23 * target._m42 -
    target._m41 * target._m22 * target._m33 +
    target._m41 * target._m23 * target._m32;
  const m42 =
    target._m11 * target._m32 * target._m43 -
    target._m11 * target._m33 * target._m42 -
    target._m31 * target._m12 * target._m43 +
    target._m31 * target._m13 * target._m42 +
    target._m41 * target._m12 * target._m33 -
    target._m41 * target._m13 * target._m32;
  const m43 =
    -target._m11 * target._m22 * target._m43 +
    target._m11 * target._m23 * target._m42 +
    target._m21 * target._m12 * target._m43 -
    target._m21 * target._m13 * target._m42 -
    target._m41 * target._m12 * target._m23 +
    target._m41 * target._m13 * target._m22;
  const m44 =
    target._m11 * target._m22 * target._m33 -
    target._m11 * target._m23 * target._m32 -
    target._m21 * target._m12 * target._m33 +
    target._m21 * target._m13 * target._m32 +
    target._m31 * target._m12 * target._m23 -
    target._m31 * target._m13 * target._m22;
  target._m11 = m11 / det || 0;
  target._m12 = m12 / det || 0;
  target._m13 = m13 / det || 0;
  target._m14 = m14 / det || 0;
  target._m21 = m21 / det || 0;
  target._m22 = m22 / det || 0;
  target._m23 = m23 / det || 0;
  target._m24 = m24 / det || 0;
  target._m31 = m31 / det || 0;
  target._m32 = m32 / det || 0;
  target._m33 = m33 / det || 0;
  target._m34 = m34 / det || 0;
  target._m41 = m41 / det || 0;
  target._m42 = m42 / det || 0;
  target._m43 = m43 / det || 0;
  target._m44 = m44 / det || 0;
}

// --- install -----------------------------------------------------------------

/**
 * Installs the matrix window accessors (`window.DOMMatrix` /
 * `window.DOMMatrixReadOnly`), the happy-dom baseline window members.
 */
export function install(ctx) {
  ctx.defineAccessor(Window.prototype, "DOMMatrix", function getDOMMatrix() {
    return DOMMatrix;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "DOMMatrixReadOnly", function getDOMMatrixReadOnly() {
    return DOMMatrixReadOnly;
  }, undefined);
}
