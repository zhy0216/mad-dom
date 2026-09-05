//! html5ever `TreeSink` adapter that parses straight into a [`Document`] arena.
//!
//! This is the tokenizer / tree-builder adapter of T26. Every `TreeSink`
//! callback allocates its node into the owning [`Document`]'s arena and links
//! it with the document's own tree relations, so the arena holds *the* parsed
//! tree the moment `finish` runs — there is never a second, parser-owned DOM
//! that would have to be copied or converted afterwards.
//!
//! # Why the parser does not go through the public mutation API
//!
//! Two of the mutation API's guarantees are deliberately not usable here:
//!
//! * the API rejects `Document`-kind nodes as parents, but the tree builder
//!   appends the doctype and the `<html>` element to the document node;
//! * every mutation re-checks the invariants over the whole reachable subtree
//!   in debug builds, which would make each append linear in the tree size and
//!   parsing quadratic — unacceptable for the large-document resource budget.
//!
//! So the sink links relations with the same O(1) primitive the mutation API
//! uses internally ([`Document::detach`] plus direct relation-field writes),
//! and the caller verifies the completed tree once with
//! [`Document::check_invariants`].
//!
//! # Doctype, namespaces and element flags
//!
//! * the doctype is stored as a [`NodeData::DocumentType`] node under the
//!   document root;
//! * elements carry their namespace URI (HTML / SVG / MathML) and the two
//!   HTML5 `ElementFlags` the tree builder needs back
//!   ([`NodeData::element_mathml_integration_point`] feeds
//!   `is_mathml_annotation_xml_integration_point`, so the `annotation-xml`
//!   integration point is honoured at the MathML/HTML boundary);
//! * attribute names are stored as their *qualified* name (prefix + `:` +
//!   local when prefixed), which is the name `get_attribute` looks up.
//!
//! # Scope simplifications
//!
//! * `create_pi` is unreachable in HTML parsing — the tokenizer treats
//!   `<?...?>` as a bogus comment — so it falls back to an empty comment to
//!   keep the trait implementation total.
//!
//! # Fragment mode (T27)
//!
//! The sink is parameterised over its parse mode ([`SinkMode`]) so the single
//! `TreeSink` implementation serves both the document parser (T26) and the
//! fragment parser (T27) with distinct output types. Since T40 both modes give
//! every `<template>` element its HTML5 template-contents `DocumentFragment`
//! and record the association in [`HtmlSink::template_contents`], so
//! [`TreeSink::get_template_contents`] routes a `<template>`'s content into its
//! own `DocumentFragment` exactly like the browser (the T26 shortcut of parsing
//! template content as ordinary children is gone).

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;

use html5ever::tendril::StrTendril;
use html5ever::tree_builder::{ElemName, ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::{Attribute, LocalName, Namespace, QualName};

use crate::arena::NodeId;
use crate::dom::Document;
use crate::dom::NodeData;

use super::fragment::ParsedFragment;
use super::ParsedDocument;

/// Output-mode selector for [`HtmlSink`].
///
/// The marker types [`DocumentMode`] and [`FragmentMode`] select which payload
/// [`TreeSink::finish`] extracts from a finished sink. The marker is public
/// only because it appears in the public [`HtmlSink`] type parameter; callers
/// never construct it.
pub trait SinkMode: Sized + 'static {
    /// The parse output produced by [`TreeSink::finish`].
    type Output;

    /// Extracts the mode-specific output from a finished sink.
    fn finish(sink: HtmlSink<Self>) -> Self::Output;
}

/// Marker selecting full-document parsing ([`ParsedDocument`]).
pub enum DocumentMode {}

/// Marker selecting context-based fragment parsing ([`ParsedFragment`]).
pub enum FragmentMode {}

impl SinkMode for DocumentMode {
    type Output = ParsedDocument;

    fn finish(sink: HtmlSink<Self>) -> Self::Output {
        let mut document = sink.document.into_inner();
        let template_contents = sink.template_contents.into_inner();
        // Link every `<template>` to its contents fragment in the document map
        // (T40), so serialization and clone/import see the content even on a
        // raw parse (before any adoption runs).
        for &(template, contents) in &template_contents {
            document.set_template_content(template, contents);
        }
        ParsedDocument {
            document,
            root: sink.root,
            parse_errors: sink.parse_errors.into_inner(),
            quirks_mode: sink.quirks_mode.get(),
            template_contents,
        }
    }
}

impl SinkMode for FragmentMode {
    type Output = ParsedFragment;

    fn finish(sink: HtmlSink<Self>) -> Self::Output {
        let mut document = sink.document.into_inner();
        let template_contents = sink.template_contents.into_inner();
        for &(template, contents) in &template_contents {
            document.set_template_content(template, contents);
        }
        // html5ever's fragment parsing builds the tree under the temporary
        // root `<html>` element (`create_root`), which is the document node's
        // first child; its children are the parsed fragment.
        let root = document
            .first_child(sink.root)
            .expect("fragment root is readable")
            .expect("fragment parsing appends the temporary root html element");
        let nodes = document
            .children(root)
            .expect("fragment root is a live node of the target document");
        ParsedFragment {
            document,
            document_root: sink.root,
            root,
            nodes,
            template_contents,
            parse_errors: sink.parse_errors.into_inner(),
        }
    }
}

/// The `TreeSink` whose arena is the parse target.
///
/// `html5ever 0.39`'s `TreeSink` methods are all `&self`, so the sink holds the
/// [`Document`] and the collected diagnostics behind interior mutability and
/// exposes them through [`TreeSink::finish`].
pub struct HtmlSink<M: SinkMode = DocumentMode> {
    document: RefCell<Document>,
    /// The `Document`-kind node that is the root of the parsed tree. Slot
    /// allocations by the parser start after it.
    root: NodeId,
    parse_errors: RefCell<Vec<String>>,
    quirks_mode: Cell<QuirksMode>,
    /// Every `template element -> its template-contents DocumentFragment`,
    /// recorded by [`TreeSink::create_element`] in both parse modes (T40).
    template_contents: RefCell<Vec<(NodeId, NodeId)>>,
    mode: PhantomData<M>,
}

impl HtmlSink<DocumentMode> {
    /// Creates a fresh document-mode sink owning a new [`Document`] and its
    /// document root.
    pub fn new() -> Self {
        let mut document = Document::new();
        let root = document.document_root();
        Self {
            document: RefCell::new(document),
            root,
            parse_errors: RefCell::new(Vec::new()),
            quirks_mode: Cell::new(QuirksMode::NoQuirks),
            template_contents: RefCell::new(Vec::new()),
            mode: PhantomData,
        }
    }
}

impl HtmlSink<FragmentMode> {
    /// Creates a fresh fragment-mode sink owning a new [`Document`], its
    /// document root and the fragment-parse state.
    pub fn for_fragment() -> Self {
        let mut document = Document::new();
        let root = document.document_root();
        Self {
            document: RefCell::new(document),
            root,
            parse_errors: RefCell::new(Vec::new()),
            quirks_mode: Cell::new(QuirksMode::NoQuirks),
            template_contents: RefCell::new(Vec::new()),
            mode: PhantomData,
        }
    }
}

impl Default for HtmlSink<DocumentMode> {
    fn default() -> Self {
        Self::new()
    }
}

/// The element-name view the tree builder compares against its interned atoms.
///
/// The arena cannot lend out references through a `NodeId` (the data lives
/// behind a `RefCell`), so this holds owned clones of the name atoms — cloning
/// a string-cache atom is a cheap reference-count bump and never lets a
/// `RefCell` borrow escape a method.
#[derive(Debug, Clone)]
pub struct HtmlElemName {
    ns: Namespace,
    local: LocalName,
}

impl ElemName for HtmlElemName {
    fn ns(&self) -> &Namespace {
        &self.ns
    }

    fn local_name(&self) -> &LocalName {
        &self.local
    }
}

impl<M: SinkMode> TreeSink for HtmlSink<M> {
    type Handle = NodeId;
    type Output = M::Output;
    type ElemName<'a> = HtmlElemName;

    fn finish(self) -> Self::Output {
        M::finish(self)
    }

    fn parse_error(&self, msg: Cow<'static, str>) {
        self.parse_errors.borrow_mut().push(msg.into_owned());
    }

    fn get_document(&self) -> Self::Handle {
        self.root
    }

    fn elem_name<'a>(&'a self, target: &'a Self::Handle) -> Self::ElemName<'a> {
        let doc = self.document.borrow();
        match doc.get(*target).expect("live element").data() {
            NodeData::Element {
                name, namespace, ..
            } => HtmlElemName {
                ns: namespace.clone(),
                local: name.clone(),
            },
            _ => panic!("elem_name called on a non-element node"),
        }
    }

    fn create_element(
        &self,
        name: QualName,
        attrs: Vec<Attribute>,
        flags: ElementFlags,
    ) -> Self::Handle {
        let node = {
            let mut doc = self.document.borrow_mut();
            let attributes = attrs
                .into_iter()
                .map(|a| (qualified_name(&a.name), a.value.to_string()))
                .collect();
            doc.allocate_node(NodeData::Element {
                name: name.local,
                namespace: name.ns,
                attributes,
                mathml_annotation_xml_integration_point: flags
                    .mathml_annotation_xml_integration_point,
                had_duplicate_attributes: flags.had_duplicate_attributes,
            })
        };
        if flags.template {
            // HTML5 template contents (T40): every `<template>` element — in
            // both parse modes — gets its own template-contents
            // DocumentFragment, and the association is recorded so
            // get_template_contents routes into it and the T29 apply adoption
            // can link it to the element.
            let contents = self
                .document
                .borrow_mut()
                .allocate_node(NodeData::DocumentFragment);
            self.template_contents.borrow_mut().push((node, contents));
        }
        node
    }

    fn create_comment(&self, text: StrTendril) -> Self::Handle {
        self.document.borrow_mut().allocate_node(NodeData::Comment {
            data: text.to_string(),
        })
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> Self::Handle {
        // Unreachable in HTML parsing: the HTML tokenizer turns `<?...?>` into
        // a bogus comment. Kept total so the trait implementation covers every
        // callback.
        self.document.borrow_mut().allocate_node(NodeData::Comment {
            data: String::new(),
        })
    }

    fn append(&self, parent: &Self::Handle, child: NodeOrText<Self::Handle>) {
        let mut doc = self.document.borrow_mut();
        match child {
            NodeOrText::AppendText(text) => {
                if !append_text_to_last_child(&mut doc, *parent, &text) {
                    let node = doc.allocate_node(NodeData::Text {
                        data: text.to_string(),
                    });
                    attach_last_child(&mut doc, *parent, node);
                }
            }
            NodeOrText::AppendNode(node) => attach_last_child(&mut doc, *parent, node),
        }
    }

    fn append_based_on_parent_node(
        &self,
        element: &Self::Handle,
        prev_element: &Self::Handle,
        child: NodeOrText<Self::Handle>,
    ) {
        // Foster parenting (html5ever `InsertionPoint` contract): when
        // `element` has a parent the child goes before it, otherwise it is
        // appended to `prev_element`'s children.
        let has_parent = self
            .document
            .borrow()
            .get(*element)
            .expect("live element")
            .parent()
            .is_some();
        if has_parent {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev_element, child);
        }
    }

    fn append_doctype_to_document(
        &self,
        name: StrTendril,
        public_id: StrTendril,
        system_id: StrTendril,
    ) {
        let mut doc = self.document.borrow_mut();
        let doctype = doc.allocate_node(NodeData::DocumentType {
            name: name.to_string(),
            public_id: public_id.to_string(),
            system_id: system_id.to_string(),
        });
        attach_last_child(&mut doc, self.root, doctype);
    }

    fn get_template_contents(&self, target: &Self::Handle) -> Self::Handle {
        // T40: every `<template>` element gets its HTML5 template-contents
        // DocumentFragment (recorded at create_element time) in both parse
        // modes, so template content is routed into the fragment exactly like
        // the browser.
        if let Some(&(_, contents)) = self
            .template_contents
            .borrow()
            .iter()
            .find(|(element, _)| element == target)
        {
            return contents;
        }
        *target
    }

    fn same_node(&self, x: &Self::Handle, y: &Self::Handle) -> bool {
        x == y
    }

    fn set_quirks_mode(&self, mode: QuirksMode) {
        self.quirks_mode.set(mode);
    }

    fn append_before_sibling(&self, sibling: &Self::Handle, new_node: NodeOrText<Self::Handle>) {
        let mut doc = self.document.borrow_mut();
        let sibling = *sibling;
        match new_node {
            NodeOrText::AppendNode(node) => {
                // NB: `node` may already have a parent (it is being moved);
                // detach it before locating the insertion point so the old
                // links cannot shift the position.
                doc.detach(node);
                insert_before_handle(&mut doc, sibling, node);
            }
            NodeOrText::AppendText(text) => {
                // The TreeSink contract: merge with the text node that will
                // become the new node's previous sibling, if there is one.
                // (The sibling is guaranteed to have a parent; the access below
                // doubles as the assertion.)
                doc.get(sibling)
                    .expect("live sibling")
                    .parent()
                    .expect("sibling must have a parent");
                let prev = doc.get(sibling).expect("live sibling").previous_sibling();
                if let Some(prev) = prev {
                    if append_text_to_node(&mut doc, prev, &text) {
                        return;
                    }
                }
                let node = doc.allocate_node(NodeData::Text {
                    data: text.to_string(),
                });
                insert_before_handle(&mut doc, sibling, node);
            }
        }
    }

    fn add_attrs_if_missing(&self, target: &Self::Handle, attrs: Vec<Attribute>) {
        let mut doc = self.document.borrow_mut();
        let mut changed = false;
        {
            let Ok(attributes) = doc.element_attributes_mut(*target) else {
                return;
            };
            for attr in attrs {
                let name = qualified_name(&attr.name);
                if !attributes.iter().any(|(n, _)| n == &name) {
                    attributes.push((name, attr.value.to_string()));
                    changed = true;
                }
            }
        }
        if changed {
            doc.bump_attribute_generation();
        }
    }

    fn remove_from_parent(&self, target: &Self::Handle) {
        self.document.borrow_mut().detach(*target);
    }

    fn reparent_children(&self, node: &Self::Handle, new_parent: &Self::Handle) {
        let mut doc = self.document.borrow_mut();
        let children = doc.children(*node).expect("live node");
        for child in children {
            attach_last_child(&mut doc, *new_parent, child);
        }
    }

    fn is_mathml_annotation_xml_integration_point(&self, handle: &Self::Handle) -> bool {
        self.document
            .borrow()
            .get(*handle)
            .ok()
            .and_then(|n| n.data().element_mathml_integration_point())
            .unwrap_or(false)
    }
}

/// Rebuilds the qualified name of `name` as it appears in markup: `prefix:local`
/// when the element carries a prefix, otherwise the bare local name.
///
/// Attribute names are stored this way so `get_attribute`'s byte-for-byte name
/// lookup sees the same string the author wrote.
fn qualified_name(name: &QualName) -> String {
    match &name.prefix {
        Some(prefix) => format!("{prefix}:{}", name.local),
        None => name.local.to_string(),
    }
}

/// Appends `text` to the existing last text child of `parent`, if any.
///
/// Returns `true` when the text was merged, `false` when `parent` has no text
/// child as its last child (the caller then allocates a fresh text node).
fn append_text_to_last_child(doc: &mut Document, parent: NodeId, text: &str) -> bool {
    let Some(last) = doc.get(parent).expect("live parent").last_child() else {
        return false;
    };
    append_text_to_node(doc, last, text)
}

/// Appends `text` to the text node `node`, if it is one. Returns whether the
/// merge happened.
fn append_text_to_node(doc: &mut Document, node: NodeId, text: &str) -> bool {
    match doc.node_mut(node).expect("live node").data_mut() {
        NodeData::Text { data } => {
            data.push_str(text);
            true
        }
        _ => false,
    }
}

/// Attaches `child` as the last child of `parent`, detaching it from any
/// previous parent first. O(1); the relation fields are linked directly so the
/// parser does not pay the mutation API's per-call invariant re-check.
///
/// `pub(crate)` so the T29 HTML apply path ([`super::apply`]) reuses the same
/// O(1) primitive when it rebuilds document structure (skeleton / `load_html`)
/// under a `Document`-kind node, which the public mutation API rejects as a
/// parent.
pub(crate) fn attach_last_child(doc: &mut Document, parent: NodeId, child: NodeId) {
    debug_assert_ne!(parent, child);
    doc.detach(child);
    // Structural generation: parser/apply link primitive (a relation-write
    // site; see `Document::structure_generation`). `detach` above bumped for
    // the unlink; this bump covers the new link itself.
    doc.bump_structure_generation();
    let last = doc.get(parent).expect("live parent").last_child();
    {
        let n = doc.node_mut(child).expect("live child");
        n.parent = Some(parent);
        n.previous_sibling = last;
    }
    match last {
        Some(l) => {
            doc.node_mut(l).expect("live sibling").next_sibling = Some(child);
        }
        None => {
            doc.node_mut(parent).expect("live parent").first_child = Some(child);
        }
    }
    doc.node_mut(parent).expect("live parent").last_child = Some(child);
}

/// Inserts the already-detached `child` immediately before `sibling`.
fn insert_before_handle(doc: &mut Document, sibling: NodeId, child: NodeId) {
    debug_assert_ne!(sibling, child);
    // Structural generation: parser link primitive (a relation-write site;
    // see `Document::structure_generation`).
    doc.bump_structure_generation();
    let parent = doc
        .get(sibling)
        .expect("live sibling")
        .parent()
        .expect("sibling must have a parent");
    let prev = doc.get(sibling).expect("live sibling").previous_sibling();
    {
        let n = doc.node_mut(child).expect("live child");
        n.parent = Some(parent);
        n.previous_sibling = prev;
        n.next_sibling = Some(sibling);
    }
    match prev {
        Some(p) => {
            doc.node_mut(p).expect("live sibling").next_sibling = Some(child);
        }
        None => {
            doc.node_mut(parent).expect("live parent").first_child = Some(child);
        }
    }
    doc.node_mut(sibling)
        .expect("live sibling")
        .previous_sibling = Some(child);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::NodeData;

    /// Returns the child ids of `parent` in document order.
    fn child_ids(doc: &Document, parent: NodeId) -> Vec<NodeId> {
        doc.children(parent).unwrap()
    }

    /// Creates a fresh detached element named `local`.
    fn element(doc: &mut Document, local: &str) -> NodeId {
        doc.allocate_node(NodeData::Element {
            name: LocalName::from(local.to_string()),
            namespace: Namespace::from(crate::dom::HTML_NAMESPACE),
            attributes: Vec::new(),
            mathml_annotation_xml_integration_point: false,
            had_duplicate_attributes: false,
        })
    }

    #[test]
    fn attach_last_child_links_and_relinks() {
        let mut doc = Document::new();
        let root = doc.allocate_node(NodeData::Document);
        let a = element(&mut doc, "a");
        let b = element(&mut doc, "b");
        let c = element(&mut doc, "c");

        attach_last_child(&mut doc, root, a);
        attach_last_child(&mut doc, root, b);
        attach_last_child(&mut doc, root, c);
        assert_eq!(child_ids(&doc, root), vec![a, b, c]);
        assert_eq!(doc.parent(b).unwrap(), Some(root));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(b));
        assert_eq!(doc.next_sibling(a).unwrap(), Some(b));

        // Moving `a` to the end detaches it from the front and relinks the gap.
        attach_last_child(&mut doc, root, a);
        assert_eq!(child_ids(&doc, root), vec![b, c, a]);
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(b));
        assert_eq!(doc.next_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.next_sibling(a).unwrap(), None);
        assert_eq!(doc.first_child(root).unwrap(), Some(b));
        assert_eq!(doc.last_child(root).unwrap(), Some(a));
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn insert_before_handle_links_between_siblings() {
        let mut doc = Document::new();
        let root = doc.allocate_node(NodeData::Document);
        let a = element(&mut doc, "a");
        let b = element(&mut doc, "b");
        let c = element(&mut doc, "c");
        attach_last_child(&mut doc, root, a);
        attach_last_child(&mut doc, root, b);

        // Insert `c` between a and b.
        insert_before_handle(&mut doc, b, c);
        assert_eq!(child_ids(&doc, root), vec![a, c, b]);
        assert_eq!(doc.next_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(c));

        // Insert before the first child updates first_child.
        let z = element(&mut doc, "z");
        insert_before_handle(&mut doc, a, z);
        assert_eq!(child_ids(&doc, root), vec![z, a, c, b]);
        assert_eq!(doc.first_child(root).unwrap(), Some(z));
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn append_merges_adjacent_text_nodes() {
        let mut doc = Document::new();
        let root = doc.allocate_node(NodeData::Document);

        // First text allocates a node; the second merges into it.
        let first = doc.allocate_node(NodeData::Text {
            data: "ab".to_string(),
        });
        attach_last_child(&mut doc, root, first);
        assert!(append_text_to_last_child(&mut doc, root, "cd"));
        assert_eq!(child_ids(&doc, root).len(), 1);
        assert_eq!(
            doc.get(child_ids(&doc, root)[0])
                .unwrap()
                .data()
                .text_data(),
            Some("abcd")
        );

        // A non-text last child does not merge, so a fresh node is created.
        let tag = element(&mut doc, "span");
        attach_last_child(&mut doc, root, tag);
        assert!(!append_text_to_last_child(&mut doc, root, "x"));
        assert_eq!(child_ids(&doc, root).len(), 2);
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn sink_collects_quirks_mode_and_parse_errors() {
        // No doctype -> quirks; malformed markup still produces a tree and the
        // non-fatal diagnostics are collected.
        let mut doc = Document::new();
        let root = doc.allocate_node(NodeData::Document);
        let sink: HtmlSink<DocumentMode> = HtmlSink {
            document: RefCell::new(doc),
            root,
            parse_errors: RefCell::new(Vec::new()),
            quirks_mode: Cell::new(QuirksMode::NoQuirks),
            template_contents: RefCell::new(Vec::new()),
            mode: PhantomData,
        };
        sink.set_quirks_mode(QuirksMode::Quirks);
        sink.parse_error(Cow::Borrowed("stray end tag"));
        sink.parse_error(Cow::Borrowed("unexpected token"));
        assert_eq!(sink.quirks_mode.get(), QuirksMode::Quirks);
        assert_eq!(
            sink.parse_errors.into_inner(),
            vec!["stray end tag".to_string(), "unexpected token".to_string()]
        );
    }
}
