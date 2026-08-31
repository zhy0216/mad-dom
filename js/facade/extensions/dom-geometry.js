// DOM geometry facade extension (T07 hdunit event/dom/window/browser wave).
//
// Installs the WHATWG geometry classes happy-dom exposes on the window —
// `DOMPoint` / `DOMPointReadOnly` / `DOMRect` / `DOMRectReadOnly` — plus the
// `window.DOMPoint` / `window.DOMPointReadOnly` / `window.DOMRect` /
// `window.DOMRectReadOnly` constructor accessors.
//
// These are pure immutable (or simple mutable) data classes with **no DOM tree
// state**: their numeric payload is stored as own instance data fields exactly
// like the happy-dom baseline (the baseline keeps it behind PropertySymbol
// slots on the same instances; the facade stores plain own properties so the
// instance shape probes of the vendored suite match). The class hierarchy
// follows the baseline (`DOMPoint extends DOMPointReadOnly`, `DOMRect extends
// DOMRectReadOnly`), so `instanceof window.DOMPoint` holds for the object
// `DOMPoint.matrixTransform()` returns (it constructs through
// `this.constructor`, mirroring the baseline).
//
// `DOMPointReadOnly.matrixTransform()` evaluates the full 4×4 homogeneous
// transform (`x' = m11·x + m21·y + m31·z + m41·w`, …) from a `TDOMMatrixInit`
// dict with the WebIDL 2D aliases (`a/m11`, `b/m12`, `c/m21`, `d/m22`,
// `e/m41`, `f/m42`) resolved first — the baseline creates a DOMMatrixReadOnly
// from the init and applies `transformPoint`; the two are observationally
// identical for the init shapes the vendored tests exercise.
//
// # No window per-class instances
//
// The baseline mints one class per window (`WindowContextClassExtender`); the
// facade shares the module-level classes across windows because the vendored
// tests only ever construct through `window.<Name>` and compare
// `instanceof window.<Name>`, which holds with shared classes. This keeps the
// facade state-free (ADR-0001 §6): no per-window DOM state anywhere.
//
// This module is picked up by the facade registry (extensions/index.js)
// purely by exporting `install(ctx)`.

import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/dom-geometry",
  owner: "T07",
  gate: "T07",
  status: "implemented",
});

// --- DOMPoint ----------------------------------------------------------------

/**
 * `DOMPointReadOnly` facade: x/y/z/w reads, `toJSON`, `fromPoint` and
 * `matrixTransform`, matching the baseline instance shape (own data fields for
 * the numeric payload, prototype accessors for the reads).
 */
export class DOMPointReadOnly {
  constructor(x = null, y = null, z = null, w = null) {
    this._x = x !== undefined && x !== null ? Number(x) : 0;
    this._y = y !== undefined && y !== null ? Number(y) : 0;
    this._z = z !== undefined && z !== null ? Number(z) : 0;
    this._w = w !== undefined && w !== null ? Number(w) : 1;
  }

  get x() {
    return this._x;
  }

  get y() {
    return this._y;
  }

  get z() {
    return this._z;
  }

  get w() {
    return this._w;
  }

  toJSON() {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }

  static fromPoint(otherPoint = null) {
    if (!otherPoint) {
      return new this();
    }
    return new this(
      otherPoint.x ?? null,
      otherPoint.y ?? null,
      otherPoint.z ?? null,
      otherPoint.w ?? null,
    );
  }

  matrixTransform(init = null) {
    const m = toMatrixComponents(init);
    const x = this.x * m.m11 + this.y * m.m21 + this.z * m.m31 + this.w * m.m41;
    const y = this.x * m.m12 + this.y * m.m22 + this.z * m.m32 + this.w * m.m42;
    const z = this.x * m.m13 + this.y * m.m23 + this.z * m.m33 + this.w * m.m43;
    const w = this.x * m.m14 + this.y * m.m24 + this.z * m.m34 + this.w * m.m44;
    return new this.constructor(x, y, z, w);
  }
}

/**
 * `DOMPoint` facade: `DOMPointReadOnly` plus the writable x/y/z/w accessors.
 */
export class DOMPoint extends DOMPointReadOnly {
  set x(value) {
    this._x = Number(value);
  }

  get x() {
    return this._x;
  }

  set y(value) {
    this._y = Number(value);
  }

  get y() {
    return this._y;
  }

  set z(value) {
    this._z = Number(value);
  }

  get z() {
    return this._z;
  }

  set w(value) {
    this._w = Number(value);
  }

  get w() {
    return this._w;
  }
}

// --- DOMRect -----------------------------------------------------------------

/**
 * `DOMRectReadOnly` facade: x/y/width/height reads plus the derived
 * top/right/bottom/left and `toJSON` / `fromRect`, matching the baseline
 * (top/left are min, right/bottom are max over the negative-size case).
 */
export class DOMRectReadOnly {
  constructor(x = null, y = null, width = null, height = null) {
    this._x = x !== undefined && x !== null ? Number(x) : 0;
    this._y = y !== undefined && y !== null ? Number(y) : 0;
    this._width = width !== undefined && width !== null ? Number(width) : 0;
    this._height = height !== undefined && height !== null ? Number(height) : 0;
  }

  get x() {
    return this._x;
  }

  get y() {
    return this._y;
  }

  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  get top() {
    return Math.min(this._y, this._y + this._height);
  }

  get right() {
    return Math.max(this._x, this._x + this._width);
  }

  get bottom() {
    return Math.max(this._y, this._y + this._height);
  }

  get left() {
    return Math.min(this._x, this._x + this._width);
  }

  toJSON() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      top: this.top,
      right: this.right,
      bottom: this.bottom,
      left: this.left,
    };
  }

  static fromRect(other = null) {
    const init = other ?? {};
    return new DOMRectReadOnly(init.x, init.y, init.width, init.height);
  }
}

/**
 * `DOMRect` facade: `DOMRectReadOnly` plus the writable x/y/width/height
 * accessors and the `fromRect` factory.
 */
export class DOMRect extends DOMRectReadOnly {
  set x(value) {
    this._x = Number(value);
  }

  get x() {
    return this._x;
  }

  set y(value) {
    this._y = Number(value);
  }

  get y() {
    return this._y;
  }

  set width(value) {
    this._width = Number(value);
  }

  get width() {
    return this._width;
  }

  set height(value) {
    this._height = Number(value);
  }

  get height() {
    return this._height;
  }

  static fromRect(other = null) {
    const init = other ?? {};
    return new DOMRect(init.x, init.y, init.width, init.height);
  }
}

// --- TDOMMatrixInit → 4×4 components -----------------------------------------

/**
 * Resolves a `TDOMMatrixInit` dict (with the WebIDL 2D aliases) into the full
 * 4×4 homogeneous components the baseline DOMMatrixReadOnly exposes. The 2D
 * aliases (`a/e/m11…`) win over the indexed components, matching the baseline
 * dict-first resolution.
 */
function toMatrixComponents(init) {
  const dict = init ?? {};
  const a = dict.a;
  const b = dict.b;
  const c = dict.c;
  const d = dict.d;
  const e = dict.e;
  const f = dict.f;
  return {
    m11: dict.m11 ?? (a !== undefined ? Number(a) : 1),
    m12: dict.m12 ?? (b !== undefined ? Number(b) : 0),
    m13: dict.m13 ?? 0,
    m14: dict.m14 ?? 0,
    m21: dict.m21 ?? (c !== undefined ? Number(c) : 0),
    m22: dict.m22 ?? (d !== undefined ? Number(d) : 1),
    m23: dict.m23 ?? 0,
    m24: dict.m24 ?? 0,
    m31: dict.m31 ?? 0,
    m32: dict.m32 ?? 0,
    m33: dict.m33 ?? 1,
    m34: dict.m34 ?? 0,
    m41: dict.m41 ?? (e !== undefined ? Number(e) : 0),
    m42: dict.m42 ?? (f !== undefined ? Number(f) : 0),
    m43: dict.m43 ?? 0,
    m44: dict.m44 ?? 1,
  };
}

// --- install -----------------------------------------------------------------

/**
 * Installs the geometry window accessors (`window.DOMPoint` etc.), the
 * happy-dom baseline window members.
 */
export function install(ctx) {
  ctx.defineAccessor(Window.prototype, "DOMPoint", function getDOMPoint() {
    return DOMPoint;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "DOMPointReadOnly", function getDOMPointReadOnly() {
    return DOMPointReadOnly;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "DOMRect", function getDOMRect() {
    return DOMRect;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "DOMRectReadOnly", function getDOMRectReadOnly() {
    return DOMRectReadOnly;
  }, undefined);
}
