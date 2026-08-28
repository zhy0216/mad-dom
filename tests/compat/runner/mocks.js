// Controlled mock DOM implementations for the self-test targets (T10).
//
// The self-test pair runs each scenario against "mock-pass" and "mock-fail".
// Both expose the SAME mini-DOM surface; mock-fail carries five seeded,
// deterministic implementation bugs so the self-test can prove the runner
// detects and localizes differences precisely:
//
//   1. emitPipeline() delivers the "build"/"finish" events in swapped order
//      (difference lands on events[1].name / events[2].name);
//   2. throwSync() does NOT throw synchronously — it returns a rejected
//      promise with the same name/message, so the throw PHASE a scenario
//      observes changes from sync-throw to promise-rejection;
//   3. throwAsync() rejects with name "MockFailureError" and a different
//      message (differences land on errors[n].name and errors[n].message);
//   4. createText() uppercases the character data (difference lands on
//      snapshots.<key>.children[n].data and on outerHTML);
//   5. setAttribute("id", ...) is silently dropped (difference lands on
//      snapshots.<key>.attributes.id and on outerHTML).
//
// Everything else behaves identically on both variants, which is what lets
// the two self-test pass scenarios produce byte-equal normalized records.

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const STABLE_SEQUENCE = [
  { name: "init", detail: { step: 1 } },
  { name: "mount", detail: { step: 2 } },
  { name: "ready", detail: { step: 3 } },
];

const PIPELINE_SEQUENCE = {
  pass: ["prepare", "build", "finish"],
  fail: ["prepare", "finish", "build"],
};

class MockElement {
  constructor(tagName, { dropId } = {}) {
    this.nodeType = 1;
    this.nodeName = String(tagName).toUpperCase();
    this.namespaceURI = XHTML_NAMESPACE;
    this.childNodes = [];
    this.#dropId = dropId === true;
    this.#attributes = [];
    Object.defineProperty(this, "tagLower", {
      get() {
        return this.nodeName.toLowerCase();
      },
      enumerable: true,
      configurable: true,
    });
  }

  #dropId;

  #attributes;

  get attributes() {
    const list = this.#attributes;
    const view = { length: list.length };
    list.forEach((attribute, index) => {
      view[index] = attribute;
    });
    view.item = (index) => list[index] ?? null;
    return view;
  }

  setAttribute(name, value) {
    // Seeded bug 5: the failing variant silently drops the "id" attribute.
    if (this.#dropId && name === "id") return;
    const existing = this.#attributes.find((attribute) => attribute.name === name);
    if (existing !== undefined) {
      existing.value = String(value);
      return;
    }
    this.#attributes.push({ name: String(name), value: String(value) });
  }

  getAttribute(name) {
    return this.#attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }

  get outerHTML() {
    const tag = this.nodeName.toLowerCase();
    const attributes = this.#attributes.map((attribute) => ` ${attribute.name}="${attribute.value}"`).join("");
    const children = this.childNodes.map((child) => child.outerHTML ?? child.data ?? "").join("");
    return `<${tag}${attributes}>${children}</${tag}>`;
  }
}

class MockText {
  constructor(data) {
    this.nodeType = 3;
    this.nodeName = "#text";
    this.namespaceURI = null;
    this.data = String(data);
    this.childNodes = [];
  }
}

// Deterministic primitive/structured sample shared verbatim by both variants.
function describePrimitives() {
  function sample(alpha, beta) {
    return [alpha, beta];
  }
  return {
    integer: 42,
    float: 1.5,
    nan: Number.NaN,
    infinity: Number.POSITIVE_INFINITY,
    "negative-infinity": Number.NEGATIVE_INFINITY,
    "negative-zero": -0,
    string: "mad-dom",
    "empty-string": "",
    "boolean-true": true,
    "boolean-false": false,
    "null-value": null,
    "undefined-value": undefined,
    symbol: Symbol("mock-token"),
    bigint: 9007199254740993n,
    function: sample,
    array: [1, "two", { three: 3 }],
    object: { b: 2, a: 1, nested: { y: null, x: true } },
  };
}

export function createMockDom(variant) {
  const fail = variant === "fail";
  return {
    describePrimitives,
    emitSequence(onEvent) {
      for (const { name, detail } of STABLE_SEQUENCE) onEvent(name, detail);
    },
    emitPipeline(onEvent) {
      // Seeded bug 1: order differs per variant.
      for (const name of PIPELINE_SEQUENCE[variant]) onEvent(name, { pipeline: true });
    },
    createElement(tagName) {
      return new MockElement(tagName, { dropId: fail });
    },
    createText(data) {
      // Seeded bug 4: the failing variant uppercases character data.
      return new MockText(fail ? String(data).toUpperCase() : String(data));
    },
    throwSync() {
      const error = new Error("mock failure (sync): controlled divergence");
      if (!fail) throw error;
      // Seeded bug 2: identical error, but delivered as a rejection instead
      // of a synchronous throw (the observed throw phase changes).
      return Promise.reject(error);
    },
    async throwAsync() {
      if (!fail) {
        throw new Error("mock failure (async): controlled divergence");
      }
      // Seeded bug 3: different error name and message.
      const error = new Error("mock failure (async): divergent payload");
      error.name = "MockFailureError";
      throw error;
    },
  };
}
