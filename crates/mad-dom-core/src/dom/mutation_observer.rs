//! `MutationObserver` record generation and queueing (T41).
//!
//! Implements the Core half of the WHATWG `MutationObserver`: the per-document
//! observer registry (one entry per observer, each holding one registered
//! observation per distinct observed target), the record queues (per
//! (observer, target) listener, mirroring the happy-dom baseline's batching
//! granularity), and the option-driven *interest* filter that decides which
//! observations receive a queued record.
//!
//! # Record generation is hooked at the single mutation sources
//!
//! Every record is queued from the crate's *unified mutation API* — never by
//! a caller of it:
//!
//! * **childList** — [`Document::detach`](crate::dom::Document::detach) queues
//!   a removal record for the node's old parent (with the previous/next
//!   siblings captured before the relink), and
//!   [`Document::link_detached_chain_between`](crate::dom::Document::link_detached_chain_between)
//!   queues one addition record per inserted node for the receiving parent.
//!   Every tree-writing path — append/insert/remove/replace, the T29 HTML
//!   apply path (`innerHTML` / `outerHTML` / `parseHtml`), `splitText`, the
//!   T17 adoption family and `ensure_html_skeleton` — funnels through those
//!   two primitives, so no DOM modification path can bypass the observer
//!   records. [`Document::replace_child`] re-orders its emission to match the
//!   baseline (see below) via the [`Document::with_observer_records_suppressed`]
//!   suppression flag.
//! * **attributes** — [`Document::set_attribute`] /
//!   [`Document::remove_attribute`] (the `attributes` module) queue an
//!   attribute record with the old value; the `DOMTokenList` mutators funnel
//!   through them, so `classList.add`/`remove`/`toggle`/`replace` record too.
//! * **characterData** — [`Document::set_character_data`] (the `document`
//!   payload seam) queues a character-data record with the old data; every
//!   `Text`/`Comment`/`ProcessingInstruction` write — `data`, `nodeValue`,
//!   `appendData` / `insertData` / `deleteData` / `replaceData`, the
//!   `textContent` setter on character-data nodes and the `splitText` head —
//!   funnels through it.
//!
//! The `oldValue` of a record is always populated (the happy-dom baseline
//! ignores the `attributeOldValue` / `characterDataOldValue` options and
//! records the old value unconditionally), and the `attributeFilter` /
//! `subtree` / type flags select the *interested* listeners rather than the
//! record contents.
//!
//! # Batching, delivery ordering and lifecycle (the binding contract)
//!
//! The record queue is per (observer, target) *observation* — one record list
//! per distinct observed target — so a task that mutates several observed
//! targets batches per target exactly like the happy-dom baseline (each
//! listener runs its own microtask and callback). When a record is queued into
//! an observation whose queue was previously empty (and whose microtask has
//! not yet been scheduled), the observation becomes a *pending delivery*;
//! [`Document::pending_observer_deliveries`] hands the newly-pending
//! (observer id, observation key) pairs to the binding, which schedules one
//! microtask per pair. The microtask drains the pair through
//! [`Document::take_observer_records`], so records accumulated in the same
//! task (further mutations after the first) are delivered in one callback.
//!
//! [`Document::disconnect_observer`] drops every observation of an observer
//! (a queued but not-yet-run microtask then finds no observation and delivers
//! nothing, matching the baseline); [`Document::take_observer_all_records`]
//! drains the whole observer's queues for `takeRecords()` without resetting
//! the already-scheduled microtasks (which then deliver nothing).
//!
//! Observer ids are minted by the binding (globally unique) and passed to
//! [`Document::observe`], which creates the per-document entry on first use.
//! Observation keys are minted here, per document, and are the stable opaque
//! handle the binding passes back for draining — a Core
//! [`NodeId`](crate::arena::NodeId) never crosses the boundary as a
//! primitive.

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

/// The `MutationRecord.type` discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordType {
    /// A child list change (`childList` records).
    ChildList,
    /// An attribute change (`attributes` records).
    Attributes,
    /// A character data change (`characterData` records).
    CharacterData,
}

/// One queued `MutationRecord`, mirroring the WHATWG shape: a target plus the
/// record-type-specific payload. Node references are stored as Core
/// [`NodeId`]s; the binding mints stable wrappers from them when it builds the
/// JavaScript-visible record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationRecord {
    /// `childList` / `attributes` / `characterData`.
    pub record_type: RecordType,
    /// The node whose children / attributes / data changed.
    pub target: NodeId,
    /// The added nodes (childList records).
    pub added_nodes: Vec<NodeId>,
    /// The removed nodes (childList records).
    pub removed_nodes: Vec<NodeId>,
    /// The removed node's previous sibling (childList removal records only).
    pub previous_sibling: Option<NodeId>,
    /// The removed node's next sibling (childList removal records only).
    pub next_sibling: Option<NodeId>,
    /// The changed attribute's name (attributes records).
    pub attribute_name: Option<String>,
    /// Always `None` in this no-namespace milestone (happy-dom parity).
    pub attribute_namespace: Option<String>,
    /// The old value (attributes / characterData records).
    pub old_value: Option<String>,
}

/// The options of one registered observation (`MutationObserverInit`).
///
/// The binding owns the WebIDL shape and the happy-dom option validation
/// (auto-setting `attributes` when `attributeFilter` / `attributeOldValue` is
/// present, and so on); this struct receives the resolved booleans and the
/// lowercased attribute filter.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ObserverOptions {
    /// `childList`
    pub child_list: bool,
    /// `attributes`
    pub attributes: bool,
    /// `characterData`
    pub character_data: bool,
    /// `subtree`
    pub subtree: bool,
    /// `attributeOldValue` (stored for parity; the baseline records the old
    /// value unconditionally, so it never gates the old value itself).
    pub attribute_old_value: bool,
    /// `characterDataOldValue` (same parity note).
    pub character_data_old_value: bool,
    /// `attributeFilter` (lowercased by the binding).
    pub attribute_filter: Option<Vec<String>>,
}

impl ObserverOptions {
    /// Whether this observation is interested in a record of the given type
    /// (and, for an attribute record, the attribute name against the filter).
    fn interested_in(&self, record_type: RecordType, attribute_name: Option<&str>) -> bool {
        match record_type {
            RecordType::ChildList => self.child_list,
            RecordType::Attributes => {
                self.attributes
                    && match &self.attribute_filter {
                        None => true,
                        Some(filter) => attribute_name
                            .is_some_and(|name| filter.iter().any(|entry| entry == name)),
                    }
            }
            RecordType::CharacterData => self.character_data,
        }
    }
}

/// One (observer, target) listener: the per-target record queue and its
/// delivery state. Re-observing the same target replaces `options` in place
/// (the WHATWG behavior) while keeping the queue and the stable `key`.
#[derive(Debug, Clone)]
struct Observation {
    /// The document-unique opaque key the binding passes back to drain this
    /// listener's queue.
    key: u64,
    /// The observed node.
    target: NodeId,
    /// The active options (replaced by a re-observe of the same target).
    options: ObserverOptions,
    /// Records queued but not yet delivered by the callback.
    records: Vec<MutationRecord>,
    /// Whether a delivery microtask has already been scheduled for this
    /// listener (the binding marks it via [`Document::pending_observer_deliveries`]
    /// and clears it when it drains the queue).
    microtask_queued: bool,
}

/// One registered observer: its per-target observations.
#[derive(Debug, Clone)]
pub(crate) struct ObserverEntry {
    id: u64,
    observations: Vec<Observation>,
}

/// Per-document counter for observation keys.
fn next_key(counter: &mut u64) -> u64 {
    let key = *counter;
    *counter += 1;
    key
}

impl Document {
    /// Registers (or replaces) an observation of `target` under `observer_id`.
    ///
    /// The observer entry is created on first use, so the binding may mint ids
    /// itself and hand them here. Re-observing an already-observed target
    /// replaces its options while keeping its record queue (the WHATWG
    /// behavior; the happy-dom baseline has a quirk here that keeps the old
    /// options — MAD DOM deliberately implements the spec).
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale `target`.
    pub fn observe(
        &mut self,
        observer_id: u64,
        target: NodeId,
        options: ObserverOptions,
    ) -> Result<(), CoreError> {
        self.get(target)?;
        let entry = match self
            .observers
            .iter_mut()
            .find(|entry| entry.id == observer_id)
        {
            Some(entry) => entry,
            None => {
                self.observers.push(ObserverEntry {
                    id: observer_id,
                    observations: Vec::new(),
                });
                self.observers
                    .last_mut()
                    .expect("a fresh observer entry was just pushed")
            }
        };
        match entry
            .observations
            .iter_mut()
            .find(|obs| obs.target == target)
        {
            Some(obs) => obs.options = options,
            None => entry.observations.push(Observation {
                key: next_key(&mut self.next_observation_key),
                target,
                options,
                records: Vec::new(),
                microtask_queued: false,
            }),
        }
        Ok(())
    }

    /// Disconnects `observer_id`: every observation is dropped, so no further
    /// record is queued for it and an already-scheduled delivery finds nothing
    /// to deliver (the happy-dom baseline behavior for `disconnect()` before a
    /// queued microtask runs). The observer entry itself stays so the same
    /// observer can `observe()` again.
    pub fn disconnect_observer(&mut self, observer_id: u64) {
        for entry in &mut self.observers {
            if entry.id == observer_id {
                entry.observations.clear();
                return;
            }
        }
    }

    /// Drains and clears the record queue of one (observer, target) listener,
    /// resetting its scheduled-microtask flag so future records in later tasks
    /// schedule a fresh delivery.
    ///
    /// Returns an empty vector both when the queue is empty (e.g. `takeRecords`
    /// already drained it) and when the observation no longer exists (the
    /// observer was disconnected), so the binding skips the callback in both
    /// cases — exactly like the baseline.
    pub fn take_observer_records(
        &mut self,
        observer_id: u64,
        observation_key: u64,
    ) -> Vec<MutationRecord> {
        for entry in &mut self.observers {
            if entry.id != observer_id {
                continue;
            }
            for obs in &mut entry.observations {
                if obs.key == observation_key {
                    obs.microtask_queued = false;
                    return std::mem::take(&mut obs.records);
                }
            }
        }
        Vec::new()
    }

    /// Drains and clears the record queues of every observation of
    /// `observer_id` (the WHATWG `takeRecords()`), concatenated in observation
    /// order. The already-scheduled microtasks are left scheduled; they will
    /// find empty queues and deliver nothing (baseline parity).
    pub fn take_observer_all_records(&mut self, observer_id: u64) -> Vec<MutationRecord> {
        let mut out = Vec::new();
        for entry in &mut self.observers {
            if entry.id != observer_id {
                continue;
            }
            for obs in &mut entry.observations {
                out.append(&mut std::mem::take(&mut obs.records));
            }
        }
        out
    }

    /// Returns the (observer id, observation key) pairs whose record queues
    /// are non-empty and for which no delivery microtask has been scheduled
    /// yet, marking each as scheduled.
    ///
    /// The binding calls this after every mutating native entry and schedules
    /// one microtask per returned pair; records queued by later mutations in
    /// the same task land on the already-scheduled listener and are delivered
    /// together.
    pub fn pending_observer_deliveries(&mut self) -> Vec<(u64, u64)> {
        let mut out = Vec::new();
        for entry in &mut self.observers {
            for obs in &mut entry.observations {
                if !obs.records.is_empty() && !obs.microtask_queued {
                    obs.microtask_queued = true;
                    out.push((entry.id, obs.key));
                }
            }
        }
        out
    }

    /// Whether any observer is registered in this document.
    ///
    /// Cheap pre-check for the binding's delivery scheduler (avoids the record
    /// scan when no observer exists).
    pub fn has_observers(&self) -> bool {
        !self.observers.is_empty()
    }

    /// Runs `f` with observer record generation suppressed (used by
    /// [`Document::replace_child`] to re-order its records and by the T29
    /// implied-skeleton build, which the baseline never records).
    pub(crate) fn with_observer_records_suppressed<T>(
        &mut self,
        f: impl FnOnce(&mut Document) -> T,
    ) -> T {
        let previous = self.suppress_observer_records;
        self.suppress_observer_records = true;
        let result = f(self);
        self.suppress_observer_records = previous;
        result
    }

    /// Queues a childList addition record for `target` with a single added
    /// node (the baseline emits one record per inserted node).
    pub(crate) fn queue_child_list_added(&mut self, target: NodeId, node: NodeId) {
        self.queue_observer_record(MutationRecord {
            record_type: RecordType::ChildList,
            target,
            added_nodes: vec![node],
            removed_nodes: Vec::new(),
            previous_sibling: None,
            next_sibling: None,
            attribute_name: None,
            attribute_namespace: None,
            old_value: None,
        });
    }

    /// Queues a childList removal record for `target` with the removed node
    /// and its previous/next siblings (captured before the relink).
    pub(crate) fn queue_child_list_removed(
        &mut self,
        target: NodeId,
        node: NodeId,
        previous_sibling: Option<NodeId>,
        next_sibling: Option<NodeId>,
    ) {
        self.queue_observer_record(MutationRecord {
            record_type: RecordType::ChildList,
            target,
            added_nodes: Vec::new(),
            removed_nodes: vec![node],
            previous_sibling,
            next_sibling,
            attribute_name: None,
            attribute_namespace: None,
            old_value: None,
        });
    }

    /// Queues an attributes record for `target` with the changed attribute
    /// name and its old value (always populated, baseline parity).
    pub(crate) fn queue_attribute_record(
        &mut self,
        target: NodeId,
        name: &str,
        old_value: Option<&str>,
    ) {
        self.queue_observer_record(MutationRecord {
            record_type: RecordType::Attributes,
            target,
            added_nodes: Vec::new(),
            removed_nodes: Vec::new(),
            previous_sibling: None,
            next_sibling: None,
            attribute_name: Some(name.to_string()),
            attribute_namespace: None,
            old_value: old_value.map(str::to_owned),
        });
    }

    /// Queues a characterData record for `target` with the old data (always
    /// populated, baseline parity).
    pub(crate) fn queue_character_data_record(&mut self, target: NodeId, old_value: &str) {
        self.queue_observer_record(MutationRecord {
            record_type: RecordType::CharacterData,
            target,
            added_nodes: Vec::new(),
            removed_nodes: Vec::new(),
            previous_sibling: None,
            next_sibling: None,
            attribute_name: None,
            attribute_namespace: None,
            old_value: Some(old_value.to_string()),
        });
    }

    /// Fans a record out to every interested observation.
    ///
    /// An observation is interested when its options accept the record type
    /// (and attribute name) and its target is either the record's target or an
    /// ancestor of it with `subtree` set. The push order is registration
    /// order (observer then observation), which also fixes the relative order
    /// in which the binding schedules the per-listener microtasks.
    fn queue_observer_record(&mut self, record: MutationRecord) {
        if self.suppress_observer_records || self.observers.is_empty() {
            return;
        }
        let mut interested: Vec<(usize, usize)> = Vec::new();
        for (entry_index, entry) in self.observers.iter().enumerate() {
            for (obs_index, obs) in entry.observations.iter().enumerate() {
                if self.observation_interested(obs, &record) {
                    interested.push((entry_index, obs_index));
                }
            }
        }
        for (entry_index, obs_index) in interested {
            let obs = &mut self.observers[entry_index].observations[obs_index];
            obs.records.push(record.clone());
        }
    }

    /// Whether `obs` should receive `record`.
    fn observation_interested(&self, obs: &Observation, record: &MutationRecord) -> bool {
        if !obs
            .options
            .interested_in(record.record_type, record.attribute_name.as_deref())
        {
            return false;
        }
        if obs.target == record.target {
            return true;
        }
        if obs.options.subtree {
            // The record target and every node on its parent chain are live
            // in this document (the record was just generated by a successful
            // mutation), so the walk cannot fail; the cap mirrors
            // `is_descendant_of` to guarantee termination even on a corrupted
            // tree.
            let mut cursor = record.target;
            for _ in 0..=self.live_node_count() {
                match self
                    .get(cursor)
                    .expect("live node on the observer interest walk")
                    .parent()
                {
                    None => return false,
                    Some(parent) if parent == obs.target => return true,
                    Some(parent) => cursor = parent,
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn child_list_record(target: NodeId, node: NodeId) -> MutationRecord {
        MutationRecord {
            record_type: RecordType::ChildList,
            target,
            added_nodes: vec![node],
            removed_nodes: Vec::new(),
            previous_sibling: None,
            next_sibling: None,
            attribute_name: None,
            attribute_namespace: None,
            old_value: None,
        }
    }

    #[test]
    fn observe_queues_records_only_for_interested_listeners() {
        let mut doc = Document::new();
        let parent = doc.create_element("parent").unwrap();
        let child = doc.create_element("child").unwrap();
        doc.observe(
            1,
            parent,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        doc.observe(
            2,
            parent,
            ObserverOptions {
                attributes: true,
                ..Default::default()
            },
        )
        .unwrap();

        doc.queue_child_list_added(parent, child);

        let records_1 = doc.take_observer_all_records(1);
        assert_eq!(records_1.len(), 1);
        assert_eq!(records_1[0], child_list_record(parent, child));
        assert!(doc.take_observer_all_records(2).is_empty());
    }

    #[test]
    fn subtree_observations_receive_records_of_descendant_mutations() {
        let mut doc = Document::new();
        let root = doc.create_element("root").unwrap();
        let mid = doc.create_element("mid").unwrap();
        let leaf = doc.create_element("leaf").unwrap();
        doc.append_child_for_test(root, mid);
        doc.append_child_for_test(mid, leaf);
        doc.observe(
            1,
            root,
            ObserverOptions {
                child_list: true,
                subtree: true,
                ..Default::default()
            },
        )
        .unwrap();
        doc.observe(
            2,
            root,
            ObserverOptions {
                child_list: true,
                subtree: false,
                ..Default::default()
            },
        )
        .unwrap();

        doc.queue_child_list_added(mid, leaf);

        assert_eq!(doc.take_observer_all_records(1).len(), 1);
        assert!(
            doc.take_observer_all_records(2).is_empty(),
            "non-subtree observer is not interested in a descendant mutation"
        );
    }

    #[test]
    fn attribute_filter_selects_records() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        doc.observe(
            1,
            el,
            ObserverOptions {
                attributes: true,
                attribute_filter: Some(vec!["class".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();

        doc.queue_attribute_record(el, "id", Some("old-id"));
        assert!(doc.take_observer_all_records(1).is_empty());

        doc.queue_attribute_record(el, "class", Some("old-class"));
        let records = doc.take_observer_all_records(1);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_type, RecordType::Attributes);
        assert_eq!(records[0].attribute_name.as_deref(), Some("class"));
        assert_eq!(records[0].old_value.as_deref(), Some("old-class"));
    }

    #[test]
    fn re_observing_a_target_replaces_options_but_keeps_the_queue() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.observe(
            1,
            el,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        doc.queue_child_list_added(el, a);
        doc.observe(
            1,
            el,
            ObserverOptions {
                attributes: true,
                ..Default::default()
            },
        )
        .unwrap();

        // The queued childList record survives the option replacement ...
        let records = doc.take_observer_all_records(1);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_type, RecordType::ChildList);

        // ... and the new options drive the interest filter afterwards.
        doc.queue_child_list_added(el, b);
        assert!(doc.take_observer_all_records(1).is_empty());
    }

    #[test]
    fn pending_deliveries_are_marked_once_and_reset_on_take() {
        let mut doc = Document::new();
        let parent = doc.create_element("parent").unwrap();
        let child = doc.create_element("child").unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.observe(
            1,
            parent,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();

        assert!(doc.pending_observer_deliveries().is_empty());
        doc.queue_child_list_added(parent, child);

        let pending = doc.pending_observer_deliveries();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0, 1);

        // Already scheduled: further records in the same task do not re-schedule.
        doc.queue_child_list_added(parent, x);
        assert!(doc.pending_observer_deliveries().is_empty());

        // Draining resets the flag so a later task schedules again.
        let drained = doc.take_observer_records(1, pending[0].1);
        assert_eq!(drained.len(), 2);
        doc.queue_child_list_added(parent, y);
        assert_eq!(doc.pending_observer_deliveries().len(), 1);
    }

    #[test]
    fn take_observer_records_resets_the_microtask_flag() {
        let mut doc = Document::new();
        let parent = doc.create_element("parent").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.observe(
            1,
            parent,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        doc.queue_child_list_added(parent, a);
        let pending = doc.pending_observer_deliveries();
        assert_eq!(pending.len(), 1);

        let drained = doc.take_observer_records(1, pending[0].1);
        assert_eq!(drained.len(), 1);
        assert!(
            doc.pending_observer_deliveries().is_empty(),
            "empty queue after drain"
        );

        doc.queue_child_list_added(parent, b);
        assert_eq!(
            doc.pending_observer_deliveries().len(),
            1,
            "a later record schedules again"
        );
    }

    #[test]
    fn take_observer_records_after_disconnect_returns_empty() {
        let mut doc = Document::new();
        let parent = doc.create_element("parent").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.observe(
            1,
            parent,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        doc.queue_child_list_added(parent, a);
        let pending = doc.pending_observer_deliveries();
        assert_eq!(pending.len(), 1);

        doc.disconnect_observer(1);
        assert!(
            doc.take_observer_records(1, pending[0].1).is_empty(),
            "a disconnected observation delivers nothing"
        );
        assert!(doc.take_observer_all_records(1).is_empty());
    }

    #[test]
    fn suppress_flag_skips_record_generation() {
        let mut doc = Document::new();
        let parent = doc.create_element("parent").unwrap();
        let child = doc.create_element("child").unwrap();
        doc.observe(
            1,
            parent,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();

        doc.with_observer_records_suppressed(|doc| {
            doc.queue_child_list_added(parent, child);
        });
        assert!(doc.take_observer_all_records(1).is_empty());
    }

    #[test]
    fn observer_and_observation_keys_are_document_local() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el_a = a.create_element("div").unwrap();
        let el_b = b.create_element("div").unwrap();
        let x_a = a.create_element("x").unwrap();
        let x_b = b.create_element("x").unwrap();
        a.observe(
            1,
            el_a,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        b.observe(
            1,
            el_b,
            ObserverOptions {
                child_list: true,
                ..Default::default()
            },
        )
        .unwrap();
        a.queue_child_list_added(el_a, x_a);
        b.queue_child_list_added(el_b, x_b);

        assert_eq!(a.pending_observer_deliveries().len(), 1);
        assert_eq!(b.pending_observer_deliveries().len(), 1);
        assert!(a.take_observer_all_records(1).len() == 1);
        assert!(b.take_observer_all_records(1).len() == 1);
    }
}
