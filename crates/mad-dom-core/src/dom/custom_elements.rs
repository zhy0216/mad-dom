//! Custom element definitions, per-element custom state and the synchronous
//! lifecycle reaction queue (T42).
//!
//! # Role
//!
//! This module implements the Core half of the Custom Elements feature. The
//! *definition mapping* (name → JavaScript constructor and its lifecycle
//! callbacks) lives in the facade — the facade owns the constructors exactly
//! like happy-dom's `CustomElementRegistry`. Core owns the DOM-rule half that
//! the facade cannot derive:
//!
//! * the **observed attribute snapshot** pushed at `define` time — the
//!   happy-dom baseline reads `observedAttributes` once at define and stores a
//!   lowercased set, so Core filters the `attributeChangedCallback` reactions
//!   against the same snapshot (the reaction pipeline is decided in Core,
//!   matching the T41 observer-record pattern);
//! * the **per-element custom state** (the elements that are "upgraded") — the
//!   single-class facade mirrors it by setting the wrapper's prototype;
//! * the **synchronous reaction queue** — `Connected` / `Disconnected` /
//!   `AttributeChanged` reactions are enqueued at the single mutation sources
//!   (the insert/remove chokepoints and the attribute write entries) and drained
//!   by the binding after each mutating native entry, outside the document lock,
//!   so the facade can invoke the user callbacks synchronously in enqueue order.
//!
//! # Reaction timing (happy-dom baseline)
//!
//! happy-dom fires the lifecycle callbacks synchronously at the mutation point:
//! `connectedCallback` when an element becomes connected, `disconnectedCallback`
//! when a connected element is detached, and `attributeChangedCallback` for a
//! set/remove of an observed attribute. This module mirrors that by enqueueing
//! reactions at the exact Core chokepoints:
//!
//! * [`Document::detach`](super::Document::detach) enqueues `Disconnected` for
//!   every custom element in a detached subtree that was connected (so removing
//!   a node from a detached parent fires nothing, matching happy-dom);
//! * [`Document::link_detached_chain_between`](super::Document::link_detached_chain_between)
//!   enqueues `Connected` for every custom element in an inserted subtree when
//!   the receiving parent is connected (moving a connected element within the
//!   document therefore fires `Disconnected` then `Connected`, matching the
//!   happy-dom remove-then-insert baseline);
//! * [`Document::set_attribute`](super::Document::set_attribute) /
//!   [`Document::remove_attribute`](super::Document::remove_attribute) enqueue
//!   `AttributeChanged` for custom elements whose observed snapshot contains the
//!   attribute (case-insensitive, the happy-dom lowercased rule);
//! * [`Document::define_custom_element`] physically replaces every
//!   already-connected element of a newly defined name with a fresh custom
//!   element (the happy-dom define-after-connect path: the old reference stays
//!   a plain `HTMLElement`, the replacement takes over its position,
//!   attributes and children) and enqueues the replacement's `Connected`
//!   reaction — like happy-dom it does *not* touch detached candidates and
//!   fires no `AttributeChanged` for attributes present before the definition;
//! * the T29 apply path (innerHTML / outerHTML / load_html) upgrades freshly
//!   parsed elements of defined names and enqueues their `AttributeChanged`
//!   reactions before the splice enqueues `Connected`, so a parsed custom
//!   element observes its attributes before it is connected (happy-dom order).
//!
//! `replace_child` is the one operation whose happy-dom reaction order differs
//! from the natural enqueue order of its detach/link primitives: the WHATWG
//! `replace` is insert-then-remove, so happy-dom fires `Connected` for the
//! replacement (and `Disconnected` when the replacement was itself connected
//! elsewhere) before `Disconnected` for the old child. The mutation block
//! therefore suppresses the reaction queue and `replace_child` enqueues the
//! reactions manually in that order afterwards (the same save/set/restore shape
//! the T41 observer records use for the same operation).
//!
//! # No second authoritative state
//!
//! The tree and the attributes stay in the arena. The custom set is a
//! per-document `HashSet` of [`NodeId`]s — reaction-scheduling state, not DOM
//! state — and the facade mirrors it by setting wrapper prototypes. The two are
//! updated in the same `define` / create / apply / upgrade entry points, so no
//! third source exists. Stale entries (an adopted-away element whose arena slot
//! was freed) are removed by [`Document::remove_node`] via
//! [`CustomElementState::forget`], so a recycled slot can never be treated as a
//! custom element.

use std::collections::{HashMap, HashSet};

use crate::arena::NodeId;
use crate::error::CoreError;

use super::Document;
use super::NodeType;

/// One registered custom element definition (the observed-attribute snapshot).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CustomElementDefinition {
    /// The observed attribute names, lowercased and deduplicated (the
    /// happy-dom baseline lowercases `observedAttributes` at define time).
    pub(crate) observed_attributes: Vec<String>,
}

impl CustomElementDefinition {
    /// Whether `name` is one of the observed attributes.
    fn is_observed(&self, name: &str) -> bool {
        self.observed_attributes.iter().any(|n| n == name)
    }
}

/// The kind of one lifecycle reaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomElementReactionKind {
    Connected,
    Disconnected,
    AttributeChanged,
}

/// One queued lifecycle reaction, drained synchronously by the binding after
/// the mutating native entry that produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomElementReaction {
    pub element: NodeId,
    pub kind: CustomElementReactionKind,
    pub attribute_name: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

/// Per-document custom element state.
#[derive(Debug, Default)]
pub(crate) struct CustomElementState {
    definitions: HashMap<String, CustomElementDefinition>,
    custom_elements: HashSet<NodeId>,
    reactions: Vec<CustomElementReaction>,
    suppress_reactions: bool,
}

impl CustomElementState {
    /// Whether `name` has been defined in this document.
    pub(crate) fn is_defined(&self, name: &str) -> bool {
        self.definitions.contains_key(name)
    }

    /// Whether any custom element is defined. The cheap guard the mutation
    /// chokepoints use to skip the reaction walk for documents that never use
    /// custom elements (zero overhead in the common case).
    pub(crate) fn has_definitions(&self) -> bool {
        !self.definitions.is_empty()
    }

    /// Whether the element for `id` is upgraded (custom).
    pub(crate) fn is_custom(&self, id: NodeId) -> bool {
        self.custom_elements.contains(&id)
    }

    /// Marks `id` as an upgraded custom element.
    pub(crate) fn mark_custom(&mut self, id: NodeId) {
        self.custom_elements.insert(id);
    }

    /// Forgets `id` (an adopted-away element whose arena slot is being freed).
    pub(crate) fn forget(&mut self, id: NodeId) {
        self.custom_elements.remove(&id);
    }

    /// Whether `name`'s definition observes `attribute` (both lowercased by the
    /// callers, the happy-dom lowercased-snapshot rule).
    pub(crate) fn is_observed(&self, name: &str, attribute: &str) -> bool {
        self.definitions
            .get(name)
            .is_some_and(|def| def.is_observed(attribute))
    }

    /// Registers (or replaces) `name` with the lowercased deduplicated observed
    /// attribute snapshot.
    pub(crate) fn define(&mut self, name: &str, observed_attributes: Vec<String>) {
        let mut seen = HashSet::new();
        let observed = observed_attributes
            .into_iter()
            .filter_map(|attribute| {
                let lower = attribute.to_ascii_lowercase();
                if seen.insert(lower.clone()) {
                    Some(lower)
                } else {
                    None
                }
            })
            .collect();
        self.definitions.insert(
            name.to_string(),
            CustomElementDefinition {
                observed_attributes: observed,
            },
        );
    }

    /// Queues one reaction unless the queue is suppressed.
    pub(crate) fn enqueue(&mut self, reaction: CustomElementReaction) {
        if self.suppress_reactions {
            return;
        }
        self.reactions.push(reaction);
    }
}

impl Document {
    /// Returns whether `name` has been defined as a custom element in this
    /// document.
    pub fn is_custom_element_defined(&self, name: &str) -> bool {
        self.custom_elements.is_defined(name)
    }

    /// Returns whether the element for `id` is an upgraded custom element.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_custom_element(&self, id: NodeId) -> Result<bool, CoreError> {
        self.get(id)?;
        Ok(self.custom_elements.is_custom(id))
    }

    /// Registers a custom element definition and replaces every *connected*
    /// element of that name with a freshly minted custom element (the happy-dom
    /// define-after-connect path).
    ///
    /// Registers the observed-attribute snapshot first, then walks the
    /// connected tree from the document root (only reachable elements can be
    /// connected, so the walk needs no arena iteration) and, for each matching
    /// element that is not yet custom, physically replaces it: a new element
    /// of the same name takes over the old element's position, attributes and
    /// children, and the old element is left detached and plain. Only the
    /// replacement gets a `Connected` reaction — the happy-dom replacement
    /// fires `connectedCallback` on the new element and nothing else (no
    /// `AttributeChanged` for pre-definition attributes, no reaction for the
    /// old element or the moved children, and no MutationObserver record).
    /// Detached candidates are deliberately left untouched — happy-dom only
    /// replaces elements that registered their define callback while
    /// connected.
    ///
    /// Returns the replacement [`NodeId`]s in document order; the binding hands
    /// them to the facade so it can set each wrapper's prototype onto the
    /// user class (the old references stay plain `HTMLElement`s) before the
    /// reactions are dispatched.
    pub fn define_custom_element(
        &mut self,
        name: &str,
        observed_attributes: Vec<String>,
    ) -> Vec<NodeId> {
        self.custom_elements.define(name, observed_attributes);
        let mut upgraded = Vec::new();
        let Some(root) = self.cached_document_root() else {
            return upgraded;
        };
        // Collect the connected, matching, not-yet-custom element ids in
        // document order first (a read-only walk, so the mutation phase below
        // never borrows the document immutably).
        let mut candidates = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if self
                .get(id)
                .is_ok_and(|node| node.node_type() == NodeType::Element)
                && self.node_name(id).ok() == Some(name)
                && !self.custom_elements.is_custom(id)
            {
                candidates.push(id);
            }
            if let Ok(children) = self.children(id) {
                for child in children.into_iter().rev() {
                    stack.push(child);
                }
            }
        }

        for old in candidates {
            // A connected candidate always has a parent; skip defensively.
            let Some(old_parent) = self.parent(old).ok().flatten() else {
                continue;
            };
            let prev = self.get(old).ok().and_then(|node| node.previous_sibling());
            let next = self.get(old).ok().and_then(|node| node.next_sibling());

            // Create the replacement. The name is defined by now, so
            // `create_element` already marks it custom.
            let Ok(replacement) = self.create_element(name) else {
                continue;
            };

            // Transfer the old element's attributes and children onto the
            // replacement, then swap it into the old element's position. The
            // whole transfer runs with the observer records and the custom
            // element reactions suppressed: happy-dom performs the replacement
            // without producing a MutationObserver record and without firing
            // anything but the replacement's own `Connected` reaction. The
            // children are reparented by pointer (their query-index entries
            // stay valid — the subtree never leaves the document and keeps its
            // document order), and only the fresh replacement is indexed.
            self.with_custom_element_reactions_suppressed(|doc| {
                doc.with_observer_records_suppressed(|doc| {
                    let attributes: Vec<(String, String)> = doc
                        .get(old)
                        .expect("live candidate")
                        .data()
                        .element_attributes()
                        .map(|pairs| pairs.to_vec())
                        .unwrap_or_default();
                    for (attribute, value) in attributes {
                        let _ = doc.set_attribute(replacement, &attribute, &value);
                    }

                    let children = doc.children(old).expect("live candidate");
                    for &child in &children {
                        doc.node_mut(child).expect("live child").parent = Some(replacement);
                    }
                    let replacement_node = doc.node_mut(replacement).expect("live replacement");
                    replacement_node.first_child = children.first().copied();
                    replacement_node.last_child = children.last().copied();
                    let old_node = doc.node_mut(old).expect("live candidate");
                    old_node.first_child = None;
                    old_node.last_child = None;

                    // The old element is now empty; detaching it unlinks it
                    // from its siblings and removes it from the query index
                    // (suppressed, so it queues no record and no reaction — it
                    // was never custom).
                    doc.detach(old);

                    // Link the replacement into the old element's position.
                    let node = doc.node_mut(replacement).expect("live replacement");
                    node.parent = Some(old_parent);
                    node.previous_sibling = prev;
                    node.next_sibling = next;
                    if let Some(p) = prev {
                        doc.node_mut(p).expect("live previous sibling").next_sibling =
                            Some(replacement);
                    }
                    if let Some(n) = next {
                        doc.node_mut(n).expect("live next sibling").previous_sibling =
                            Some(replacement);
                    }
                    if prev.is_none() {
                        doc.node_mut(old_parent)
                            .expect("live old parent")
                            .first_child = Some(replacement);
                    }
                    if next.is_none() {
                        doc.node_mut(old_parent)
                            .expect("live old parent")
                            .last_child = Some(replacement);
                    }
                    let _ = doc.index_element_attached(replacement);
                });
            });

            self.verify_invariants(old_parent);
            self.verify_detached(old);
            upgraded.push(replacement);
        }

        for &id in &upgraded {
            self.custom_elements.enqueue(CustomElementReaction {
                element: id,
                kind: CustomElementReactionKind::Connected,
                attribute_name: None,
                old_value: None,
                new_value: None,
            });
        }
        upgraded
    }

    /// Upgrades every element of a defined name in the subtree rooted at
    /// `root` (the `customElements.upgrade()` contract).
    ///
    /// Unlike [`Document::define_custom_element`], this walks an arbitrary
    /// subtree (detached or connected). Each newly-upgraded element enqueues an
    /// `AttributeChanged` reaction for every present observed attribute (in
    /// attribute order) and, when the element is connected, a `Connected`
    /// reaction — the WHATWG upgrade order. Returns the upgraded ids.
    pub fn upgrade_custom_elements(&mut self, root: NodeId) -> Result<Vec<NodeId>, CoreError> {
        self.get(root)?;
        let mut upgraded = Vec::new();
        if !self.custom_elements.has_definitions() {
            return Ok(upgraded);
        }
        // Collect the not-yet-custom element ids first (read-only walk), then
        // mutate — the walk borrows the document immutably.
        let mut candidates = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if self.get(id)?.node_type() == NodeType::Element && !self.custom_elements.is_custom(id)
            {
                candidates.push(id);
            }
            for child in self.children(id)?.into_iter().rev() {
                stack.push(child);
            }
        }
        for id in candidates {
            let name = self.node_name(id)?.to_string();
            if !self.custom_elements.is_defined(&name) {
                continue;
            }
            self.custom_elements.mark_custom(id);
            // Clone the attribute pairs so the borrow of the arena slot does
            // not overlap the mutable reaction-queue borrow.
            let attributes: Vec<(String, String)> = self
                .get(id)?
                .data()
                .element_attributes()
                .map(|pairs| pairs.to_vec())
                .unwrap_or_default();
            for (attribute, value) in attributes {
                if self
                    .custom_elements
                    .is_observed(&name, &attribute.to_ascii_lowercase())
                {
                    self.custom_elements.enqueue(CustomElementReaction {
                        element: id,
                        kind: CustomElementReactionKind::AttributeChanged,
                        attribute_name: Some(attribute),
                        old_value: None,
                        new_value: Some(value),
                    });
                }
            }
            if self.is_connected(id)? {
                self.custom_elements.enqueue(CustomElementReaction {
                    element: id,
                    kind: CustomElementReactionKind::Connected,
                    attribute_name: None,
                    old_value: None,
                    new_value: None,
                });
            }
            upgraded.push(id);
        }
        Ok(upgraded)
    }

    /// Returns every upgraded custom element in the subtree rooted at `root`,
    /// in document order.
    ///
    /// The binding uses this after the apply path (innerHTML / outerHTML /
    /// load_html) so the facade can set the wrapper prototypes of the elements
    /// Core just upgraded and marked during the parse, before the queued
    /// reactions are dispatched.
    pub fn list_custom_element_candidates(&self, root: NodeId) -> Result<Vec<NodeId>, CoreError> {
        self.get(root)?;
        let mut ids = Vec::new();
        self.collect_custom_elements(root, &mut ids)?;
        Ok(ids)
    }

    /// Marks the element for `id` as custom when its name is defined, without
    /// enqueueing any reaction.
    ///
    /// Used by the clone/import/adopt facade paths, where happy-dom keeps the
    /// custom class on the cloned / adopted element but fires no lifecycle
    /// callback (attributes are copied silently). Returns whether the element
    /// is custom after the call.
    pub fn mark_custom_element(&mut self, id: NodeId) -> Result<bool, CoreError> {
        if self.get(id)?.node_type() != NodeType::Element {
            return Ok(false);
        }
        let name = self.node_name(id)?.to_string();
        if !self.custom_elements.is_defined(&name) {
            return Ok(false);
        }
        self.custom_elements.mark_custom(id);
        Ok(true)
    }

    /// Marks every element of a defined name in the subtree rooted at `root` as
    /// custom (no reactions), returning the newly marked ids.
    ///
    /// The clone/import/adopt facade paths call this so a deep clone or an
    /// adopted subtree keeps the custom class on every element (happy-dom
    /// parity) while firing no lifecycle callback.
    pub fn mark_custom_elements_in_subtree(
        &mut self,
        root: NodeId,
    ) -> Result<Vec<NodeId>, CoreError> {
        self.get(root)?;
        let mut marked = Vec::new();
        if !self.custom_elements.has_definitions() {
            return Ok(marked);
        }
        let mut candidates = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if self.get(id)?.node_type() == NodeType::Element && !self.custom_elements.is_custom(id)
            {
                candidates.push(id);
            }
            for child in self.children(id)?.into_iter().rev() {
                stack.push(child);
            }
        }
        for id in candidates {
            if self.mark_custom_element(id)? {
                marked.push(id);
            }
        }
        Ok(marked)
    }

    /// Drains the pending custom element reactions of this document, in
    /// enqueue order.
    pub fn take_custom_element_reactions(&mut self) -> Vec<CustomElementReaction> {
        std::mem::take(&mut self.custom_elements.reactions)
    }

    /// Enqueues an `AttributeChanged` reaction for `id` when it is a custom
    /// element whose definition observes `name` (case-insensitive).
    ///
    /// Called from the single attribute-write sources
    /// ([`Document::set_attribute`](super::Document::set_attribute) /
    /// [`Document::remove_attribute`](super::Document::remove_attribute)),
    /// after the mutation succeeded, so a failed write never enqueues.
    pub(crate) fn enqueue_attribute_changed(
        &mut self,
        id: NodeId,
        name: &str,
        old_value: Option<&str>,
        new_value: Option<&str>,
    ) {
        if !self.custom_elements.has_definitions() || !self.custom_elements.is_custom(id) {
            return;
        }
        let element_name = match self.node_name(id) {
            Ok(name) => name.to_string(),
            Err(_) => return,
        };
        if !self
            .custom_elements
            .is_observed(&element_name, &name.to_ascii_lowercase())
        {
            return;
        }
        self.custom_elements.enqueue(CustomElementReaction {
            element: id,
            kind: CustomElementReactionKind::AttributeChanged,
            attribute_name: Some(name.to_string()),
            old_value: old_value.map(str::to_owned),
            new_value: new_value.map(str::to_owned),
        });
    }

    /// Enqueues a `Connected` reaction for every custom element in the subtree
    /// rooted at `root`. The caller has already established that the subtree is
    /// connected (or is about to become connected).
    pub(crate) fn enqueue_connected_subtree(&mut self, root: NodeId) -> Result<(), CoreError> {
        if !self.custom_elements.has_definitions() {
            return Ok(());
        }
        let mut ids = Vec::new();
        self.collect_custom_elements(root, &mut ids)?;
        for id in ids {
            self.custom_elements.enqueue(CustomElementReaction {
                element: id,
                kind: CustomElementReactionKind::Connected,
                attribute_name: None,
                old_value: None,
                new_value: None,
            });
        }
        Ok(())
    }

    /// Enqueues a `Disconnected` reaction for every custom element in the
    /// subtree rooted at `root`. The caller has already established that the
    /// subtree was connected before the removal.
    pub(crate) fn enqueue_disconnected_subtree(&mut self, root: NodeId) -> Result<(), CoreError> {
        if !self.custom_elements.has_definitions() {
            return Ok(());
        }
        let mut ids = Vec::new();
        self.collect_custom_elements(root, &mut ids)?;
        for id in ids {
            self.custom_elements.enqueue(CustomElementReaction {
                element: id,
                kind: CustomElementReactionKind::Disconnected,
                attribute_name: None,
                old_value: None,
                new_value: None,
            });
        }
        Ok(())
    }

    /// Runs `f` with the custom element reaction queue suppressed (used by
    /// `replace_child`, which enqueues the reactions manually in the happy-dom
    /// insert-then-remove order afterwards).
    pub(crate) fn with_custom_element_reactions_suppressed<T>(
        &mut self,
        f: impl FnOnce(&mut Document) -> T,
    ) -> T {
        let previous = self.custom_elements.suppress_reactions;
        self.custom_elements.suppress_reactions = true;
        let result = f(self);
        self.custom_elements.suppress_reactions = previous;
        result
    }

    /// Collects every upgraded custom element in the subtree rooted at `root`,
    /// in document order.
    fn collect_custom_elements(
        &self,
        root: NodeId,
        out: &mut Vec<NodeId>,
    ) -> Result<(), CoreError> {
        if !self.custom_elements.has_definitions() {
            return Ok(());
        }
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if self.get(id)?.node_type() == NodeType::Element && self.custom_elements.is_custom(id)
            {
                out.push(id);
            }
            for child in self.children(id)?.into_iter().rev() {
                stack.push(child);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected_body(doc: &mut Document) -> NodeId {
        let root = doc.document_root();
        let html = doc.create_element("html").unwrap();
        let body = doc.create_element("body").unwrap();
        doc.append_child_for_test(root, html);
        doc.append_child_for_test(html, body);
        body
    }

    fn reactions(doc: &mut Document) -> Vec<CustomElementReaction> {
        doc.take_custom_element_reactions()
    }

    #[test]
    fn define_replaces_connected_elements_and_leaves_old_plain() {
        let mut doc = Document::new();
        let body = connected_body(&mut doc);
        let connected = doc.create_element("my-widget").unwrap();
        let child = doc.create_element("span").unwrap();
        doc.append_child(connected, child).unwrap();
        doc.set_attribute(connected, "foo", "pre").unwrap();
        doc.append_child(body, connected).unwrap();
        let detached = doc.create_element("my-widget").unwrap();

        let upgraded = doc.define_custom_element("my-widget", vec!["foo".to_string()]);
        assert_eq!(upgraded.len(), 1);
        let replacement = upgraded[0];
        assert_ne!(
            replacement, connected,
            "the old element is replaced, not upgraded"
        );
        assert!(doc.is_custom_element_defined("my-widget"));
        assert!(
            !doc.is_custom_element(connected).unwrap(),
            "the old reference stays a plain element"
        );
        assert_eq!(
            doc.parent(connected).unwrap(),
            None,
            "the old reference is detached"
        );
        assert!(doc.is_custom_element(replacement).unwrap());
        assert_eq!(doc.parent(replacement).unwrap(), Some(body));
        assert_eq!(doc.node_name(replacement).unwrap(), "my-widget");
        assert_eq!(
            doc.get_attribute(replacement, "foo").unwrap(),
            Some("pre"),
            "the attributes transfer to the replacement"
        );
        assert_eq!(
            doc.children(replacement).unwrap(),
            vec![child],
            "the children move to the replacement (same node ids)"
        );
        assert_eq!(
            doc.children(connected).unwrap(),
            Vec::<NodeId>::new(),
            "the old element is empty"
        );
        assert!(
            !doc.is_custom_element(detached).unwrap(),
            "detached candidates are not replaced by define (happy-dom parity)"
        );
        let queued = reactions(&mut doc);
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].element, replacement);
        assert_eq!(queued[0].kind, CustomElementReactionKind::Connected);
    }

    #[test]
    fn define_duplicate_name_replaces_the_observed_snapshot() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec!["a".to_string(), "A".to_string()]);
        // "A" lowercases to "a"; the snapshot is deduplicated.
        assert!(doc.custom_elements.is_observed("my-el", "a"));
        doc.define_custom_element("my-el", vec!["b".to_string()]);
        assert!(!doc.custom_elements.is_observed("my-el", "a"));
        assert!(doc.custom_elements.is_observed("my-el", "b"));
    }

    #[test]
    fn set_remove_attribute_enqueue_observed_reactions() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec!["foo".to_string()]);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();

        doc.set_attribute(el, "foo", "v1").unwrap();
        doc.set_attribute(el, "bar", "x").unwrap();
        doc.remove_attribute(el, "foo").unwrap();

        let queued = reactions(&mut doc);
        let shapes: Vec<(String, Option<String>, Option<String>)> = queued
            .iter()
            .map(|r| {
                (
                    r.attribute_name.clone().unwrap(),
                    r.old_value.clone(),
                    r.new_value.clone(),
                )
            })
            .collect();
        assert_eq!(
            shapes,
            vec![
                ("foo".to_string(), None, Some("v1".to_string())),
                ("foo".to_string(), Some("v1".to_string()), None),
            ],
            "only the observed attribute enqueues, with the happy-dom old/new shape"
        );
        for r in &queued {
            assert_eq!(r.kind, CustomElementReactionKind::AttributeChanged);
        }
    }

    #[test]
    fn observed_check_is_case_insensitive() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec!["foo".to_string()]);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.set_attribute(el, "FOO", "1").unwrap();
        assert_eq!(reactions(&mut doc).len(), 1);
    }

    #[test]
    fn non_custom_elements_enqueue_nothing() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec!["foo".to_string()]);
        let plain = doc.create_element("div").unwrap();
        doc.set_attribute(plain, "foo", "1").unwrap();
        assert!(reactions(&mut doc).is_empty());
    }

    #[test]
    fn append_to_connected_parent_enqueues_connected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let body = connected_body(&mut doc);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.append_child(body, el).unwrap();
        let queued = reactions(&mut doc);
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].element, el);
        assert_eq!(queued[0].kind, CustomElementReactionKind::Connected);
    }

    #[test]
    fn append_to_detached_parent_enqueues_nothing() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let holder = doc.create_element("div").unwrap();
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.append_child(holder, el).unwrap();
        assert!(reactions(&mut doc).is_empty());
    }

    #[test]
    fn removing_a_connected_custom_element_enqueues_disconnected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let body = connected_body(&mut doc);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.append_child(body, el).unwrap();
        let _ = reactions(&mut doc); // drop the Connected reaction

        doc.remove_child(body, el).unwrap();
        let queued = reactions(&mut doc);
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].kind, CustomElementReactionKind::Disconnected);
        assert_eq!(queued[0].element, el);
    }

    #[test]
    fn removing_a_detached_custom_element_enqueues_nothing() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let holder = doc.create_element("div").unwrap();
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.append_child(holder, el).unwrap();
        let _ = reactions(&mut doc);
        doc.remove_child(holder, el).unwrap();
        assert!(reactions(&mut doc).is_empty());
    }

    #[test]
    fn moving_a_connected_custom_element_fires_disconnected_then_connected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let body = connected_body(&mut doc);
        let list = doc.create_element("div").unwrap();
        doc.append_child(body, list).unwrap();
        let a = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(a).unwrap();
        let b = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(b).unwrap();
        doc.append_child(list, a).unwrap();
        doc.append_child(list, b).unwrap();
        let _ = reactions(&mut doc);

        doc.insert_before(list, b, a).unwrap();
        let kinds: Vec<_> = reactions(&mut doc).into_iter().map(|r| r.kind).collect();
        assert_eq!(
            kinds,
            vec![
                CustomElementReactionKind::Disconnected,
                CustomElementReactionKind::Connected,
            ],
            "moves fire disconnected then connected (happy-dom remove-then-insert)"
        );
    }

    #[test]
    fn nested_custom_elements_in_a_subtree_all_get_connected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-inner", vec![]);
        let body = connected_body(&mut doc);
        let outer = doc.create_element("div").unwrap();
        let inner = doc.create_element("my-inner").unwrap();
        doc.mark_custom_element(inner).unwrap();
        doc.append_child(outer, inner).unwrap();
        doc.append_child(body, outer).unwrap();
        let ids: Vec<NodeId> = reactions(&mut doc).into_iter().map(|r| r.element).collect();
        assert_eq!(ids, vec![inner]);
    }

    #[test]
    fn replace_child_fires_connected_then_disconnected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let body = connected_body(&mut doc);
        let list = doc.create_element("div").unwrap();
        doc.append_child(body, list).unwrap();
        let old = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(old).unwrap();
        doc.append_child(list, old).unwrap();
        let new = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(new).unwrap();
        let _ = reactions(&mut doc);

        doc.replace_child(list, old, new).unwrap();
        let kinds: Vec<_> = reactions(&mut doc).into_iter().map(|r| r.kind).collect();
        assert_eq!(
            kinds,
            vec![
                CustomElementReactionKind::Connected,
                CustomElementReactionKind::Disconnected,
            ],
            "replace fires the replacement's Connected before the old child's Disconnected"
        );
    }

    #[test]
    fn replace_with_connected_replacement_fires_disconnected_then_connected_then_disconnected() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let body = connected_body(&mut doc);
        let list = doc.create_element("div").unwrap();
        doc.append_child(body, list).unwrap();
        let old = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(old).unwrap();
        doc.append_child(list, old).unwrap();
        let other = doc.create_element("div").unwrap();
        doc.append_child(body, other).unwrap();
        let new = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(new).unwrap();
        doc.append_child(other, new).unwrap();
        let _ = reactions(&mut doc);

        doc.replace_child(list, old, new).unwrap();
        let kinds: Vec<_> = reactions(&mut doc).into_iter().map(|r| r.kind).collect();
        assert_eq!(
            kinds,
            vec![
                CustomElementReactionKind::Disconnected,
                CustomElementReactionKind::Connected,
                CustomElementReactionKind::Disconnected,
            ],
            "a connected replacement is first disconnected from its old parent"
        );
    }

    #[test]
    fn upgrade_custom_elements_marks_and_queues_attrs_then_connected() {
        let mut doc = Document::new();
        let body = connected_body(&mut doc);
        doc.define_custom_element("my-el", vec!["foo".to_string()]);
        // Simulate the parser + apply path: the element is created in a fresh
        // document (no definitions there), adopted into this one (still not
        // custom), then upgraded by the apply-path walk.
        let mut parsed = Document::new();
        let source_el = parsed.create_element("my-el").unwrap();
        parsed.set_attribute(source_el, "foo", "v").unwrap();
        let el = doc.adopt_node(&mut parsed, source_el).unwrap();
        assert!(!doc.is_custom_element(el).unwrap());
        doc.append_child(body, el).unwrap();

        let upgraded = doc.upgrade_custom_elements(el).unwrap();
        assert_eq!(upgraded, vec![el]);
        let queued = reactions(&mut doc);
        assert_eq!(queued.len(), 2, "attr then connected");
        assert_eq!(queued[0].kind, CustomElementReactionKind::AttributeChanged);
        assert_eq!(queued[0].attribute_name.as_deref(), Some("foo"));
        assert_eq!(queued[0].old_value, None);
        assert_eq!(queued[0].new_value.as_deref(), Some("v"));
        assert_eq!(queued[1].kind, CustomElementReactionKind::Connected);
    }

    #[test]
    fn list_candidates_only_returns_custom_elements() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let container = doc.create_element("div").unwrap();
        let custom = doc.create_element("my-el").unwrap();
        let plain = doc.create_element("span").unwrap();
        doc.mark_custom_element(custom).unwrap();
        doc.append_child(container, custom).unwrap();
        doc.append_child(container, plain).unwrap();
        let candidates = doc.list_custom_element_candidates(container).unwrap();
        assert_eq!(candidates, vec![custom]);
    }

    #[test]
    fn mark_custom_elements_in_subtree_keeps_the_custom_class_on_clones() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let el = doc.create_element("my-el").unwrap();
        let clone = doc.clone_node(el, false).unwrap();
        let marked = doc.mark_custom_elements_in_subtree(clone).unwrap();
        assert_eq!(marked, vec![clone]);
        assert!(doc.is_custom_element(clone).unwrap());
        assert!(reactions(&mut doc).is_empty(), "clone fires no reaction");
    }

    #[test]
    fn adopted_away_elements_are_forgotten() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        let mut other = Document::new();
        other.adopt_node(&mut doc, el).unwrap();
        assert!(
            !doc.custom_elements.is_custom(el),
            "the source document forgets the adopted-away element"
        );
    }

    #[test]
    fn reaction_queue_drains_in_order() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec!["foo".to_string()]);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.set_attribute(el, "foo", "1").unwrap();
        doc.set_attribute(el, "foo", "2").unwrap();
        let queued = reactions(&mut doc);
        assert_eq!(queued.len(), 2);
        assert!(reactions(&mut doc).is_empty(), "draining empties the queue");
    }

    #[test]
    fn suppressed_reactions_are_dropped() {
        let mut doc = Document::new();
        doc.define_custom_element("my-el", vec![]);
        let el = doc.create_element("my-el").unwrap();
        doc.mark_custom_element(el).unwrap();
        doc.with_custom_element_reactions_suppressed(|doc| {
            doc.set_attribute(el, "foo", "1").unwrap();
        });
        assert!(reactions(&mut doc).is_empty());
    }

    #[test]
    fn foreign_and_stale_handles_fail_structured() {
        let mut a = Document::new();
        let b = Document::new();
        let el = a.create_element("my-el").unwrap();
        a.define_custom_element("my-el", vec![]);
        a.mark_custom_element(el).unwrap();
        assert!(matches!(
            b.is_custom_element(el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(a.list_custom_element_candidates(el).is_ok());
        assert!(matches!(
            b.list_custom_element_candidates(el),
            Err(CoreError::WrongDocument { .. })
        ));
    }
}
