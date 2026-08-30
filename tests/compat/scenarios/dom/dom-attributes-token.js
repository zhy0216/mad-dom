// Real differential scenario (T34): the attribute-node and token-list surface.
//
// Scope is exactly the T34 slice — `Element.attributes` returning a live
// `NamedNodeMap` of `Attr` wrappers (length / item / getNamedItem / indexed /
// named getter / iteration / toString), the `Attr` reads plus a value
// write-through, `document.createAttribute`, `Element.classList` returning a
// live `DOMTokenList` over the `class` attribute (length / value / item /
// contains / add / remove / toggle / replace / iteration), the bidirectional
// classList ↔ class sync, and the retained-collection "live after external
// attribute change" semantics.
//
// The scenario deliberately avoids the frozen T34 deviations (pinned by the
// Bun tests instead): invalid tokens (empty / whitespace) throw the WHATWG
// errors in MAD DOM while happy-dom accepts them; a mutator that empties the
// token set removes the `class` attribute in MAD DOM while happy-dom stores
// `""`; `Attr.nodeName`/`nodeValue` follow the WHATWG in MAD DOM while
// happy-dom reports `""`/`null`; `Object.getOwnPropertyNames` of a
// NamedNodeMap leaks happy-dom's internal `:name` keys; and `setAttribute`
// replaces the `Attr` object in happy-dom while MAD DOM keeps one live wrapper
// per attribute name. All probes below keep at least one token in the `class`
// attribute and read fresh state after every mutation, so both sides agree
// observation for observation.
export const id = "dom-attributes-token";
export const description = "real differential: element.attributes NamedNodeMap/Attr, classList DOMTokenList over class, createAttribute, live bidirectional class sync";
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
  const document = window.document;

  try {
    const el = document.createElement("div");
    el.setAttribute("id", "root");
    el.setAttribute("class", "a b c");
    el.setAttribute("data-x", "1");

    // --- NamedNodeMap read surface ---
    const attrs = el.attributes;
    api.record.value("attributes-length", attrs.length);
    api.record.value("attributes-item-0-name", attrs.item(0).name);
    api.record.value("attributes-item-0-value", attrs.item(0).value);
    api.record.value("attributes-item-99", attrs.item(99));
    api.record.value("attributes-index-1-name", attrs[1].name);
    api.record.value("attributes-index-99", attrs[99]);
    api.record.value("attributes-getNamedItem-class", attrs.getNamedItem("class").value);
    api.record.value("attributes-getNamedItem-missing", attrs.getNamedItem("nope"));
    api.record.value("attributes-named-getter", attrs["id"].name);
    api.record.value("attributes-named-getter-missing", attrs["nope"]);
    api.record.value("attributes-in-id", "id" in attrs);
    api.record.value("attributes-in-0", 0 in attrs);
    api.record.value("attributes-in-99", 99 in attrs);
    api.record.value(
      "attributes-iterated",
      Array.from(attrs, (attr) => attr.name),
    );
    api.record.value("attributes-toStringTag", Object.prototype.toString.call(attrs));
    api.record.value("attributes-toString", attrs.toString());

    api.record.identity("attributes-same-index", attrs[0], attrs[0]);
    api.record.identity("attributes-same-named", attrs.getNamedItem("id"), attrs["id"]);
    api.record.identity("attributes-item-vs-index", attrs.item(0), attrs[0]);
    api.record.identity("attributes-map-identity", el.attributes, el.attributes);
    api.record.identity("attributes-owner-element", attrs[0].ownerElement, el);

    // --- Attr surface: fixed fields plus a value write-through ---
    const first = attrs[0];
    api.record.value("attr-node-type", first.nodeType);
    api.record.value("attr-specified", first.specified);
    api.record.value("attr-prefix", first.prefix);
    api.record.value("attr-local-name", first.localName);
    api.record.value("attr-name", first.name);
    api.record.value("attr-value", first.value);
    first.value = "newroot";
    api.record.value("attr-value-write-through", el.getAttribute("id"));
    api.record.value("attr-value-after-write", attrs[0].value);

    // --- document.createAttribute (detached Attr) ---
    api.record.value("surface-create-attribute", typeof document.createAttribute);
    const created = document.createAttribute("data-new");
    api.record.value("created-attr-name", created.name);
    api.record.value("created-attr-value", created.value);
    api.record.value("created-attr-node-type", created.nodeType);
    api.record.value("created-attr-specified", created.specified);
    api.record.value("created-attr-owner", created.ownerElement);
    created.value = "v";
    api.record.value("created-attr-value-after-set", created.value);
    api.record.value("created-attr-owner-after-set", created.ownerElement);

    // --- live: the retained NamedNodeMap reflects external attribute changes ---
    el.setAttribute("class", "x y");
    api.record.value("live-attributes-length", attrs.length);
    api.record.value("live-getNamedItem-class", attrs.getNamedItem("class").value);
    el.removeAttribute("data-x");
    api.record.value("live-after-remove-length", attrs.length);
    api.record.value("live-after-remove-missing", attrs.getNamedItem("data-x"));

    // --- DOMTokenList read surface (class is now "x y") ---
    const cl = el.classList;
    api.record.identity("classlist-identity", el.classList, el.classList);
    api.record.value("classlist-length", cl.length);
    api.record.value("classlist-value", cl.value);
    api.record.value("classlist-item-0", cl.item(0));
    api.record.value("classlist-item-99", cl.item(99));
    api.record.value("classlist-index-0", cl[0]);
    api.record.value("classlist-in-a", "a" in cl);
    api.record.value("classlist-in-0", 0 in cl);
    api.record.value("classlist-contains-x", cl.contains("x"));
    api.record.value("classlist-contains-missing", cl.contains("zzz"));
    api.record.value("classlist-contains-empty", cl.contains(""));
    api.record.value("classlist-iterated", Array.from(cl));
    api.record.value("classlist-entries", Array.from(cl.entries()));
    api.record.value("classlist-keys", Array.from(cl.keys()));
    api.record.value("classlist-values", Array.from(cl.values()));
    api.record.value("classlist-toStringTag", Object.prototype.toString.call(cl));
    api.record.value("classlist-toString", cl.toString());

    // --- DOMTokenList mutators (each reads fresh state) ---
    cl.add("z");
    api.record.value("classlist-after-add", el.getAttribute("class"));
    cl.add("x", "w");
    api.record.value("classlist-after-add-multi", el.getAttribute("class"));
    cl.remove("a");
    api.record.value("classlist-after-remove-missing", el.getAttribute("class"));
    cl.remove("x");
    api.record.value("classlist-after-remove", el.getAttribute("class"));

    const toggledAdd = cl.toggle("q");
    api.record.value("classlist-toggle-absent", toggledAdd);
    api.record.value("classlist-toggle-absent-class", el.getAttribute("class"));
    const toggledRemove = cl.toggle("q");
    api.record.value("classlist-toggle-present", toggledRemove);
    api.record.value("classlist-toggle-present-class", el.getAttribute("class"));
    const toggledForceTrue = cl.toggle("r", true);
    api.record.value("classlist-toggle-force-true", toggledForceTrue);
    api.record.value("classlist-toggle-force-true-class", el.getAttribute("class"));
    const toggledForceFalse = cl.toggle("y", false);
    api.record.value("classlist-toggle-force-false", toggledForceFalse);
    api.record.value("classlist-toggle-force-false-class", el.getAttribute("class"));

    const replaced = cl.replace("w", "v");
    api.record.value("classlist-replace", replaced);
    api.record.value("classlist-replace-class", el.getAttribute("class"));
    const notReplaced = cl.replace("nope", "v");
    api.record.value("classlist-replace-missing", notReplaced);
    api.record.value("classlist-replace-missing-class", el.getAttribute("class"));

    // --- value accessor: raw attribute string, verbatim both ways ---
    cl.value = "  p  q   r ";
    api.record.value("classlist-value-attr", el.getAttribute("class"));
    api.record.value("classlist-value-raw", cl.value);
    api.record.value("classlist-value-length", cl.length);

    // --- live: the retained classList reflects external class changes ---
    el.setAttribute("class", "outer");
    api.record.value("classlist-live-after-set", cl.value);
    api.record.value("classlist-live-after-set-length", cl.length);
    api.record.value("classlist-live-contains", cl.contains("outer"));
    el.removeAttribute("class");
    api.record.value("classlist-live-after-remove", cl.value);
    api.record.value("classlist-live-after-remove-length", cl.length);
    api.record.value("classlist-live-contains-outer", cl.contains("outer"));

    // --- namespaceURI on an element ---
    api.record.value("element-namespace-uri", el.namespaceURI);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
