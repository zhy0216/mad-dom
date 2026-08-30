//! Shadow DOM ownership and slot assignment (T43).
//!
//! This module owns the Core half of the Shadow DOM surface: the per-document
//! `shadow host Element -> ShadowRoot` association
//! ([`Document::shadow_roots`]), `attachShadow` (open/closed mode), the
//! host/mode reads, and the *basic named slot assignment* behind
//! `HTMLSlotElement.assignedNodes` / `assignedElements`.
//!
//! # Ownership model (mirrors template contents, T40)
//!
//! A shadow root is a [`NodeData::ShadowRoot`] node allocated into the same
//! arena as every other node, but it is **not** a child of its host: the
//! `host -> root` map is the only link. Keeping it out of the host's child
//! list is what makes the query / traversal / serialization boundary
//! *structural* — ordinary navigation, `querySelector`, TreeWalker,
//! `innerHTML`/`outerHTML` and serialization walk the arena child list and can
//! never pierce into a shadow tree, so no boundary check needs to be sprinkled
//! through those code paths. The shadow root's own children are ordinary arena
//! children (its `parent` is `None` and its `first_child`/`last_child` point
//! at the shadow tree), so navigation *within* a shadow tree and mutation of a
//! shadow root (`appendChild`, `textContent`, `innerHTML`) work through the
//! unchanged mutation API.
//!
//! # Open / closed mode
//!
//! `attachShadow` records the [`ShadowRootMode`] on the root's payload.
//! [`Document::shadow_root`] returns the root for an `open` host only (a
//! `closed` host reads `null`, matching the WHATWG and happy-dom), while the
//! crate-internal id/mode reads let the binding and the event path inspect a
//! closed root without leaking it to a public surface.
//!
//! # Basic named slot assignment
//!
//! `assignedNodes` / `assignedElements` (the "named" assignment mode, the
//! default) compute the assignment *dynamically* from the host's current
//! children, exactly like happy-dom: a `<slot name="x">` is assigned the
//! host children whose `slot` attribute equals `x`, and a `<slot>` without a
//! `name` is assigned the host children without a `slot` attribute. `flatten`
//! recurses through nested `<slot>` elements. Manual `slotAssignment` and the
//! `slotchange` event are deliberately out of T43 scope (non-public internals).
//!
//! # Errors
//!
//! Every entry validates document ownership and arena liveness through the
//! shared [`Document`] navigation/attribute entries, so a foreign or stale
//! handle fails with [`CoreError::WrongDocument`] / [`CoreError::Arena`].
//! [`Document::attach_shadow`] rejects a non-`Element` host and a host that
//! already owns a shadow tree with [`CoreError::Hierarchy`].

use crate::arena::NodeId;
use crate::dom::NodeData;
use crate::error::CoreError;

use super::node::ShadowRootMode;
use super::{Document, NodeType, HTML_NAMESPACE};

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

impl Document {
    /// Creates a shadow root of `mode` for the `Element` host `host` and
    /// returns its handle.
    ///
    /// The shadow root is allocated into this document's arena and registered
    /// under `host` in the `shadow_roots` map; it is not a child of `host`, so
    /// ordinary navigation stays on the light side of the boundary.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale `host`.
    /// * [`CoreError::Hierarchy`] when `host` is not an `Element`, or when it
    ///   already owns a shadow tree.
    pub fn attach_shadow(
        &mut self,
        host: NodeId,
        mode: ShadowRootMode,
    ) -> Result<NodeId, CoreError> {
        if self.get(host)?.node_type() != NodeType::Element {
            return Err(hierarchy("attachShadow requires an Element host"));
        }
        if self.shadow_roots.contains_key(&host) {
            return Err(hierarchy(
                "Shadow root cannot be created on a host which already hosts a shadow tree.",
            ));
        }
        let root = self.allocate_node(NodeData::ShadowRoot { mode });
        self.shadow_roots.insert(host, root);
        Ok(root)
    }

    /// Returns whether the node for `id` is a shadow root.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_shadow_root(&self, id: NodeId) -> Result<bool, CoreError> {
        Ok(self.get(id)?.data().node_type() == NodeType::ShadowRoot)
    }

    /// Returns the shadow root of the `Element` host `host`, or `None` when it
    /// has none. An `open`-mode root is returned; a `closed`-mode root reads
    /// as `None` so a public read never leaks a closed tree.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `host`.
    pub fn shadow_root(&self, host: NodeId) -> Result<Option<NodeId>, CoreError> {
        match self.shadow_root_id(host)? {
            Some(root) if self.shadow_root_mode(root)? == Some(ShadowRootMode::Open) => {
                Ok(Some(root))
            }
            _ => Ok(None),
        }
    }

    /// Crate-internal: the registered shadow root of the host `host`,
    /// regardless of mode (used by the event path and the binding to inspect a
    /// closed tree without exposing it publicly).
    pub(crate) fn shadow_root_id(&self, host: NodeId) -> Result<Option<NodeId>, CoreError> {
        self.get(host)?;
        Ok(self.shadow_roots.get(&host).copied())
    }

    /// Returns the [`ShadowRootMode`] of the shadow root `root`, or `None`
    /// when the node is not a shadow root.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `root`.
    pub fn shadow_root_mode(&self, root: NodeId) -> Result<Option<ShadowRootMode>, CoreError> {
        match self.get(root)?.data() {
            NodeData::ShadowRoot { mode } => Ok(Some(*mode)),
            _ => Ok(None),
        }
    }

    /// Returns the host element of the shadow root `root`, or `None` when the
    /// node is not a shadow root (the reverse of the `host -> root` map).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `root`.
    pub fn shadow_host(&self, root: NodeId) -> Result<Option<NodeId>, CoreError> {
        self.get(root)?;
        Ok(self
            .shadow_roots
            .iter()
            .find_map(|(&host, &candidate)| (candidate == root).then_some(host)))
    }

    /// Crate-internal: whether any shadow root exists in this document. The
    /// cheap guard the connectivity and event paths use to skip the shadow
    /// lookups for documents that never use Shadow DOM.
    pub(crate) fn has_shadow_roots(&self) -> bool {
        !self.shadow_roots.is_empty()
    }

    /// Returns whether the node for `id` is an HTML-namespace `<slot>` element
    /// (the WHATWG `HTMLSlotElement` the assignment surface lives on).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_slot_element(&self, id: NodeId) -> Result<bool, CoreError> {
        match self.get(id)?.data() {
            NodeData::Element {
                name, namespace, ..
            } => {
                Ok(namespace.as_ref() == HTML_NAMESPACE
                    && name.as_ref().eq_ignore_ascii_case("slot"))
            }
            _ => Ok(false),
        }
    }

    /// The WHATWG `HTMLSlotElement.assignedNodes`: the host children assigned
    /// to the slot element `slot` under the default named assignment, in host
    /// document order.
    ///
    /// The assignment is computed live from the host's current children, so a
    /// later insertion/removal or a `slot`/`name` attribute change is picked up
    /// by the next read (happy-dom parity). `flatten` recursively includes the
    /// assigned nodes of nested `<slot>` elements. A node that is not an HTML
    /// `<slot>` element inside a shadow tree yields the empty list.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `slot`.
    pub fn slot_assigned_nodes(
        &self,
        slot: NodeId,
        flatten: bool,
    ) -> Result<Vec<NodeId>, CoreError> {
        let Some(host) = self.slot_host(slot)? else {
            return Ok(Vec::new());
        };
        let name = self.get_attribute(slot, "name")?.unwrap_or("").to_string();
        let mut assigned = Vec::new();
        for child in self.children(host)? {
            let slot_name = self.slot_name_of(child)?;
            let matches = if name.is_empty() {
                slot_name.is_empty()
            } else {
                !slot_name.is_empty() && slot_name == name
            };
            if !matches {
                continue;
            }
            if flatten && self.is_slot_element(child)? {
                assigned.extend(self.slot_assigned_nodes(child, true)?);
            } else {
                assigned.push(child);
            }
        }
        Ok(assigned)
    }

    /// The WHATWG `HTMLSlotElement.assignedElements`: like
    /// [`Document::slot_assigned_nodes`], but only element children.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `slot`.
    pub fn slot_assigned_elements(
        &self,
        slot: NodeId,
        flatten: bool,
    ) -> Result<Vec<NodeId>, CoreError> {
        let Some(host) = self.slot_host(slot)? else {
            return Ok(Vec::new());
        };
        let name = self.get_attribute(slot, "name")?.unwrap_or("").to_string();
        let mut assigned = Vec::new();
        for child in self.children(host)? {
            if self.get(child)?.node_type() != NodeType::Element {
                continue;
            }
            let slot_name = self.slot_name_of(child)?;
            let matches = if name.is_empty() {
                slot_name.is_empty()
            } else {
                !slot_name.is_empty() && slot_name == name
            };
            if !matches {
                continue;
            }
            if flatten && self.is_slot_element(child)? {
                assigned.extend(self.slot_assigned_elements(child, true)?);
            } else {
                assigned.push(child);
            }
        }
        Ok(assigned)
    }

    /// Resolves the shadow host of the shadow tree containing the slot element
    /// `slot`, or `None` when the node is not a `<slot>` inside a shadow tree.
    ///
    /// The root of a slot's parent chain is the shadow root (its `parent` is
    /// `None`); the host is the reverse lookup of that root.
    fn slot_host(&self, slot: NodeId) -> Result<Option<NodeId>, CoreError> {
        if !self.is_slot_element(slot)? {
            return Ok(None);
        }
        let mut cursor = slot;
        while let Some(parent) = self.get(cursor)?.parent() {
            cursor = parent;
        }
        if self.get(cursor)?.data().node_type() != NodeType::ShadowRoot {
            return Ok(None);
        }
        self.shadow_host(cursor)
    }

    /// The WHATWG `slot` attribute of a child, read safely: a non-element
    /// child (a `Text`/`Comment` node, which happy-dom reads as an empty slot
    /// name) yields the empty string instead of failing the attribute read.
    fn slot_name_of(&self, child: NodeId) -> Result<String, CoreError> {
        match self.get(child)?.data() {
            NodeData::Element { .. } => {
                Ok(self.get_attribute(child, "slot")?.unwrap_or("").to_string())
            }
            _ => Ok(String::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn children(doc: &Document, id: NodeId) -> Vec<NodeId> {
        doc.children(id).unwrap()
    }

    #[test]
    fn attach_shadow_creates_a_shadow_root_with_the_mode() {
        let mut doc = Document::new();
        let host = doc.create_element("div").unwrap();
        let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        assert_eq!(doc.node_type(root).unwrap(), NodeType::ShadowRoot);
        assert_eq!(
            doc.shadow_root_mode(root).unwrap(),
            Some(ShadowRootMode::Open)
        );
        assert_eq!(doc.shadow_host(root).unwrap(), Some(host));
        assert_eq!(doc.shadow_root(host).unwrap(), Some(root));
        assert!(doc.is_shadow_root(root).unwrap());
        assert!(!doc.is_shadow_root(host).unwrap());
        assert_eq!(
            children(&doc, host),
            Vec::<NodeId>::new(),
            "the shadow root is not a child of the host"
        );
        assert_eq!(
            doc.parent(root).unwrap(),
            None,
            "the shadow root is a separate tree root"
        );
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn a_closed_root_never_reads_through_the_public_shadow_root() {
        let mut doc = Document::new();
        let host = doc.create_element("div").unwrap();
        let root = doc.attach_shadow(host, ShadowRootMode::Closed).unwrap();
        assert_eq!(
            doc.shadow_root(host).unwrap(),
            None,
            "closed roots must not leak through the public read"
        );
        assert_eq!(
            doc.shadow_root_mode(root).unwrap(),
            Some(ShadowRootMode::Closed),
            "the closed mode is still stored for the binding"
        );
        assert_eq!(doc.shadow_host(root).unwrap(), Some(host));
    }

    #[test]
    fn attach_shadow_rejects_non_elements_and_double_attach() {
        let mut doc = Document::new();
        let text = doc.create_text("x").unwrap();
        assert!(matches!(
            doc.attach_shadow(text, ShadowRootMode::Open),
            Err(CoreError::Hierarchy { .. })
        ));
        let host = doc.create_element("div").unwrap();
        doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        assert!(matches!(
            doc.attach_shadow(host, ShadowRootMode::Closed),
            Err(CoreError::Hierarchy { .. })
        ));
        let other = doc.create_element("p").unwrap();
        assert!(doc.attach_shadow(other, ShadowRootMode::Closed).is_ok());
        assert_eq!(
            doc.shadow_roots.len(),
            2,
            "distinct hosts each own a shadow tree"
        );
    }

    #[test]
    fn the_shadow_tree_mutates_through_the_ordinary_mutation_api() {
        let mut doc = Document::new();
        let host = doc.create_element("div").unwrap();
        let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        let inner = doc.create_element("span").unwrap();
        doc.append_child(root, inner).unwrap();
        assert_eq!(children(&doc, root), vec![inner]);
        assert_eq!(doc.parent(inner).unwrap(), Some(root));
        assert_eq!(
            children(&doc, host),
            Vec::<NodeId>::new(),
            "the host's light DOM stays empty"
        );
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn foreign_and_stale_handles_fail_structured() {
        let mut a = Document::new();
        let mut b = Document::new();
        let host = a.create_element("div").unwrap();
        assert!(matches!(
            b.attach_shadow(host, ShadowRootMode::Open),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.shadow_root_id(host),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.is_shadow_root(host),
            Err(CoreError::WrongDocument { .. })
        ));
        b.create_element("x").unwrap();
        let bogus = crate::arena::NodeId::new(b.id(), u32::MAX, 0);
        assert!(matches!(b.shadow_root_id(bogus), Err(CoreError::Arena(_))));
        assert!(matches!(
            b.shadow_root_mode(bogus),
            Err(CoreError::Arena(_))
        ));
    }

    // ---- basic named slot assignment ----

    fn shadow_fixture(doc: &mut Document) -> (NodeId, NodeId, NodeId, NodeId) {
        let host = doc.create_element("host").unwrap();
        let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        let named = doc.create_element("slot").unwrap();
        doc.set_attribute(named, "name", "one").unwrap();
        let fallback = doc.create_element("slot").unwrap();
        doc.append_child(root, named).unwrap();
        doc.append_child(root, fallback).unwrap();
        (host, root, named, fallback)
    }

    #[test]
    fn assigned_nodes_matches_host_children_by_slot_attribute() {
        let mut doc = Document::new();
        let (host, _root, named, fallback) = shadow_fixture(&mut doc);
        let a = doc.create_element("span").unwrap();
        let b = doc.create_element("span").unwrap();
        let c = doc.create_element("span").unwrap();
        doc.set_attribute(a, "slot", "one").unwrap();
        doc.append_child(host, a).unwrap();
        doc.append_child(host, b).unwrap();
        doc.append_child(host, c).unwrap();
        doc.set_attribute(c, "slot", "two").unwrap();

        assert_eq!(
            doc.slot_assigned_nodes(named, false).unwrap(),
            vec![a],
            "the named slot gets the child whose slot attribute equals its name"
        );
        assert_eq!(
            doc.slot_assigned_nodes(fallback, false).unwrap(),
            vec![b],
            "the default slot gets the children without a slot attribute"
        );
    }

    #[test]
    fn assigned_elements_filters_to_elements() {
        let mut doc = Document::new();
        let (host, _root, named, fallback) = shadow_fixture(&mut doc);
        let a = doc.create_element("span").unwrap();
        let text = doc.create_text("hi").unwrap();
        doc.set_attribute(a, "slot", "one").unwrap();
        doc.append_child(host, a).unwrap();
        doc.append_child(host, text).unwrap();

        assert_eq!(
            doc.slot_assigned_nodes(named, false).unwrap(),
            vec![a],
            "a text child without a slot attribute is not assigned to a named slot"
        );
        assert_eq!(
            doc.slot_assigned_nodes(fallback, false).unwrap(),
            vec![text]
        );
        assert_eq!(
            doc.slot_assigned_elements(named, false).unwrap(),
            vec![a],
            "assignedElements skips non-element children"
        );
    }

    #[test]
    fn assignment_outside_a_shadow_tree_is_empty() {
        let mut doc = Document::new();
        let slot = doc.create_element("slot").unwrap();
        let host = doc.create_element("div").unwrap();
        let host_child = doc.create_element("span").unwrap();
        let slot_child = doc.create_element("span").unwrap();
        doc.append_child(host, host_child).unwrap();
        doc.append_child(slot, slot_child).unwrap();
        assert_eq!(doc.slot_assigned_nodes(slot, false).unwrap(), Vec::new());
        assert_eq!(doc.slot_assigned_elements(slot, false).unwrap(), Vec::new());
    }

    #[test]
    fn assigned_nodes_skips_non_element_children_without_failing() {
        let mut doc = Document::new();
        let (host, _root, named, fallback) = shadow_fixture(&mut doc);
        let text = doc.create_text("hi").unwrap();
        doc.append_child(host, text).unwrap();
        let el = doc.create_element("span").unwrap();
        doc.set_attribute(el, "slot", "one").unwrap();
        doc.append_child(host, el).unwrap();

        assert_eq!(
            doc.slot_assigned_nodes(named, false).unwrap(),
            vec![el],
            "a text child reads an empty slot name and is never matched to a named slot"
        );
        assert_eq!(
            doc.slot_assigned_nodes(fallback, false).unwrap(),
            vec![text],
            "the default slot gets the text child without failing the attribute read"
        );
        assert_eq!(
            doc.slot_assigned_elements(fallback, false).unwrap(),
            Vec::<NodeId>::new(),
            "assignedElements keeps only element children"
        );
    }

    #[test]
    fn flatten_recurses_through_slotted_slot_elements() {
        let mut doc = Document::new();
        let host = doc.create_element("host").unwrap();
        let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        let outer = doc.create_element("slot").unwrap();
        doc.set_attribute(outer, "name", "one").unwrap();
        doc.append_child(root, outer).unwrap();
        // A `<slot>` in the light DOM assigned to the shadow slot.
        let slotted_slot = doc.create_element("slot").unwrap();
        doc.set_attribute(slotted_slot, "slot", "one").unwrap();
        let leaf = doc.create_element("span").unwrap();
        doc.append_child(host, slotted_slot).unwrap();
        doc.append_child(host, leaf).unwrap();

        assert_eq!(
            doc.slot_assigned_nodes(outer, false).unwrap(),
            vec![slotted_slot],
            "the slotted slot is assigned to the named shadow slot"
        );
        assert_eq!(
            doc.slot_assigned_nodes(outer, true).unwrap(),
            vec![],
            "flatten recurses into the slotted slot, whose own tree is the document (no shadow host)"
        );
    }
}
