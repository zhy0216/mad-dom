// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/DOMTokenList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: every assertion goes through the live
// `element.classList` public surface (`new window.Window()` +
// `document.createElement`). The only upstream block that constructed an
// internal `new DOMTokenList(illegalConstructorSymbol, element,
// 'rel', [...])` instance (the `supports()` test, with the internal
// illegal-constructor symbol) is migrated to the public `link.relList`
// surface, whose hardcoded supported-token list (`stylesheet` /
// `modulepreload` / `preload`) yields the same `supports()` results. The
// `classList.supports('...')` no-declared-token-set case is also covered
// (always `false`, matching the baseline).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "dom-token-list";
export const description = "real differential: DOMTokenList add/length/value/item/replace/remove/contains/toggle/iteration/supports";
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
    const document = window.document;
    const element = document.createElement("div");
    const classList = element.classList;

    // --- add() ---
    classList.add("class1");
    api.record.value("add-1", element.className);
    classList.add("class2");
    classList.add("class3");
    api.record.value("add-3", element.className);
    classList.add("class2");
    classList.add("class3");
    api.record.value("add-dup", element.className);
    classList.remove("class1");
    classList.remove("class2");
    classList.remove("class3");
    classList.add("class1", "class2", "class3");
    api.record.value("add-multi", element.className);

    // --- get length / indexed access / set value ---
    classList.remove("class1");
    classList.remove("class2");
    classList.remove("class3");
    api.record.value("length-0", classList.length);
    classList.add("class1");
    api.record.value("length-1", classList.length);
    api.record.value("index-0", classList[0]);
    classList.add("class2");
    api.record.value("length-2", classList.length);
    api.record.value("index-1", classList[1]);
    classList.value = "otherClass";
    api.record.value("length-value-set", classList.length);
    api.record.value("index-0-value-set", classList[0]);
    api.record.value("index-1-value-set", classList[1]);
    classList.value = "";
    api.record.value("length-empty", classList.length);
    api.record.value("index-0-empty", classList[0]);

    // --- get/set value ---
    classList.add("class1");
    classList.add("class2");
    classList.add("class3");
    api.record.value("value-get", classList.value);
    classList.add("class1");
    classList.add("class2");
    api.record.value("value-get-dup", classList.value);
    classList.value = "class1 class2 class3";
    api.record.value("value-set-className", element.className);
    api.record.value("value-set-index-2", classList[2]);

    // --- item() ---
    classList.remove("class1");
    classList.remove("class2");
    classList.remove("class3");
    classList.add("class1");
    api.record.value("item-0", classList.item(0));
    api.record.value("item-string-0", classList.item("0"));
    api.record.value("item-string-a", classList.item("a"));
    api.record.value("item-out-of-range", classList.item(3));

    // --- replace() ---
    classList.add("class2");
    classList.add("class3");
    api.record.value("replace-result", classList.replace("class1", "class4"));
    api.record.value("replace-className", element.className);
    api.record.value("replace-missing", classList.replace("nope", "x"));

    // --- remove() / contains() ---
    classList.remove("class4");
    api.record.value("remove-className", element.className);
    classList.add("class1");
    api.record.value("contains-true", classList.contains("class1"));
    classList.add("class2");
    api.record.value("contains-both", classList.contains("class1") && classList.contains("class2"));
    api.record.value("contains-false", classList.contains("class3"));

    // --- toggle() ---
    classList.remove("class1");
    classList.remove("class2");
    api.record.value("toggle-add", classList.toggle("class1"));
    api.record.value("toggle-add-className", element.className);
    classList.add("class1");
    api.record.value("toggle-force-true", classList.toggle("class1", true));
    api.record.value("toggle-force-true-2", classList.toggle("class2", true));
    api.record.value("toggle-force-true-className", element.className);
    classList.remove("class1");
    classList.remove("class2");
    classList.add("class1");
    api.record.value("toggle-remove", classList.toggle("class1"));
    api.record.value("toggle-remove-className", element.className);
    classList.add("class1");
    api.record.value("toggle-force-false", classList.toggle("class1", false));
    api.record.value("toggle-force-false-2", classList.toggle("class2", false));
    api.record.value("toggle-force-false-className", element.className);

    // --- values() / iterator / entries() / keys() ---
    element.className = "class1 class2 class3";
    api.record.value("values-iterator-type", typeof classList.values()[Symbol.iterator]);
    api.record.value("values-array", Array.from(classList.values()));
    api.record.value("iterator-type", typeof classList[Symbol.iterator]);
    api.record.value("iterator-array", Array.from(classList));
    api.record.value("entries-array", Array.from(classList.entries()));
    api.record.value("keys-array", Array.from(classList.keys()));

    // --- forEach() ---
    const defaultThisArgs = [];
    classList.forEach(function () {
      defaultThisArgs.push(this);
    });
    api.record.value("forEach-default-this-window", defaultThisArgs[0] === window);
    api.record.value("forEach-default-length", defaultThisArgs.length);
    const thisArg = {};
    const forEachItems = [];
    classList.forEach(function (token, index, parent) {
      this.__parent = parent;
      forEachItems.push([token, index]);
    }, thisArg);
    api.record.value("forEach-explicit-this", thisArg.__parent === classList);
    api.record.value("forEach-items", forEachItems);

    // --- toString() ---
    element.className = "class1 class2  class3";
    api.record.value("toString", element.classList.toString());
    element.className = " class1  class2\nclass3 ";
    api.record.value("whitespace-values", Array.from(element.classList.values()));
    api.record.value("whitespace-toString", element.classList.toString());

    // --- supports() ---
    api.record.value("supports-classList", classList.supports("foo"));
    const link = document.createElement("link");
    link.rel = "stylesheet";
    api.record.value("link-supports-stylesheet", link.relList.supports("stylesheet"));
    api.record.value("link-supports-modulepreload", link.relList.supports("modulepreload"));
    api.record.value("link-supports-preload", link.relList.supports("preload"));
    api.record.value("link-supports-unsupported", link.relList.supports("unsupported"));
    const anchor = document.createElement("a");
    anchor.rel = "stylesheet";
    api.record.value("anchor-supports-stylesheet", anchor.relList.supports("stylesheet"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
