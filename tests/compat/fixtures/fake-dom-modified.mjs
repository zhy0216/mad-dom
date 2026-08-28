// Modified variant of fake-dom.mjs used to prove comparator sensitivity (T08).
// Deltas vs fake-dom.mjs, each targeting one ADR-0002 difference category:
//   1. extra export: FakeComment                       -> extra
//   2. FakeElement loses querySelector, gains attachShadow
//                                                      -> missing + extra member
//   3. FakeNode.nodeName accessor becomes a data method -> shape-mismatch
//   4. FAKE_PHASE_ENUM.capturing 1 -> 7                -> value-mismatch
//   5. FakeNode instance default label "node" -> "fake-node"
//                                                      -> value-mismatch
export const FAKE_VERSION = "1.2.3";

export const FAKE_PHASE_ENUM = {
  0: "none",
  1: "capturing",
  none: 0,
  capturing: 7,
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
    this.label = "fake-node";
  }

  nodeName() {
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

  attachShadow() {
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
    if (value === "__collector_must_not_call_setter__") {
      throw new Error("collector invoked a setter");
    }
  }
}

export class FakeComment extends FakeNode {
  constructor() {
    super();
    this.nodeType = 8;
  }
}
