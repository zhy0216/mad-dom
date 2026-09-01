// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGStringList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGStringList(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<g>` `requiredExtensions`
// (a real SVGStringList backed by the `requiredExtensions` attribute). The
// read-only animVal-style error paths are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-string-list";
export const description = "real differential: SVGStringList g requiredExtensions index/length/iterator + clear/initialize/getItem/insertItemBefore/replaceItem/removeItem/appendItem";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElementNS(SVG_NS, "g");
    element.setAttribute("requiredExtensions", "key1 key2 key3");
    const list = element.requiredExtensions;
    api.record.value("type", list instanceof window.SVGStringList);
    api.record.value("length", list.length);
    api.record.value("numberOfItems", list.numberOfItems);
    api.record.value("index0", list[0]);
    api.record.value("index1", list[1]);
    api.record.value("index2", list[2]);
    api.record.value("index3", list[3]);
    const iterated = [];
    for (const item of list) {
      iterated.push(item);
    }
    api.record.value("iterator-length", iterated.length);
    api.record.value("iterator-0", iterated[0]);
    api.record.value("iterator-2", iterated[2]);

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    list.clear();
    api.record.value("clear-length", list.length);
    api.record.value("clear-attr", element.getAttribute("requiredExtensions"));

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("initialize-return", list.initialize("test") === "test");
    api.record.value("initialize-length", list.length);
    api.record.value("initialize-0", list[0]);
    api.record.value("initialize-attr", element.getAttribute("requiredExtensions"));

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("getItem0", list.getItem(0));
    api.record.value("getItem1", list.getItem(1));
    api.record.value("getItemString2", list.getItem("2"));
    api.record.value("getItem3", list.getItem(3));

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("insert-return", list.insertItemBefore("test", 1) === "test");
    api.record.value("insert-length", list.length);
    api.record.value("insert-0", list[0]);
    api.record.value("insert-1", list[1]);
    api.record.value("insert-2", list[2]);
    api.record.value("insert-3", list[3]);
    api.record.value("insert-attr", element.getAttribute("requiredExtensions"));

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    const insOut1 = "test1";
    const insOut2 = "test2";
    list.insertItemBefore(insOut1, -1);
    list.insertItemBefore(insOut2, 10);
    api.record.value("insert-outbound-length", list.length);
    api.record.value("insert-outbound-0", list[0]);
    api.record.value("insert-outbound-4", list[4]);

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("replace-return", list.replaceItem("test", 1) === "key2");
    api.record.value("replace-length", list.length);
    api.record.value("replace-0", list[0]);
    api.record.value("replace-1", list[1]);
    api.record.value("replace-2", list[2]);
    api.record.value("replace-attr", element.getAttribute("requiredExtensions"));

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("remove-return", list.removeItem(1));
    api.record.value("remove-length", list.length);
    api.record.value("remove-0", list[0]);
    api.record.value("remove-1", list[1]);
    api.record.value("remove-attr", element.getAttribute("requiredExtensions"));
    api.record.value("remove-2-return", list.removeItem(1));
    api.record.value("remove-2-length", list.length);
    api.record.value("remove-2-0", list[0]);

    element.setAttribute("requiredExtensions", "key1 key2 key3");
    api.record.value("append-return", list.appendItem("test") === "test");
    api.record.value("append-length", list.length);
    api.record.value("append-0", list[0]);
    api.record.value("append-3", list[3]);
    api.record.value("append-attr", element.getAttribute("requiredExtensions"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
