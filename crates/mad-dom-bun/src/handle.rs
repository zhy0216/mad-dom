//! Document and node handles: the opaque JS objects that cross the native
//! boundary.
//!
//! # Shape of a handle
//!
//! A [`NodeHandle`] is the "绑定对象" fixed by ADR-0001 §3 and milestone M3:
//! it stores a Core [`NodeId`] (opaque — never fabricated or decomposed here)
//! plus a document ownership reference ([`SharedDocument`]), so any reachable
//! node wrapper keeps its document's arena alive. It never stores a raw
//! pointer into the arena.
//!
//! A [`DocumentHandle`] hosts the live Core [`Document`]: it holds the strong
//! [`Arc`] that node handles clone, so dropping the last handle (document or
//! node) drops the Core document and its arena.
//!
//! # Safety preconditions (this module is FFI surface)
//!
//! * Every `#[napi]` method is marked `#[napi(catch_unwind)]`, so a Rust panic
//!   cannot unwind across the Node-API boundary (crate safety model).
//! * All tree reads and writes delegate to Core. This module never re-
//!   implements a DOM rule and keeps no second copy of tree state.
//! * A [`NodeId`] extracted from a node handle is only passed back to the Core
//!   document that created it; Core rejects foreign or stale handles with a
//!   structured error before any memory is touched.
//! * The [`Mutex`] is never left poisoned: a poisoned lock is recovered with
//!   [`Mutex::into_inner`], so a panicking entry cannot wedge a document.
//!
//! No `unsafe` is written in this module; FFI/unsafe is confined to the `napi`
//! crates.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};
use napi::Env;
use napi_derive::napi;

use crate::error::BindingError;

/// Number of documents currently alive (created minus destroyed / collected).
static LIVE_DOCUMENT_COUNT: AtomicU64 = AtomicU64::new(0);

/// Returns [`LIVE_DOCUMENT_COUNT`]. Diagnostic for the GC and destroy smoke
/// tests.
pub(crate) fn live_document_count() -> u64 {
    LIVE_DOCUMENT_COUNT.load(Ordering::SeqCst)
}

/// Wraps the Core [`Document`] so its drop is observable through
/// [`LIVE_DOCUMENT_COUNT`].
struct LiveDocument {
    document: Document,
}

impl Drop for LiveDocument {
    fn drop(&mut self) {
        LIVE_DOCUMENT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Shared document state behind every handle.
///
/// `None` once the document has been explicitly destroyed, which eagerly drops
/// the Core [`Document`] and its arena while node handles may still be alive.
struct SharedDocument {
    document: Mutex<Option<LiveDocument>>,
}

/// Runs `f` against the live Core document, or reports
/// [`BindingError::Destroyed`] once the document has been destroyed.
///
/// A poisoned lock (a panicking entry that held the guard) is recovered with
/// [`Mutex::into_inner`] so the document stays usable instead of wedging.
fn with_document<T>(
    shared: &Arc<SharedDocument>,
    f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
) -> std::result::Result<T, BindingError> {
    let mut guard = shared
        .document
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match guard.as_mut() {
        None => Err(BindingError::Destroyed),
        Some(live) => f(&mut live.document),
    }
}

/// Maps a Core [`NodeType`] to the WHATWG `Node.nodeType` number.
///
/// Pure value conversion (the binding's job); no DOM rule is implemented here.
pub(crate) fn node_type_value(node_type: NodeType) -> u32 {
    match node_type {
        NodeType::Element => 1,
        NodeType::Text => 3,
        NodeType::Comment => 8,
        NodeType::Document => 9,
        NodeType::DocumentFragment => 11,
    }
}

/// JavaScript-facing wrapper for a live Core [`Document`].
///
/// Constructed only from Rust (`create_document`); there is no public
/// constructor, so JavaScript receives it as an opaque handle.
#[napi]
pub struct DocumentHandle {
    shared: Arc<SharedDocument>,
}

impl DocumentHandle {
    /// Creates a fresh document with its own arena and bumps the live count.
    pub(crate) fn new() -> Self {
        LIVE_DOCUMENT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            shared: Arc::new(SharedDocument {
                document: Mutex::new(Some(LiveDocument {
                    document: Document::new(),
                })),
            }),
        }
    }

    /// Runs `f` against this document, mapping lifecycle failures.
    fn run<T>(
        &self,
        f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
    ) -> std::result::Result<T, BindingError> {
        with_document(&self.shared, f)
    }

    /// Builds a fresh node handle sharing this document's ownership.
    fn node_handle(&self, id: NodeId) -> NodeHandle {
        NodeHandle {
            shared: Arc::clone(&self.shared),
            id,
        }
    }

    // --- pure helpers (tested without a JS runtime) ---

    pub(crate) fn create_element_inner(
        &self,
        name: &str,
    ) -> std::result::Result<NodeHandle, BindingError> {
        self.run(|doc| {
            doc.create_element(name)
                .map(|id| self.node_handle(id))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn create_text_inner(
        &self,
        data: &str,
    ) -> std::result::Result<NodeHandle, BindingError> {
        self.run(|doc| {
            doc.create_text(data)
                .map(|id| self.node_handle(id))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn create_comment_inner(
        &self,
        data: &str,
    ) -> std::result::Result<NodeHandle, BindingError> {
        self.run(|doc| {
            doc.create_comment(data)
                .map(|id| self.node_handle(id))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn create_document_fragment_inner(
        &self,
    ) -> std::result::Result<NodeHandle, BindingError> {
        self.run(|doc| {
            doc.create_document_fragment()
                .map(|id| self.node_handle(id))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn append_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.append_child(parent.id, child.id)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn insert_before_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
        reference: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.insert_before(parent.id, child.id, reference.id)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn remove_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.remove_child(parent.id, child.id)
                .map(|_| ())
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn replace_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
        node: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.replace_child(parent.id, child.id, node.id)
                .map(|_| ())
                .map_err(BindingError::Core)
        })
    }

    /// Destroys the document eagerly, dropping its arena. Node handles keep
    /// their `Arc`, but every further operation fails with
    /// [`BindingError::Destroyed`].
    pub(crate) fn destroy_inner(&self) {
        let mut guard = self
            .shared
            .document
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
    }
}

#[napi]
impl DocumentHandle {
    #[napi(catch_unwind)]
    pub fn create_element(&self, env: Env, name: String) -> napi::Result<NodeHandle> {
        self.create_element_inner(&name)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn create_text(&self, env: Env, data: String) -> napi::Result<NodeHandle> {
        self.create_text_inner(&data)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn create_comment(&self, env: Env, data: String) -> napi::Result<NodeHandle> {
        self.create_comment_inner(&data)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn create_document_fragment(&self, env: Env) -> napi::Result<NodeHandle> {
        self.create_document_fragment_inner()
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn append_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> napi::Result<()> {
        self.append_child_inner(parent, child)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn insert_before(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
        reference: &NodeHandle,
    ) -> napi::Result<()> {
        self.insert_before_inner(parent, child, reference)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn remove_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> napi::Result<()> {
        self.remove_child_inner(parent, child)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn replace_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
        node: &NodeHandle,
    ) -> napi::Result<()> {
        self.replace_child_inner(parent, child, node)
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn destroy(&self) {
        self.destroy_inner();
    }
}

/// JavaScript-facing opaque wrapper for a Core node.
///
/// Stores the Core [`NodeId`] and a document ownership reference — never a raw
/// pointer. No wrapper cache exists yet (T20); every access constructs a fresh
/// JS object, so two `NodeHandle`s for the same node compare by identity only.
#[napi]
pub struct NodeHandle {
    shared: Arc<SharedDocument>,
    id: NodeId,
}

impl NodeHandle {
    /// Runs `f` against the owning document, mapping lifecycle failures.
    fn run<T>(
        &self,
        f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
    ) -> std::result::Result<T, BindingError> {
        with_document(&self.shared, f)
    }

    /// Builds a fresh handle to `id` under the same document ownership.
    fn wrap(&self, id: NodeId) -> NodeHandle {
        NodeHandle {
            shared: Arc::clone(&self.shared),
            id,
        }
    }

    // --- pure helpers (tested without a JS runtime) ---

    pub(crate) fn node_type_inner(&self) -> std::result::Result<u32, BindingError> {
        self.run(|doc| {
            doc.node_type(self.id)
                .map(node_type_value)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn node_name_inner(&self) -> std::result::Result<String, BindingError> {
        self.run(|doc| {
            doc.node_name(self.id)
                .map(str::to_owned)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn parent_node_inner(
        &self,
    ) -> std::result::Result<Option<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.parent(self.id)
                .map(|opt| opt.map(|id| self.wrap(id)))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn first_child_inner(
        &self,
    ) -> std::result::Result<Option<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.first_child(self.id)
                .map(|opt| opt.map(|id| self.wrap(id)))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn last_child_inner(&self) -> std::result::Result<Option<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.last_child(self.id)
                .map(|opt| opt.map(|id| self.wrap(id)))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn previous_sibling_inner(
        &self,
    ) -> std::result::Result<Option<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.previous_sibling(self.id)
                .map(|opt| opt.map(|id| self.wrap(id)))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn next_sibling_inner(
        &self,
    ) -> std::result::Result<Option<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.next_sibling(self.id)
                .map(|opt| opt.map(|id| self.wrap(id)))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn child_nodes_inner(&self) -> std::result::Result<Vec<NodeHandle>, BindingError> {
        self.run(|doc| {
            doc.children(self.id)
                .map(|ids| ids.into_iter().map(|id| self.wrap(id)).collect())
                .map_err(BindingError::Core)
        })
    }
}

#[napi]
impl NodeHandle {
    #[napi(catch_unwind)]
    pub fn node_type(&self, env: Env) -> napi::Result<u32> {
        self.node_type_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn node_name(&self, env: Env) -> napi::Result<String> {
        self.node_name_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn parent_node(&self, env: Env) -> napi::Result<Option<NodeHandle>> {
        self.parent_node_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn first_child(&self, env: Env) -> napi::Result<Option<NodeHandle>> {
        self.first_child_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn last_child(&self, env: Env) -> napi::Result<Option<NodeHandle>> {
        self.last_child_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn previous_sibling(&self, env: Env) -> napi::Result<Option<NodeHandle>> {
        self.previous_sibling_inner()
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn next_sibling(&self, env: Env) -> napi::Result<Option<NodeHandle>> {
        self.next_sibling_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn child_nodes(&self, env: Env) -> napi::Result<Vec<NodeHandle>> {
        self.child_nodes_inner().map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The live-document counter is process-global, so every test that creates
    /// a [`DocumentHandle`] must run exclusively against the others. Serialize
    /// them with a shared test mutex to keep the counter assertions
    /// deterministic.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn live_before() -> u64 {
        live_document_count()
    }

    #[test]
    fn create_and_destroy_tracks_live_documents() {
        let _guard = lock();
        let before = live_before();
        {
            let doc = DocumentHandle::new();
            assert_eq!(live_document_count(), before + 1);
            doc.destroy_inner();
            assert_eq!(live_document_count(), before, "destroy drops the document");
        }
        assert_eq!(
            live_document_count(),
            before,
            "drop after destroy is idempotent"
        );
    }

    #[test]
    fn dropping_last_handle_collects_document() {
        let _guard = lock();
        let before = live_before();
        {
            let _doc = DocumentHandle::new();
            assert_eq!(live_document_count(), before + 1);
        }
        assert_eq!(
            live_document_count(),
            before,
            "drop of last Arc drops the document"
        );
    }

    #[test]
    fn node_handle_keeps_document_alive() {
        let _guard = lock();
        let before = live_before();
        let node;
        {
            let doc = DocumentHandle::new();
            node = doc.create_element_inner("div").unwrap();
            assert_eq!(live_document_count(), before + 1);
        }
        assert_eq!(
            live_document_count(),
            before + 1,
            "a reachable node handle keeps its document alive"
        );
        drop(node);
        assert_eq!(
            live_document_count(),
            before,
            "dropping the node frees the document"
        );
    }

    #[test]
    fn create_element_returns_typed_node() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let el = doc.create_element_inner("div").unwrap();
        assert_eq!(el.node_type_inner().unwrap(), 1);
        assert_eq!(el.node_name_inner().unwrap(), "div");

        let text = doc.create_text_inner("hello").unwrap();
        assert_eq!(text.node_type_inner().unwrap(), 3);
        assert_eq!(text.node_name_inner().unwrap(), "#text");

        let comment = doc.create_comment_inner("note").unwrap();
        assert_eq!(comment.node_type_inner().unwrap(), 8);
        assert_eq!(comment.node_name_inner().unwrap(), "#comment");

        let frag = doc.create_document_fragment_inner().unwrap();
        assert_eq!(frag.node_type_inner().unwrap(), 11);
        assert_eq!(frag.node_name_inner().unwrap(), "#document-fragment");
    }

    #[test]
    fn append_and_navigation_roundtrip() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let parent = doc.create_element_inner("ul").unwrap();
        let a = doc.create_element_inner("li").unwrap();
        let b = doc.create_element_inner("li").unwrap();
        let text = doc.create_text_inner("first").unwrap();
        doc.append_child_inner(&a, &text).unwrap();
        doc.append_child_inner(&parent, &a).unwrap();
        doc.append_child_inner(&parent, &b).unwrap();

        assert_eq!(
            parent
                .first_child_inner()
                .unwrap()
                .unwrap()
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            parent
                .last_child_inner()
                .unwrap()
                .unwrap()
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            a.next_sibling_inner()
                .unwrap()
                .unwrap()
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            b.previous_sibling_inner()
                .unwrap()
                .unwrap()
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            a.parent_node_inner()
                .unwrap()
                .unwrap()
                .node_name_inner()
                .unwrap(),
            "ul"
        );
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 2);
        assert_eq!(a.child_nodes_inner().unwrap().len(), 1);
        assert!(parent.parent_node_inner().unwrap().is_none());
    }

    #[test]
    fn insert_remove_replace_roundtrip() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let parent = doc.create_element_inner("div").unwrap();
        let a = doc.create_element_inner("a").unwrap();
        let b = doc.create_element_inner("b").unwrap();
        let c = doc.create_element_inner("c").unwrap();
        doc.append_child_inner(&parent, &a).unwrap();
        doc.append_child_inner(&parent, &c).unwrap();
        doc.insert_before_inner(&parent, &b, &c).unwrap();
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 3);

        doc.remove_child_inner(&parent, &a).unwrap();
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 2);
        assert!(
            a.parent_node_inner().unwrap().is_none(),
            "removed node is detached"
        );

        let d = doc.create_element_inner("d").unwrap();
        doc.replace_child_inner(&parent, &b, &d).unwrap();
        let names: Vec<String> = parent
            .child_nodes_inner()
            .unwrap()
            .iter()
            .map(|n| n.node_name_inner().unwrap())
            .collect();
        assert_eq!(names, vec!["d", "c"]);
    }

    #[test]
    fn cross_document_handle_is_rejected() {
        let _guard = lock();
        let doc_a = DocumentHandle::new();
        let doc_b = DocumentHandle::new();
        let el = doc_a.create_element_inner("div").unwrap();
        let target = doc_b.create_element_inner("p").unwrap();

        let err = doc_b.append_child_inner(&target, &el).unwrap_err();
        assert!(matches!(
            err,
            BindingError::Core(mad_dom_core::error::CoreError::WrongDocument { .. })
        ));
    }

    #[test]
    fn destroyed_document_rejects_all_operations() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let el = doc.create_element_inner("div").unwrap();
        doc.destroy_inner();

        assert!(matches!(
            doc.create_element_inner("span"),
            Err(BindingError::Destroyed)
        ));
        assert!(matches!(el.node_name_inner(), Err(BindingError::Destroyed)));
        assert!(matches!(
            el.parent_node_inner(),
            Err(BindingError::Destroyed)
        ));
        assert!(matches!(
            doc.append_child_inner(&el, &el),
            Err(BindingError::Destroyed)
        ));
    }
}
