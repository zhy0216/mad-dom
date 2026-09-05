import { expect } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { Window } from "../../../index.js";
import { hasMaterializedNodeHandle } from "../../../js/facade/extensions/classes.js";

const native = createRequire(import.meta.url)(
  fileURLToPath(new URL("../../../build/mad-dom.node", import.meta.url)),
);

function runFullyLegacyProbe() {
  const documentPrototype = native.DocumentHandle.prototype;
  const nodePrototype = native.NodeHandle.prototype;
  const documentMethods = [
    "epochView",
    "attributeEpochView",
    "facadeEpochView",
    "facadeAttributeEpochView",
    "createElementToken",
    "createElementTokenBatch",
    "createElementTokenRange",
    "createTextToken",
    "materializeNodeToken",
    "nodeToken",
    "setAttributeToken",
    "setAttributeTokenLocal",
    "appendChildToken",
    "appendChildTokenLocal",
    "preorderTokenSnapshot",
    "countElementsByTagName",
    "countElementsByClassName",
  ];
  const nodeMethods = [
    "firstChildPair",
    "nextSiblingChunk",
    "idAttribute",
    "classAttribute",
    "idClassAttributes",
    "countElementsByTagName",
    "countElementsByClassName",
  ];
  const stampValues = {
    madDomToken: 42,
    madDomType: 1,
    madDomName: "poisoned",
    madDomNamespace: "http://www.w3.org/1999/xhtml",
  };
  const poisonedNames = [
    ...new Set([
      ...documentMethods,
      ...nodeMethods,
      ...Object.keys(stampValues),
    ]),
  ];
  const documentDescriptors = new Map(
    documentMethods.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(documentPrototype, name),
    ]),
  );
  const nodeDescriptors = new Map(
    nodeMethods.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(nodePrototype, name),
    ]),
  );
  const inheritedDescriptors = new Map(
    poisonedNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(Object.prototype, name),
    ]),
  );
  let inheritedCalls = 0;
  let window;
  try {
    for (const name of documentMethods) delete documentPrototype[name];
    for (const name of nodeMethods) delete nodePrototype[name];
    for (const name of poisonedNames) {
      const stampValue = stampValues[name];
      Object.defineProperty(
        Object.prototype,
        name,
        stampValue === undefined
          ? {
              configurable: true,
              value() {
                inheritedCalls += 1;
                throw new Error(`inherited ${name} must not be reached`);
              },
            }
          : {
              configurable: true,
              get() {
                inheritedCalls += 1;
                return stampValue;
              },
            },
      );
    }

    window = new Window();
    const document = window.document;
    const parent = document.createElement("div");
    const child = document.createElement("span");
    const text = document.createTextNode("legacy");
    expect(hasMaterializedNodeHandle(parent)).toBe(true);
    expect(hasMaterializedNodeHandle(child)).toBe(true);
    expect(hasMaterializedNodeHandle(text)).toBe(true);

    child.setAttribute("id", "legacy-child");
    child.setAttribute("class", "kept");
    child.appendChild(text);
    parent.appendChild(child);
    document.body.appendChild(parent);

    expect(parent.firstChild).toBe(child);
    expect(child.id).toBe("legacy-child");
    expect(child.className).toBe("kept");
    expect(child.textContent).toBe("legacy");
    expect(parent.getElementsByTagName("span").length).toBe(1);
    expect(document.getElementsByClassName("kept").length).toBe(1);
    expect(inheritedCalls).toBe(0);
  } finally {
    window?.destroy();
    for (const [name, descriptor] of documentDescriptors) {
      if (descriptor === undefined) delete documentPrototype[name];
      else Object.defineProperty(documentPrototype, name, descriptor);
    }
    for (const [name, descriptor] of nodeDescriptors) {
      if (descriptor === undefined) delete nodePrototype[name];
      else Object.defineProperty(nodePrototype, name, descriptor);
    }
    for (const [name, descriptor] of inheritedDescriptors) {
      if (descriptor === undefined) delete Object.prototype[name];
      else Object.defineProperty(Object.prototype, name, descriptor);
    }
  }
}

function runPartialWithoutMaterializationProbe() {
  const prototype = native.DocumentHandle.prototype;
  const materializeDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "materializeNodeToken",
  );
  const inheritedDescriptor = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "materializeNodeToken",
  );
  let inheritedCalls = 0;
  let window;
  try {
    delete prototype.materializeNodeToken;
    Object.defineProperty(Object.prototype, "materializeNodeToken", {
      configurable: true,
      value() {
        inheritedCalls += 1;
        throw new Error("inherited materialization must not be reached");
      },
    });

    window = new Window();
    const document = window.document;
    const created = document.createElement("div");
    expect(hasMaterializedNodeHandle(created)).toBe(true);
    document.body.innerHTML = "<section><span>partial</span></section>";
    const section = document.body.firstChild;
    expect(section.innerHTML).toBe("<span>partial</span>");
    expect(section.firstChild.textContent).toBe("partial");
    expect(inheritedCalls).toBe(0);
  } finally {
    window?.destroy();
    Object.defineProperty(
      prototype,
      "materializeNodeToken",
      materializeDescriptor,
    );
    if (inheritedDescriptor === undefined) {
      delete Object.prototype.materializeNodeToken;
    } else {
      Object.defineProperty(
        Object.prototype,
        "materializeNodeToken",
        inheritedDescriptor,
      );
    }
  }
}

const scenario = process.argv[2];
switch (scenario) {
  case "fully-legacy":
    runFullyLegacyProbe();
    break;
  case "partial-without-materialization":
    runPartialWithoutMaterializationProbe();
    break;
  default:
    throw new Error(`unknown lazy-token legacy binding probe scenario: ${scenario}`);
}

console.log(`PROBE ${JSON.stringify({ scenario, ok: true })}`);
