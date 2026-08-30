//! Integration tests for the Core `textContent` module (T25C).
//!
//! Exercises the WHATWG `Node.textContent` getter/setter contract on the first
//! batch of node types through the public `mad-dom-core` API: reading
//! concatenates descendant `Text` data in tree order (comments excluded) while
//! `Text`/`Comment` read their own data; the setter updates character data in
//! place or replaces an `Element`/`DocumentFragment`'s children with a single
//! text node via the unified mutation API; failed calls are atomic and foreign
//! or stale handles fail without corrupting the tree.

use mad_dom_core::arena::{ArenaError, NodeId};
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;

/// Creates an element in `doc`.
fn element(doc: &mut Document, name: &str) -> NodeId {
    doc.create_element(name).unwrap()
}

/// Creates a text node in `doc`.
fn text(doc: &mut Document, data: &str) -> NodeId {
    doc.create_text(data).unwrap()
}

/// Creates a comment node in `doc`.
fn comment(doc: &mut Document, data: &str) -> NodeId {
    doc.create_comment(data).unwrap()
}

/// Creates a document fragment in `doc`.
fn fragment(doc: &mut Document) -> NodeId {
    doc.create_document_fragment().unwrap()
}

/// Appends `child` to `parent` in `doc`.
fn append(doc: &mut Document, parent: NodeId, child: NodeId) {
    doc.append_child(parent, child).unwrap();
}

// ---- getter ----

#[test]
fn text_node_reads_its_own_data() {
    let mut doc = Document::new();
    let t = text(&mut doc, "hello");
    assert_eq!(doc.text_content(t).unwrap(), Some("hello".to_string()));

    let empty = text(&mut doc, "");
    assert_eq!(doc.text_content(empty).unwrap(), Some(String::new()));
}

#[test]
fn comment_node_reads_its_own_data() {
    let mut doc = Document::new();
    let c = comment(&mut doc, "a note");
    assert_eq!(doc.text_content(c).unwrap(), Some("a note".to_string()));

    let empty = comment(&mut doc, "");
    assert_eq!(doc.text_content(empty).unwrap(), Some(String::new()));
}

#[test]
fn element_reads_descendant_text_in_tree_order_and_skips_comments() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    let t_a = text(&mut doc, "A");
    let c_skip = comment(&mut doc, "skip");
    let span = element(&mut doc, "span");
    let t_b = text(&mut doc, "B");
    let c_skip_2 = comment(&mut doc, "also-skip");
    let t_c = text(&mut doc, "C");
    let t_d = text(&mut doc, "D");
    append(&mut doc, root, t_a);
    append(&mut doc, root, c_skip);
    append(&mut doc, span, t_b);
    append(&mut doc, span, c_skip_2);
    append(&mut doc, span, t_c);
    append(&mut doc, root, span);
    append(&mut doc, root, t_d);

    assert_eq!(
        doc.text_content(root).unwrap(),
        Some("ABCD".to_string()),
        "tree order is preserved and comments are excluded"
    );
    assert_eq!(doc.text_content(span).unwrap(), Some("BC".to_string()));
}

#[test]
fn fragment_reads_descendant_text_in_tree_order() {
    let mut doc = Document::new();
    let frag = fragment(&mut doc);
    let t_x = text(&mut doc, "x");
    let inner = element(&mut doc, "em");
    let t_y = text(&mut doc, "y");
    let c = comment(&mut doc, "c");
    let t_z = text(&mut doc, "z");
    append(&mut doc, frag, t_x);
    append(&mut doc, inner, t_y);
    append(&mut doc, inner, c);
    append(&mut doc, frag, inner);
    append(&mut doc, frag, t_z);

    assert_eq!(doc.text_content(frag).unwrap(), Some("xyz".to_string()));
}

#[test]
fn element_without_text_reads_empty_string() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    assert_eq!(doc.text_content(root).unwrap(), Some(String::new()));

    let c = comment(&mut doc, "only a comment");
    append(&mut doc, root, c);
    assert_eq!(
        doc.text_content(root).unwrap(),
        Some(String::new()),
        "a comment-only subtree still reads empty"
    );
}

#[test]
fn nested_element_without_text_reads_empty_string() {
    let mut doc = Document::new();
    let a = element(&mut doc, "a");
    let b = element(&mut doc, "b");
    let c = element(&mut doc, "c");
    append(&mut doc, a, b);
    append(&mut doc, b, c);

    assert_eq!(doc.text_content(a).unwrap(), Some(String::new()));
}

#[test]
fn deep_tree_reads_concatenated_text() {
    let mut doc = Document::new();
    let root = element(&mut doc, "root");
    let mut cur = root;
    const DEPTH: usize = 2_000;
    for _ in 0..DEPTH {
        let child = element(&mut doc, "n");
        append(&mut doc, cur, child);
        cur = child;
    }
    let leaf = text(&mut doc, "deep");
    append(&mut doc, cur, leaf);

    assert_eq!(doc.text_content(root).unwrap(), Some("deep".to_string()));
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

// ---- setter: text / comment ----

#[test]
fn set_text_node_updates_data_in_place() {
    let mut doc = Document::new();
    let t = text(&mut doc, "hello");
    doc.set_text_content(t, "world").unwrap();

    assert_eq!(doc.node_type(t).unwrap(), NodeType::Text);
    assert_eq!(doc.get(t).unwrap().data().text_data(), Some("world"));
    assert_eq!(doc.text_content(t).unwrap(), Some("world".to_string()));
}

#[test]
fn set_comment_node_updates_data_in_place() {
    let mut doc = Document::new();
    let c = comment(&mut doc, "note");
    doc.set_text_content(c, "updated").unwrap();

    assert_eq!(doc.node_type(c).unwrap(), NodeType::Comment);
    assert_eq!(doc.get(c).unwrap().data().comment_data(), Some("updated"));
    assert_eq!(doc.text_content(c).unwrap(), Some("updated".to_string()));
}

#[test]
fn set_text_node_to_empty_clears_data() {
    let mut doc = Document::new();
    let t = text(&mut doc, "hello");
    doc.set_text_content(t, "").unwrap();

    assert_eq!(doc.get(t).unwrap().data().text_data(), Some(""));
    assert_eq!(doc.text_content(t).unwrap(), Some(String::new()));
}

#[test]
fn setting_text_content_leaves_tree_relations_untouched() {
    let mut doc = Document::new();
    let parent = element(&mut doc, "p");
    let t = text(&mut doc, "hello");
    append(&mut doc, parent, t);

    doc.set_text_content(t, "bye").unwrap();

    assert_eq!(doc.parent(t).unwrap(), Some(parent));
    assert_eq!(doc.first_child(parent).unwrap(), Some(t));
    assert_eq!(doc.last_child(parent).unwrap(), Some(t));
    assert_eq!(doc.children(parent).unwrap(), vec![t]);
    assert_eq!(doc.check_invariants(parent).unwrap(), ());
}

// ---- setter: element / fragment replacement ----

#[test]
fn set_element_replaces_children_with_single_text_node() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    let t_a = text(&mut doc, "a");
    let c = comment(&mut doc, "c");
    let span = element(&mut doc, "span");
    let t_b = text(&mut doc, "b");
    append(&mut doc, root, t_a);
    append(&mut doc, root, c);
    append(&mut doc, span, t_b);
    append(&mut doc, root, span);

    doc.set_text_content(root, "replacement").unwrap();

    // The element itself is unchanged; its child list is now one text node.
    assert_eq!(doc.node_type(root).unwrap(), NodeType::Element);
    assert_eq!(doc.node_name(root).unwrap(), "div");

    let children = doc.children(root).unwrap();
    assert_eq!(children.len(), 1);
    let only = children[0];
    assert_eq!(doc.node_type(only).unwrap(), NodeType::Text);
    assert_eq!(
        doc.get(only).unwrap().data().text_data(),
        Some("replacement")
    );
    assert_eq!(
        doc.text_content(root).unwrap(),
        Some("replacement".to_string())
    );

    // Navigation immediately reflects the new single child.
    assert_eq!(doc.first_child(root).unwrap(), Some(only));
    assert_eq!(doc.last_child(root).unwrap(), Some(only));
    assert_eq!(doc.parent(only).unwrap(), Some(root));
    assert_eq!(doc.check_invariants(root).unwrap(), ());

    // Removed nodes are detached but still live and readable.
    assert_eq!(doc.parent(span).unwrap(), None);
    assert!(doc.get(span).is_ok());
    assert_eq!(doc.text_content(span).unwrap(), Some("b".to_string()));
}

#[test]
fn set_fragment_replaces_children_with_single_text_node() {
    let mut doc = Document::new();
    let frag = fragment(&mut doc);
    let t_a = text(&mut doc, "a");
    let div = element(&mut doc, "div");
    append(&mut doc, frag, t_a);
    append(&mut doc, frag, div);

    doc.set_text_content(frag, "fragment text").unwrap();

    let children = doc.children(frag).unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(
        doc.get(children[0]).unwrap().data().text_data(),
        Some("fragment text")
    );
    assert_eq!(
        doc.text_content(frag).unwrap(),
        Some("fragment text".to_string())
    );
    assert_eq!(doc.check_invariants(frag).unwrap(), ());
}

#[test]
fn set_element_to_empty_removes_all_children() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    let t_a = text(&mut doc, "a");
    let span = element(&mut doc, "span");
    let c = comment(&mut doc, "c");
    append(&mut doc, root, t_a);
    append(&mut doc, root, span);
    append(&mut doc, root, c);

    doc.set_text_content(root, "").unwrap();

    assert_eq!(doc.children(root).unwrap(), Vec::<NodeId>::new());
    assert_eq!(doc.first_child(root).unwrap(), None);
    assert_eq!(doc.last_child(root).unwrap(), None);
    assert_eq!(doc.text_content(root).unwrap(), Some(String::new()));
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn setting_text_again_replaces_previous_content() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    doc.set_text_content(root, "first").unwrap();
    doc.set_text_content(root, "second").unwrap();

    let children = doc.children(root).unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(
        doc.get(children[0]).unwrap().data().text_data(),
        Some("second")
    );
    assert_eq!(doc.text_content(root).unwrap(), Some("second".to_string()));
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

// ---- atomicity ----

#[test]
fn set_element_stores_nul_verbatim() {
    let mut doc = Document::new();
    let root = element(&mut doc, "div");
    let t_a = text(&mut doc, "a");
    let span = element(&mut doc, "span");
    append(&mut doc, root, t_a);
    append(&mut doc, root, span);

    doc.set_text_content(root, "bad\0value").unwrap();

    // The NUL-bearing value replaces the children verbatim (T48B text-data
    // alignment, matching happy-dom).
    assert_eq!(
        doc.text_content(root).unwrap(),
        Some("bad\0value".to_string())
    );
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn set_fragment_stores_nul_verbatim() {
    let mut doc = Document::new();
    let frag = fragment(&mut doc);
    let t_x = text(&mut doc, "x");
    append(&mut doc, frag, t_x);

    doc.set_text_content(frag, "bad\0value").unwrap();

    assert_eq!(doc.children(frag).unwrap().len(), 1);
    assert_eq!(
        doc.text_content(frag).unwrap(),
        Some("bad\0value".to_string())
    );
    assert_eq!(doc.check_invariants(frag).unwrap(), ());
}

#[test]
fn set_text_node_stores_nul_verbatim() {
    let mut doc = Document::new();
    let t = text(&mut doc, "hello");

    doc.set_text_content(t, "bad\0value").unwrap();

    assert_eq!(
        doc.get(t).unwrap().data().text_data(),
        Some("bad\0value"),
        "a NUL-bearing update is stored verbatim (T48B text-data alignment)"
    );
}

// ---- error boundary ----

#[test]
fn text_content_rejects_foreign_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let t = a.create_text("hello").unwrap();

    assert!(matches!(
        b.text_content(t),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.set_text_content(t, "x"),
        Err(CoreError::WrongDocument { .. })
    ));

    // The owner still reads the node unchanged.
    assert_eq!(a.text_content(t).unwrap(), Some("hello".to_string()));
    assert_eq!(a.get(t).unwrap().data().text_data(), Some("hello"));
}

#[test]
fn text_content_rejects_stale_handles_after_adoption() {
    let mut a = Document::new();
    let mut b = Document::new();
    let t = a.create_text("hello").unwrap();
    let adopted = b.adopt_node(&mut a, t).unwrap();

    // The old handle in `a` is stale after adoption and both entries reject it.
    assert!(matches!(
        a.text_content(t),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
    assert!(matches!(
        a.set_text_content(t, "x"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));

    // The adopted node in `b` is fully readable and writable.
    assert_eq!(b.text_content(adopted).unwrap(), Some("hello".to_string()));
    b.set_text_content(adopted, "moved").unwrap();
    assert_eq!(b.text_content(adopted).unwrap(), Some("moved".to_string()));
}
