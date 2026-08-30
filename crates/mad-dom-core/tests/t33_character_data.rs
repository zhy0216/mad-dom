//! T33 extended-node Core fixtures.
//!
//! Integration-level evidence for `src/dom/character_data.rs` and the
//! `ProcessingInstruction` model additions: the Core contract behind the
//! JavaScript `CharacterData` surface (`data` / `length` / `substringData` /
//! `appendData` / `insertData` / `deleteData` / `replaceData`), `Text.splitText`,
//! `ProcessingInstruction` creation / target / data, `DocumentType` payload
//! reads and the `document.doctype` read. The acceptance criteria pinned here:
//!
//! * *creation and naming* — `create_processing_instruction` validates the
//!   WHATWG "Name" production for the target and rejects `?>` / NUL in the
//!   data; a `ProcessingInstruction` reports `nodeType` 7 and `nodeName` equal
//!   to its target;
//! * *data mutation* — the `CharacterData` mutators operate on
//!   `Text`/`Comment`/`ProcessingInstruction` with WHATWG offset semantics
//!   (UTF-16 code units, clamped counts, `IndexSizeError` on an out-of-range
//!   offset) and are atomic on failure;
//! * *split* — `split_text` splits a `Text` node at any valid offset, keeps the
//!   head in place, inserts the tail right after it (or keeps both detached),
//!   and rejects non-`Text` receivers;
//! * *doctype reads* — `Document::doctype` finds the parsed `DocumentType`
//!   child without allocating a skeleton, and the payload reads return the
//!   name / public / system identifiers;
//! * *cross-document separation* — every operation rejects foreign and stale
//!   handles with [`CoreError::WrongDocument`] / [`CoreError::Arena`];
//! * *clone family* — `clone_node` / `import_node` / `adopt_node` copy and move
//!   `ProcessingInstruction` and `DocumentType` payloads by value into fresh
//!   target handles (never reusing a [`NodeId`]).

use mad_dom_core::arena::ArenaError;
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;

fn assert_hierarchy(err: CoreError) {
    assert!(
        matches!(err, CoreError::Hierarchy { .. }),
        "expected Hierarchy, got {err:?}"
    );
}

fn assert_invalid_character(err: CoreError) {
    assert!(
        matches!(err, CoreError::InvalidCharacter { .. }),
        "expected InvalidCharacter, got {err:?}"
    );
}

fn assert_index(err: CoreError) {
    assert!(
        matches!(err, CoreError::IndexOutOfBounds { .. }),
        "expected IndexOutOfBounds, got {err:?}"
    );
}

// ---- creation and naming ----

#[test]
fn create_processing_instruction_stores_target_and_data() {
    let mut doc = Document::new();
    let pi = doc
        .create_processing_instruction("xml-stylesheet", "href=\"style.css\"")
        .unwrap();
    assert_eq!(doc.node_type(pi).unwrap(), NodeType::ProcessingInstruction);
    assert_eq!(doc.node_name(pi).unwrap(), "xml-stylesheet");
    assert_eq!(
        doc.processing_instruction_target(pi).unwrap(),
        Some("xml-stylesheet")
    );
    assert_eq!(doc.character_data(pi).unwrap(), Some("href=\"style.css\""));
}

#[test]
fn create_processing_instruction_rejects_bad_targets_atomically() {
    let mut doc = Document::new();
    for bad in ["", "1xml", "a b", "xml/1"] {
        assert_invalid_character(doc.create_processing_instruction(bad, "d").unwrap_err());
    }
    for good in ["xml-stylesheet", "_private", ":custom", "中文", "a:b:c"] {
        assert!(doc.create_processing_instruction(good, "d").is_ok());
    }
}

#[test]
fn create_processing_instruction_rejects_question_greater_than_in_data() {
    let mut doc = Document::new();
    assert_invalid_character(
        doc.create_processing_instruction("target", "a?>b")
            .unwrap_err(),
    );
}

#[test]
fn create_processing_instruction_rejects_nul_in_data() {
    let mut doc = Document::new();
    assert_invalid_character(
        doc.create_processing_instruction("target", "a\0b")
            .unwrap_err(),
    );
}

// ---- data surface ----

#[test]
fn data_and_length_read_text_comment_and_pi() {
    let mut doc = Document::new();
    let text = doc.create_text("hello").unwrap();
    let comment = doc.create_comment("a comment").unwrap();
    let pi = doc.create_processing_instruction("t", "data").unwrap();
    let el = doc.create_element("div").unwrap();

    assert_eq!(doc.character_data(text).unwrap(), Some("hello"));
    assert_eq!(doc.character_data(comment).unwrap(), Some("a comment"));
    assert_eq!(doc.character_data(pi).unwrap(), Some("data"));
    assert_eq!(doc.character_data(el).unwrap(), None);

    assert_eq!(doc.character_data_length(text).unwrap(), Some(5));
    assert_eq!(doc.character_data_length(comment).unwrap(), Some(9));
    assert_eq!(doc.character_data_length(pi).unwrap(), Some(4));
    assert_eq!(doc.character_data_length(el).unwrap(), None);

    // UTF-16 length: an astral character counts as two code units.
    let emoji = doc.create_text("😀").unwrap();
    assert_eq!(doc.character_data_length(emoji).unwrap(), Some(2));
}

#[test]
fn set_data_updates_data_kinds_and_is_a_noop_elsewhere() {
    let mut doc = Document::new();
    let text = doc.create_text("a").unwrap();
    let comment = doc.create_comment("b").unwrap();
    let pi = doc.create_processing_instruction("t", "c").unwrap();
    let el = doc.create_element("div").unwrap();

    doc.set_data(text, "x").unwrap();
    doc.set_data(comment, "y").unwrap();
    doc.set_data(pi, "z").unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("x"));
    assert_eq!(doc.character_data(comment).unwrap(), Some("y"));
    assert_eq!(doc.character_data(pi).unwrap(), Some("z"));

    // Non-data kinds are a no-op (the WHATWG `data`/`nodeValue` setter rule).
    doc.set_data(el, "ignored").unwrap();
    assert_eq!(doc.character_data(el).unwrap(), None);
}

#[test]
fn set_data_rejects_nul_atomically() {
    let mut doc = Document::new();
    let text = doc.create_text("keep").unwrap();
    assert_invalid_character(doc.set_data(text, "a\0b").unwrap_err());
    assert_eq!(doc.character_data(text).unwrap(), Some("keep"));
}

// ---- CharacterData mutators ----

#[test]
fn substring_data_follows_whatwg_offset_semantics() {
    let mut doc = Document::new();
    let text = doc.create_text("hello world").unwrap();
    assert_eq!(doc.substring_data(text, 0, 5).unwrap(), "hello");
    assert_eq!(doc.substring_data(text, 6, 5).unwrap(), "world");
    assert_eq!(doc.substring_data(text, 6, 100).unwrap(), "world");
    assert_eq!(doc.substring_data(text, 100, 5).unwrap(), "");
}

#[test]
fn append_data_appends_and_insert_data_splices() {
    let mut doc = Document::new();
    let text = doc.create_text("hello world").unwrap();
    doc.append_data(text, "!").unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("hello world!"));
    doc.insert_data(text, 6, "beautiful ").unwrap();
    assert_eq!(
        doc.character_data(text).unwrap(),
        Some("hello beautiful world!")
    );
    doc.insert_data(text, 0, "pre").unwrap();
    assert_eq!(
        doc.character_data(text).unwrap(),
        Some("prehello beautiful world!")
    );
    doc.insert_data(text, 3, "MID").unwrap();
    assert_eq!(
        doc.character_data(text).unwrap(),
        Some("preMIDhello beautiful world!")
    );
    // Inserting at the length appends.
    let len = doc.character_data_length(text).unwrap().unwrap();
    doc.insert_data(text, len, "!").unwrap();
    assert_eq!(
        doc.character_data(text).unwrap(),
        Some("preMIDhello beautiful world!!")
    );
}

#[test]
fn insert_delete_replace_reject_out_of_range_offsets_atomically() {
    let mut doc = Document::new();
    let text = doc.create_text("abc").unwrap();
    assert_index(doc.insert_data(text, 4, "x").unwrap_err());
    assert_index(doc.delete_data(text, 4, 1).unwrap_err());
    assert_index(doc.replace_data(text, 4, 1, "x").unwrap_err());
    assert_eq!(doc.character_data(text).unwrap(), Some("abc"));
}

#[test]
fn delete_data_and_replace_data_follow_clamped_counts() {
    let mut doc = Document::new();
    let text = doc.create_text("abcdef").unwrap();
    doc.delete_data(text, 1, 2).unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("adef"));
    doc.replace_data(text, 0, 2, "XY").unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("XYef"));
    doc.delete_data(text, 2, 100).unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("XY"));
    doc.replace_data(text, 0, 99, "Z").unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some("Z"));
}

#[test]
fn mutators_work_on_comments_and_pi() {
    let mut doc = Document::new();
    let comment = doc.create_comment("ab").unwrap();
    let pi = doc.create_processing_instruction("t", "cd").unwrap();
    doc.append_data(comment, "!").unwrap();
    doc.insert_data(pi, 1, "X").unwrap();
    assert_eq!(doc.character_data(comment).unwrap(), Some("ab!"));
    assert_eq!(doc.character_data(pi).unwrap(), Some("cXd"));
    assert_eq!(doc.substring_data(comment, 1, 2).unwrap(), "b!");
    assert_eq!(doc.substring_data(pi, 1, 1).unwrap(), "X");
}

#[test]
fn mutators_require_a_character_data_node() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    let frag = doc.create_document_fragment().unwrap();
    let doc_node = doc.document_root();

    for id in [el, frag, doc_node] {
        assert_hierarchy(doc.substring_data(id, 0, 1).unwrap_err());
        assert_hierarchy(doc.append_data(id, "x").unwrap_err());
        assert_hierarchy(doc.insert_data(id, 0, "x").unwrap_err());
        assert_hierarchy(doc.delete_data(id, 0, 1).unwrap_err());
        assert_hierarchy(doc.replace_data(id, 0, 1, "x").unwrap_err());
    }
}

#[test]
fn mutators_reject_nul_in_new_data_atomically() {
    let mut doc = Document::new();
    let text = doc.create_text("ok").unwrap();
    assert_invalid_character(doc.append_data(text, "a\0b").unwrap_err());
    assert_invalid_character(doc.insert_data(text, 0, "a\0b").unwrap_err());
    assert_invalid_character(doc.replace_data(text, 0, 1, "a\0b").unwrap_err());
    assert_eq!(doc.character_data(text).unwrap(), Some("ok"));
}

#[test]
fn mutators_leave_tree_relations_untouched() {
    let mut doc = Document::new();
    let parent = doc.create_element("p").unwrap();
    let text = doc.create_text("hello").unwrap();
    doc.append_child(parent, text).unwrap();

    doc.replace_data(text, 0, 5, "bye").unwrap();
    assert_eq!(doc.parent(text).unwrap(), Some(parent));
    assert_eq!(doc.first_child(parent).unwrap(), Some(text));
    assert_eq!(doc.last_child(parent).unwrap(), Some(text));
    assert_eq!(doc.check_invariants(parent).unwrap(), ());
}

// ---- split_text ----

#[test]
fn split_text_splits_and_inserts_tail_after_head() {
    let mut doc = Document::new();
    let parent = doc.create_element("p").unwrap();
    let text = doc.create_text("abcdef").unwrap();
    doc.append_child(parent, text).unwrap();

    let tail = doc.split_text(text, 3).unwrap();
    assert_ne!(tail, text);
    assert_eq!(doc.character_data(text).unwrap(), Some("abc"));
    assert_eq!(doc.character_data(tail).unwrap(), Some("def"));
    assert_eq!(doc.node_type(tail).unwrap(), NodeType::Text);
    assert_eq!(doc.children(parent).unwrap(), vec![text, tail]);
    assert_eq!(doc.next_sibling(text).unwrap(), Some(tail));
    assert_eq!(doc.previous_sibling(tail).unwrap(), Some(text));
    assert_eq!(doc.parent(tail).unwrap(), Some(parent));
    assert_eq!(doc.check_invariants(parent).unwrap(), ());
}

#[test]
fn split_text_at_zero_and_at_length() {
    let mut doc = Document::new();
    let parent = doc.create_element("p").unwrap();
    let text = doc.create_text("abc").unwrap();
    doc.append_child(parent, text).unwrap();

    let tail = doc.split_text(text, 0).unwrap();
    assert_eq!(doc.character_data(text).unwrap(), Some(""));
    assert_eq!(doc.character_data(tail).unwrap(), Some("abc"));
    assert_eq!(doc.children(parent).unwrap(), vec![text, tail]);

    // Splitting the emptied head again inserts a new empty tail right after it.
    let empty_tail = doc.split_text(text, 0).unwrap();
    assert_eq!(doc.character_data(empty_tail).unwrap(), Some(""));
    assert_eq!(doc.children(parent).unwrap(), vec![text, empty_tail, tail]);
    assert_eq!(doc.check_invariants(parent).unwrap(), ());
}

#[test]
fn split_text_of_detached_text_stays_detached() {
    let mut doc = Document::new();
    let text = doc.create_text("detached").unwrap();
    let tail = doc.split_text(text, 2).unwrap();
    assert_eq!(doc.parent(text).unwrap(), None);
    assert_eq!(doc.parent(tail).unwrap(), None);
    assert_eq!(doc.character_data(text).unwrap(), Some("de"));
    assert_eq!(doc.character_data(tail).unwrap(), Some("tached"));
    assert_eq!(doc.check_invariants(text).unwrap(), ());
}

#[test]
fn split_text_rejects_out_of_range_offsets() {
    let mut doc = Document::new();
    let text = doc.create_text("abc").unwrap();
    assert_index(doc.split_text(text, 4).unwrap_err());
    assert_eq!(doc.character_data(text).unwrap(), Some("abc"));
}

#[test]
fn split_text_rejects_non_text_receivers() {
    let mut doc = Document::new();
    let comment = doc.create_comment("c").unwrap();
    let pi = doc.create_processing_instruction("t", "d").unwrap();
    assert_hierarchy(doc.split_text(comment, 0).unwrap_err());
    assert_hierarchy(doc.split_text(pi, 0).unwrap_err());
}

// ---- doctype reads ----

#[test]
fn fresh_document_has_no_doctype() {
    let doc = Document::new();
    assert_eq!(doc.doctype().unwrap(), None);
}

#[test]
fn doctype_returns_the_parsed_doctype_child() {
    let mut doc = Document::new();
    let source = "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\"><html><body></body></html>";
    doc.load_html(source).unwrap();

    let dt = doc.doctype().unwrap().expect("a doctype was parsed");
    assert_eq!(doc.node_type(dt).unwrap(), NodeType::DocumentType);
    assert_eq!(doc.node_name(dt).unwrap(), "html");
    let (name, public_id, system_id) = doc.doctype_payload(dt).unwrap().unwrap();
    assert_eq!(name, "html");
    assert_eq!(public_id, "-//W3C//DTD XHTML 1.0 Strict//EN");
    assert_eq!(
        system_id,
        "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"
    );
}

#[test]
fn doctype_payload_is_none_for_non_doctype_nodes() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    let pi = doc.create_processing_instruction("t", "d").unwrap();
    assert_eq!(doc.doctype_payload(el).unwrap(), None);
    assert_eq!(doc.doctype_payload(pi).unwrap(), None);
}

// ---- cross-document separation ----

#[test]
fn character_data_ops_reject_foreign_and_stale_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let text = a.create_text("hi").unwrap();
    assert!(matches!(
        b.character_data(text),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.substring_data(text, 0, 1),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.append_data(text, "x"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.split_text(text, 0),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.doctype_payload(text),
        Err(CoreError::WrongDocument { .. })
    ));

    // A stale handle: the node is adopted into `b`, so `a` recognises the id
    // as its own but its slot is gone.
    let moved = b.adopt_node(&mut a, text).unwrap();
    assert!(b.get(moved).is_ok());
    assert!(matches!(a.get(moved), Err(CoreError::WrongDocument { .. })));
    assert!(matches!(
        a.character_data(text),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
    assert!(matches!(
        a.split_text(text, 0),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}

// ---- clone family over the extended types ----

#[test]
fn clone_import_and_adopt_copy_processing_instruction_payload() {
    let mut source = Document::new();
    let mut target = Document::new();
    let pi = source
        .create_processing_instruction("xml-stylesheet", "href=x")
        .unwrap();

    // Same-document clone copies the payload by value into a fresh handle.
    let cloned = source.clone_node(pi, false).unwrap();
    assert_ne!(cloned, pi);
    assert!(source.get(cloned).is_ok());
    assert_eq!(
        source.node_type(cloned).unwrap(),
        NodeType::ProcessingInstruction
    );
    assert_eq!(source.node_name(cloned).unwrap(), "xml-stylesheet");
    assert_eq!(
        source.processing_instruction_target(cloned).unwrap(),
        Some("xml-stylesheet")
    );
    assert_eq!(source.character_data(cloned).unwrap(), Some("href=x"));

    let imported = target.import_node(&source, pi, false).unwrap();
    assert_ne!(imported, pi);
    assert!(target.get(imported).is_ok());
    assert!(matches!(
        source.get(imported),
        Err(CoreError::WrongDocument { .. })
    ));
    assert_eq!(target.character_data(imported).unwrap(), Some("href=x"));
    assert_eq!(
        source.character_data(pi).unwrap(),
        Some("href=x"),
        "source untouched"
    );

    let adopted = target.adopt_node(&mut source, pi).unwrap();
    assert_ne!(adopted, pi);
    assert!(target.get(adopted).is_ok());
    assert!(matches!(
        source.get(adopted),
        Err(CoreError::WrongDocument { .. })
    ));
    assert_eq!(target.character_data(adopted).unwrap(), Some("href=x"));
    assert!(
        matches!(source.get(pi), Err(CoreError::Arena(_))),
        "the adopted source handle becomes stale"
    );
}

#[test]
fn clone_and_import_copy_doctype_payload() {
    let mut source = Document::new();
    source
        .load_html("<!DOCTYPE html PUBLIC \"pub\" \"sys\"><html></html>")
        .unwrap();
    let mut target = Document::new();
    let dt = source.doctype().unwrap().unwrap();

    let cloned = source.clone_node(dt, false).unwrap();
    assert_eq!(source.node_type(cloned).unwrap(), NodeType::DocumentType);
    assert_eq!(source.node_name(cloned).unwrap(), "html");
    assert_eq!(
        source.doctype_payload(cloned).unwrap(),
        Some(("html".to_string(), "pub".to_string(), "sys".to_string()))
    );

    let imported = target.import_node(&source, dt, false).unwrap();
    assert_eq!(
        target.doctype_payload(imported).unwrap(),
        Some(("html".to_string(), "pub".to_string(), "sys".to_string()))
    );
}
