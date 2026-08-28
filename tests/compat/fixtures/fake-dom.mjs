// Deterministic fake DOM module used as a collector/comparator fixture (T08).
// It mimics the observable shapes of a small DOM-like public API (classes with
// inheritance, accessors, statics, symbols, enums, constants, a plain
// function and a primitive) so the snapshot pipeline can be tested end to end
// without importing happy-dom. Everything here must stay deterministic.

export const FAKE_VERSION = "1.2.3";

export const FAKE_PHASE_ENUM = {
  0: "none",
  1: "capturing",
  none: 0,
  capturing: 1,
};

export const FAKE_RULES = Object.freeze({
  STYLE_RULE: 1,
  IMPORT_RULE: 3,
});

export const FakeSymbolRegistry = {
  node: Symbol("fake.node"),
  element: Symbol("fake.element"),
};

export function fakeCreateNode(name) {
  return { name };
}

export class FakeNode {
  static NODE_TYPE = 1;
  static [Symbol.for("fake.node.tag")] = "FakeNode";

  constructor() {
    this.nodeType = 1;
    this.label = "node";
  }

  get nodeName() {
    return "#node";
  }

  append() {
    return 0;
  }

  remove() {}
}

export class FakeElement extends FakeNode {
  static kind = "element";

  constructor() {
    super();
    this.nodeType = 2;
    this.tagName = "";
  }

  querySelector() {
    return null;
  }
}

export class FakeBrokenElement extends FakeNode {
  constructor() {
    super();
    throw new TypeError("FakeBrokenElement requires a document");
  }
}

export class FakeWindowLike {
  constructor() {
    this.name = "";
    this.closed = false;
    this.negZero = -0;
    this.ratio = Number.NaN;
    this.size = { width: 1024, height: 768 };
    this.internalToken = Symbol("fake.internal");
  }

  get location() {
    return "about:blank";
  }

  set location(value) {
    // no-op setter: collectors must never invoke it
    if (value === "__collector_must_not_call_setter__") {
      throw new Error("collector invoked a setter");
    }
  }
}
