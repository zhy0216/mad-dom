#!/usr/bin/env bun
// Public API collector for the happy-dom compatibility snapshot (T08).
//
// Runs in an ISOLATED subprocess spawned by generate-snapshot.js so that the
// inspected module is loaded in a clean process, separate from the generator
// and from any test runner. It only ever imports the module entry given on
// the command line (for the committed snapshot that is the public specifier
// "happy-dom"); it never imports happy-dom/lib/** or any other deep module.
//
// Usage:
//   bun compat/public-api/collector.js <module-specifier-or-path> <output.json>
//
// Output: a deterministic JSON document describing every string-keyed export
// of the module. All object keys are sorted; nothing time- or host-dependent
// is recorded. The process exits via process.exit(0) after writing so that
// any timers started by inspected constructors cannot keep it alive.
//
// Normalization / exclusion rules (see also compat/public-api/README.md):
//   1. Function bodies and native code are never serialized; functions are
//      represented by existence + typeof + arity (length) + name.
//   2. Getter/setter functions are never invoked. Accessor properties are
//      recorded as descriptor shapes only (hasGetter / hasSetter booleans).
//   3. Property descriptors are reduced to their shape: writable /
//      enumerable / configurable + whether get/set exist + the typeof of the
//      value for data properties. Values are read without calling anything.
//   4. Only "publicly observable" surfaces are recorded: the module
//      namespace's string-keyed exports, own string-keyed properties of
//      constructors and their prototypes, and (for classes that construct
//      with zero arguments) own properties of a fresh instance.
//   5. Symbol-keyed properties are INFORMATIONAL (ADR-0002 section 2): they
//      are recorded as String(symbol) -> descriptor shape, never as values,
//      and are excluded from hard compatibility gates by the comparator.
//   6. Values are serialized only when structurally safe: primitives (with
//      tagged NaN / +-Infinity / -0 / bigint / undefined), plain objects and
//      dense arrays up to a depth/size limit, without touching accessors.
//      Class instances, Dates, Maps, Sets, host objects etc. are excluded.
//   7. Cyclic or otherwise unstable values are excluded, never truncated
//      mid-structure, so the output always stays deterministic.
import { writeFileSync } from "node:fs";

const COLLECTOR_SCHEMA = "mad-dom-public-api-collector/1";

const MAX_SERIALIZATION_DEPTH = 4;
const MAX_ARRAY_LENGTH = 256;

main();

function main() {
  const [specifier, outputPath] = process.argv.slice(2);
  if (!specifier || !outputPath) {
    fail("usage: bun collector.js <module-specifier-or-path> <output.json>");
  }

  import(specifier)
    .then((module) => {
      const document = collect(module, specifier);
      writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
      // Diagnostics only: callers read the payload from the output file, so
      // console noise from inspected constructors cannot corrupt anything.
      process.stdout.write(`collector: wrote ${outputPath}\n`);
      process.exit(0);
    })
    .catch((error) => fail(error?.stack ?? String(error)));
}

function fail(message) {
  process.stderr.write(`collector: ${message}\n`);
  process.exit(1);
}

function collect(module, specifier) {
  const exportNames = ownStringKeys(module);
  const exports = {};

  for (const name of exportNames) {
    const descriptor = Object.getOwnPropertyDescriptor(module, name);
    try {
      exports[name] = describeExport(name, descriptor);
    } catch (error) {
      exports[name] = {
        category: "introspection-error",
        errorName: error?.name ?? "Unknown",
        typeOf: safeTypeOf(descriptor?.value),
      };
    }
  }

  return {
    schema: COLLECTOR_SCHEMA,
    target: { specifier },
    exports: sortObjectKeys(exports),
  };
}

function describeExport(name, descriptor) {
  const value = descriptor.value;
  const typeOf = typeof value;
  const entry = {
    typeOf,
    enumerable: descriptor.enumerable === true,
    category: classify(value, name),
  };

  if (entry.category === "class") {
    return { ...entry, ...describeClass(value) };
  }
  if (entry.category === "function") {
    return { ...entry, ...describeFunction(value) };
  }
  if (typeOf === "object" && value !== null) {
    return { ...entry, ...describeObjectValue(value, name, entry.category) };
  }
  // primitive or symbol export
  const serialized = serializeValue(value);
  return { ...entry, value: serialized.ok ? serialized.value : null };
}

function classify(value, name) {
  const typeOf = typeof value;
  if (typeOf === "function") {
    return isClass(value) ? "class" : "function";
  }
  if (typeOf !== "object" || value === null) {
    return "primitive";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  const keys = ownStringKeys(value);
  const allValuesAreSymbols =
    keys.length > 0 &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && typeof descriptor.value === "symbol";
    });
  if (allValuesAreSymbols) {
    return "symbol-object";
  }
  if (hasOnlyPrimitiveDataValues(value)) {
    return name.toLowerCase().endsWith("enum") ? "enum" : "constant-object";
  }
  return "object";
}

// Classes are discriminated from plain constructor functions without calling
// anything: only class declarations get a non-writable, non-configurable own
// "prototype" whose constructor points back at the function itself.
function isClass(value) {
  if (typeof value !== "function") {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "prototype");
  return (
    descriptor !== undefined &&
    descriptor.writable === false &&
    descriptor.configurable === false &&
    descriptor.value !== null &&
    typeof descriptor.value === "object" &&
    descriptor.value.constructor === value
  );
}

function hasOnlyPrimitiveDataValues(value) {
  for (const key of ownStringKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      return false;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      return false;
    }
    const typeOf = typeof descriptor.value;
    const primitive =
      descriptor.value === null ||
      typeOf === "string" ||
      typeOf === "number" ||
      typeOf === "boolean" ||
      typeOf === "undefined" ||
      typeOf === "bigint";
    if (!primitive) {
      return false;
    }
  }
  return true;
}

function describeClass(constructor) {
  const prototype = constructor.prototype ?? null;
  return {
    name: functionName(constructor),
    length: constructor.length,
    prototypeChain: prototypeChainNames(prototype),
    constructorChain: constructorChainNames(constructor),
    staticMembers: ownStringKeys(constructor),
    staticDescriptors: descriptorShapes(constructor),
    staticSymbols: symbolShapes(constructor),
    prototypeMembers: prototype === null ? [] : ownStringKeys(prototype),
    prototypeDescriptors: prototype === null ? {} : descriptorShapes(prototype),
    prototypeSymbols: prototype === null ? {} : symbolShapes(prototype),
    construction: describeConstruction(constructor),
  };
}

function describeFunction(fn) {
  return {
    name: functionName(fn),
    length: fn.length,
    constructorChain: constructorChainNames(fn),
    staticMembers: ownStringKeys(fn),
    staticDescriptors: descriptorShapes(fn),
    staticSymbols: symbolShapes(fn),
  };
}

function describeObjectValue(value, name, category) {
  const base = {
    frozen: Object.isFrozen(value),
    sealed: Object.isSealed(value),
    extensible: Object.isExtensible(value),
  };

  if (category === "enum" || category === "constant-object") {
    const values = {};
    for (const key of ownStringKeys(value)) {
      const serialized = serializeValue(Object.getOwnPropertyDescriptor(value, key)?.value);
      values[key] = serialized.ok ? serialized.value : "~unserializable";
    }
    return {
      ...base,
      keys: ownStringKeys(value),
      values: sortObjectKeys(values),
      symbols: symbolShapes(value),
    };
  }

  if (category === "symbol-object") {
    const symbolValues = [];
    for (const key of ownStringKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof descriptor?.value === "symbol") {
        symbolValues.push(String(descriptor.value));
      }
    }
    return {
      ...base,
      keys: ownStringKeys(value),
      symbolValues: symbolValues.sort(),
      symbols: symbolShapes(value),
    };
  }

  if (category === "array") {
    const items = [];
    for (const item of value) {
      const serialized = serializeValue(item);
      items.push(serialized.ok ? serialized.value : "~unserializable");
    }
    return { ...base, length: value.length, items };
  }

  return {
    ...base,
    members: ownStringKeys(value),
    memberDescriptors: descriptorShapes(value),
    symbols: symbolShapes(value),
    _classificationNote: `unclassified object export ${name}`,
  };
}

// Attempts zero-argument construction. Classes that throw are recorded as
// not-constructible with only the error name (never the message, which may
// embed host paths). Successful instances contribute own keys, descriptor
// shapes, symbol shapes and serializable default values.
function describeConstruction(constructor) {
  let instance;
  try {
    instance = Reflect.construct(constructor, []);
  } catch (error) {
    return {
      strategy: "no-args",
      status: "not-constructible",
      errorName: error?.name ?? "Unknown",
    };
  }

  let instanceOwnKeys;
  let instanceDescriptors;
  let instanceSymbols;
  let instanceDefaults;
  let instanceNonSerializableKeys;
  try {
    instanceOwnKeys = ownStringKeys(instance);
    instanceDescriptors = descriptorShapes(instance);
    instanceSymbols = symbolShapes(instance);
    const defaults = {};
    const nonSerializable = [];
    for (const key of instanceOwnKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(instance, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
        continue;
      }
      const serialized = serializeValue(descriptor.value);
      if (serialized.ok) {
        defaults[key] = serialized.value;
      } else {
        nonSerializable.push(key);
      }
    }
    instanceDefaults = sortObjectKeys(defaults);
    instanceNonSerializableKeys = nonSerializable.sort();
  } catch (error) {
    return {
      strategy: "no-args",
      status: "introspection-error",
      errorName: error?.name ?? "Unknown",
    };
  }

  return {
    strategy: "no-args",
    status: "constructible",
    instanceOwnKeys,
    instanceDescriptors,
    instanceSymbols,
    instanceDefaults,
    instanceNonSerializableKeys,
  };
}

function descriptorShapes(object) {
  const shapes = {};
  for (const key of ownStringKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    shapes[key] = descriptor === undefined ? null : descriptorShape(descriptor);
  }
  return sortObjectKeys(shapes);
}

function descriptorShape(descriptor) {
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    return {
      kind: "accessor",
      enumerable: descriptor.enumerable === true,
      configurable: descriptor.configurable === true,
      hasGetter: typeof descriptor.get === "function",
      hasSetter: typeof descriptor.set === "function",
    };
  }
  return {
    kind: "data",
    writable: descriptor.writable === true,
    enumerable: descriptor.enumerable === true,
    configurable: descriptor.configurable === true,
    valueType: safeTypeOf(descriptor.value),
  };
}

// Informational: symbol keys are recorded as String(symbol) -> descriptor
// shape. Values behind symbol keys are never read.
function symbolShapes(object) {
  const shapes = {};
  const seen = new Map();
  for (const symbol of Object.getOwnPropertySymbols(object)) {
    const base = String(symbol);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const key = count === 0 ? base : `${base} #${count + 1}`;
    const descriptor = Object.getOwnPropertyDescriptor(object, symbol);
    shapes[key] = descriptor === undefined ? null : descriptorShape(descriptor);
  }
  return sortObjectKeys(shapes);
}

function ownStringKeys(object) {
  return Object.getOwnPropertyNames(object).sort();
}

function prototypeChainNames(start) {
  const names = [];
  let current = start;
  while (current !== null && current !== undefined) {
    names.push(prototypeName(current));
    current = Object.getPrototypeOf(current);
  }
  return names;
}

function constructorChainNames(start) {
  return prototypeChainNames(start);
}

function prototypeName(object) {
  // A function in the chain (the class itself, or Function.prototype's
  // neighbors) must be named by its own name; using constructor.name here
  // would return "Function" for every class because constructors inherit
  // .constructor from Function.prototype.
  if (typeof object === "function") {
    const ownName = object.name;
    if (typeof ownName === "string" && ownName !== "") {
      return ownName;
    }
  }
  const name = object?.constructor?.name;
  if (typeof name === "string" && name !== "") {
    return name;
  }
  if (object === Function.prototype) {
    return "Function.prototype";
  }
  if (object === Object.prototype) {
    return "Object.prototype";
  }
  return "[anonymous prototype]";
}

function functionName(fn) {
  const name = fn?.name;
  return typeof name === "string" ? name : "";
}

function safeTypeOf(value) {
  return typeof value;
}

function sortObjectKeys(object) {
  const result = {};
  for (const key of Object.keys(object).sort()) {
    result[key] = object[key];
  }
  return result;
}

function serializeValue(value, depth = MAX_SERIALIZATION_DEPTH) {
  if (value === null) {
    return { ok: true, value: null };
  }
  const typeOf = typeof value;
  if (typeOf === "string" || typeOf === "boolean") {
    return { ok: true, value };
  }
  if (typeOf === "number") {
    if (Number.isNaN(value)) {
      return { ok: true, value: "~NaN" };
    }
    if (value === 0) {
      return { ok: true, value: Object.is(value, -0) ? "~negZero" : 0 };
    }
    if (value === Number.POSITIVE_INFINITY) {
      return { ok: true, value: "~Infinity" };
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { ok: true, value: "~-Infinity" };
    }
    return { ok: true, value };
  }
  if (typeOf === "undefined") {
    return { ok: true, value: "~undefined" };
  }
  if (typeOf === "bigint") {
    return { ok: true, value: `~bigint:${value.toString()}` };
  }
  if (depth <= 0) {
    return { ok: false };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      return { ok: false };
    }
    const items = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        return { ok: false };
      }
      const serialized = serializeValue(value[index], depth - 1);
      if (!serialized.ok) {
        return { ok: false };
      }
      items.push(serialized.value);
    }
    return { ok: true, value: items };
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const key of ownStringKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
        return { ok: false };
      }
      const serialized = serializeValue(descriptor.value, depth - 1);
      if (!serialized.ok) {
        return { ok: false };
      }
      result[key] = serialized.value;
    }
    return { ok: true, value: sortObjectKeys(result) };
  }
  return { ok: false };
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
