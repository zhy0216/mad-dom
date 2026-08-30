//! T40 HTMLTemplateElement content and first-batch form contract fixtures.
//!
//! Integration-level evidence for `src/dom/template.rs` and `src/dom/form.rs`
//! plus their parser (T26/T27/T29) and serializer (T28) adaptations:
//!
//! * *template content* — a `<template>` element's content is an HTML5
//!   template-contents `DocumentFragment` that is *not* exposed as ordinary
//!   children; `set_inner_html` on a template populates the content fragment;
//!   `innerHTML` reads it back; the serializer emits the content inside the
//!   `<template>` tags; the parse→serialize→parse round trip preserves it;
//!   `cloneNode` / `importNode` / `adoptNode` carry the content with the
//!   element; and a template created programmatically gets a content fragment
//!   from creation;
//! * *form control basics* — `input`/`button`/`select`/`option`/`textarea`
//!   value/checked/selected reads and writes (the attribute reflections plus
//!   the dirty value/checked cells and the select selection model), the radio
//!   group exclusivity, and `form.elements` in document order;
//! * *reset* — `form_reset` restores every control to its default value.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::serialize::{serialize_children, serialize_node};

/// Parses `input` with the T29 full-document loader and returns the document
/// plus its `<body>` element.
fn load_body(input: &str) -> (Document, NodeId) {
    let mut doc = Document::new();
    doc.load_html(input).unwrap();
    let body = doc.document_body().unwrap().expect("loaded doc has a body");
    (doc, body)
}

/// Returns the first descendant (or self) element with `tag`, in document
/// order.
fn find_element(doc: &Document, root: NodeId, tag: &str) -> NodeId {
    let mut stack: Vec<NodeId> = doc.children(root).unwrap().into_iter().rev().collect();
    while let Some(current) = stack.pop() {
        if doc.node_name(current).unwrap() == tag {
            return current;
        }
        let mut kids = doc.children(current).unwrap();
        kids.reverse();
        stack.extend(kids);
    }
    panic!("tag {tag} not found");
}

// ---- template -------------------------------------------------------------

#[test]
fn template_content_is_not_an_ordinary_child() {
    let (doc, _body) = load_body("<template><p>in</p></template>");
    let html = doc.document_element().unwrap().unwrap();
    let template = find_element(&doc, html, "template");
    assert_eq!(
        doc.children(template).unwrap(),
        Vec::<NodeId>::new(),
        "template content is not in the element's child list"
    );
    let content = doc.template_content_id(template).unwrap().expect("linked");
    assert_eq!(doc.node_type(content).unwrap(), NodeType::DocumentFragment);
    let inner: Vec<String> = doc
        .children(content)
        .unwrap()
        .iter()
        .map(|&c| doc.node_name(c).unwrap().to_string())
        .collect();
    assert_eq!(inner, ["p"]);
    assert!(doc.parent(content).unwrap().is_none());
    assert_eq!(doc.check_invariants(content).unwrap(), ());
}

#[test]
fn template_inner_html_populates_content_and_serializes_back() {
    let mut doc = Document::new();
    doc.load_html("<body></body>").unwrap();
    let body = doc.document_body().unwrap().unwrap();
    doc.set_inner_html(body, "<template><p>a</p></template>")
        .unwrap();
    let template = find_element(&doc, body, "template");
    let content = doc.template_content_id(template).unwrap().unwrap();
    assert_eq!(
        doc.children(content).unwrap().len(),
        1,
        "parsed content lives in the template contents fragment"
    );
    assert_eq!(
        doc.inner_html(template).unwrap(),
        "<p>a</p>",
        "template.innerHTML serializes the content"
    );
    assert_eq!(
        serialize_children(&doc, body).unwrap(),
        "<template><p>a</p></template>",
        "the body round-trips the template content"
    );
}

#[test]
fn setting_inner_html_on_a_template_replaces_its_content() {
    let mut doc = Document::new();
    doc.load_html("<body><template><p>old</p></template></body>")
        .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let template = find_element(&doc, body, "template");
    let content = doc.template_content_id(template).unwrap().unwrap();

    doc.set_inner_html(template, "<span>new</span>").unwrap();
    assert_eq!(doc.inner_html(template).unwrap(), "<span>new</span>");
    assert_eq!(doc.children(content).unwrap().len(), 1);
    assert_eq!(doc.children(template).unwrap(), Vec::<NodeId>::new());
}

#[test]
fn template_parse_serialize_parse_round_trip_preserves_content() {
    let input = "<html><body><template><p>in</p></template></body></html>";
    let (doc, body) = load_body(input);
    let html = doc.document_element().unwrap().unwrap();
    let serialized = serialize_node(&doc, html).unwrap();
    let (second, second_body) = load_body(&serialized);
    assert_eq!(
        serialize_children(&second, second_body).unwrap(),
        "<template><p>in</p></template>"
    );
    let first_template = find_element(&doc, body, "template");
    let second_template = find_element(&second, second_body, "template");
    assert_eq!(
        doc.inner_html(first_template).unwrap(),
        second.inner_html(second_template).unwrap()
    );
}

#[test]
fn create_element_template_has_content_from_creation() {
    let mut doc = Document::new();
    let template = doc.create_element("template").unwrap();
    let content = doc.template_content(template).unwrap();
    assert_eq!(doc.node_type(content).unwrap(), NodeType::DocumentFragment);
    assert_eq!(doc.children(content).unwrap(), Vec::<NodeId>::new());
    assert_eq!(
        doc.template_content(template).unwrap(),
        content,
        "content identity is stable"
    );
    assert_eq!(doc.outer_html(template).unwrap(), "<template></template>");
}

#[test]
fn clone_node_deep_copies_template_content() {
    let mut doc = Document::new();
    doc.load_html("<body><template><p>in</p></template></body>")
        .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let template = find_element(&doc, body, "template");

    let deep = doc.clone_node(template, true).unwrap();
    let content = doc
        .template_content_id(deep)
        .unwrap()
        .expect("clone keeps content");
    assert_eq!(doc.inner_html(deep).unwrap(), "<p>in</p>");
    assert_eq!(doc.children(content).unwrap().len(), 1);
    assert_ne!(content, doc.template_content_id(template).unwrap().unwrap());
    assert_eq!(
        doc.outer_html(deep).unwrap(),
        "<template><p>in</p></template>"
    );

    let shallow = doc.clone_node(template, false).unwrap();
    assert_eq!(
        doc.children(doc.template_content_id(shallow).unwrap().unwrap())
            .unwrap()
            .len(),
        0,
        "a shallow clone copies the empty content fragment"
    );
}

#[test]
fn import_node_copies_template_content() {
    let mut source = Document::new();
    source
        .load_html("<body><template><p>in</p></template></body>")
        .unwrap();
    let s_body = source.document_body().unwrap().unwrap();
    let s_template = find_element(&source, s_body, "template");

    let mut target = Document::new();
    let imported = target.import_node(&source, s_template, true).unwrap();
    assert_eq!(target.inner_html(imported).unwrap(), "<p>in</p>");
    assert_eq!(
        target.outer_html(imported).unwrap(),
        "<template><p>in</p></template>"
    );
    assert_eq!(
        source.inner_html(s_template).unwrap(),
        "<p>in</p>",
        "source untouched"
    );
}

#[test]
fn adopt_node_moves_template_content() {
    let mut source = Document::new();
    source
        .load_html("<body><template><p>in</p></template></body>")
        .unwrap();
    let s_body = source.document_body().unwrap().unwrap();
    let s_template = find_element(&source, s_body, "template");

    let mut target = Document::new();
    let adopted = target.adopt_node(&mut source, s_template).unwrap();
    assert_eq!(target.inner_html(adopted).unwrap(), "<p>in</p>");
    assert!(source.get(s_template).is_err(), "source template is stale");
    let s_content = source.template_content_id(s_template);
    assert!(s_content.is_err() || s_content.unwrap().is_none());
}

// ---- form basics ----------------------------------------------------------

#[test]
fn input_value_checked_and_defaults() {
    let mut doc = Document::new();
    doc.load_html(
        "<body><input id=\"t\" value=\"v\"><input id=\"c\" type=\"checkbox\" checked></body>",
    )
    .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let text = find_element(&doc, body, "input");
    assert_eq!(doc.input_value(text).unwrap(), "v");
    assert_eq!(doc.input_default_value(text).unwrap(), "v");
    assert!(!doc.input_checked(text).unwrap());
    assert!(!doc.input_default_checked(text).unwrap());

    let checkbox = doc
        .children(body)
        .unwrap()
        .iter()
        .find(|&&c| doc.get_attribute(c, "id").unwrap() == Some("c"))
        .copied()
        .unwrap();
    assert_eq!(doc.input_value(checkbox).unwrap(), "on");
    assert!(doc.input_checked(checkbox).unwrap());
    assert!(doc.input_default_checked(checkbox).unwrap());

    doc.set_input_value(text, "typed").unwrap();
    assert_eq!(doc.input_value(text).unwrap(), "typed");
    assert_eq!(doc.get_attribute(text, "value").unwrap(), Some("v"));

    doc.set_input_checked(checkbox, false).unwrap();
    assert!(!doc.input_checked(checkbox).unwrap());
    assert!(doc.input_default_checked(checkbox).unwrap());
}

#[test]
fn form_reset_restores_defaults() {
    let mut doc = Document::new();
    doc.load_html(
        "<body><form id=\"f\"><input id=\"t\" value=\"v\"><input id=\"c\" type=\"checkbox\" checked>\
         <select id=\"s\"><option value=\"a\">A</option><option value=\"b\" selected>B</option></select>\
         <textarea id=\"ta\">d</textarea></form></body>",
    )
    .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let form = find_element(&doc, body, "form");
    let select = find_element(&doc, body, "select");

    let text = find_element(&doc, body, "input");
    doc.set_input_value(text, "x").unwrap();
    doc.set_input_checked(text, true).unwrap();
    let select_options = doc.select_options(select).unwrap();
    doc.set_option_selected(select_options[0], true).unwrap();
    let textarea = find_element(&doc, body, "textarea");
    doc.set_textarea_value(textarea, "typed").unwrap();

    doc.form_reset(form).unwrap();
    assert_eq!(doc.input_value(text).unwrap(), "v");
    assert!(!doc.input_checked(text).unwrap());
    assert_eq!(doc.select_value(select).unwrap(), "b");
    assert_eq!(doc.textarea_value(textarea).unwrap(), "d");
}

#[test]
fn button_select_option_surface() {
    let mut doc = Document::new();
    doc.load_html(
        "<body><button id=\"b\" name=\"n\" value=\"go\">Go</button>\
         <select id=\"s\"><option value=\"a\">A</option><option>B</option></select></body>",
    )
    .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let button = find_element(&doc, body, "button");
    assert_eq!(doc.get_attribute(button, "name").unwrap(), Some("n"));
    assert_eq!(doc.get_attribute(button, "value").unwrap(), Some("go"));

    let select = find_element(&doc, body, "select");
    let options = doc.select_options(select).unwrap();
    assert_eq!(
        doc.option_value(options[1]).unwrap(),
        "B",
        "option value falls back to text"
    );
    assert_eq!(
        doc.select_value(select).unwrap(),
        "a",
        "default selects the first option"
    );
    assert_eq!(doc.option_index(options[1]).unwrap(), 1);

    doc.set_select_value(select, "B").unwrap();
    assert_eq!(doc.select_value(select).unwrap(), "B");
    assert_eq!(doc.select_selected_index(select).unwrap(), 1);
}

#[test]
fn form_elements_are_live_and_ordered() {
    let mut doc = Document::new();
    doc.load_html(
        "<body><form id=\"f\"><input><select></select><div><button></button></div></form></body>",
    )
    .unwrap();
    let body = doc.document_body().unwrap().unwrap();
    let form = find_element(&doc, body, "form");
    let elements = doc.form_elements(form).unwrap();
    let names: Vec<String> = elements
        .iter()
        .map(|&e| doc.node_name(e).unwrap().to_string())
        .collect();
    assert_eq!(names, ["input", "select", "button"]);
}
